/**
 * Milestone Invoice Chains
 *
 * Multi-step invoice sequences where each payment unlocks only when
 * the previous step's PSP is presented and verified. This enables:
 *
 * - Freelancer milestone payments (design → dev → deploy)
 * - SLA-backed service billing
 * - Escrow-style conditional releases
 * - Agent-to-agent task completion proofs
 */

import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "./supabase.js";
import { readPspByUid } from "./psp/issue.js";
import { verify } from "../src/lib/psp/verify.js";
import { HttpError } from "./http.js";
import type { Address } from "viem";

// ---------- Types ----------

export type MilestoneChain = {
  id: string;
  title: string;
  description?: string;
  recipient: Address;
  counterparty?: Address;
  token: "USDC" | "EURC";
  totalAmount: string;
  status: "active" | "completed" | "cancelled";
  steps: MilestoneStep[];
  createdAt: string;
  updatedAt: string;
};

export type MilestoneStep = {
  id: string;
  chainId: string;
  stepNumber: number;
  label: string;
  description?: string;
  amount: string;
  status: "locked" | "unlocked" | "payment_pending" | "completed";
  requestId?: string;
  pspUid?: string;
  requiresPspUid?: string;
  unlockedAt?: string;
  completedAt?: string;
  createdAt: string;
};

export type CreateMilestoneInput = {
  title: string;
  description?: string;
  recipient: string;
  counterparty?: string;
  token: "USDC" | "EURC";
  steps: { label: string; description?: string; amount: string }[];
};

// ---------- Create ----------

export async function createMilestoneChain(input: CreateMilestoneInput): Promise<MilestoneChain> {
  if (!input.title?.trim()) throw new HttpError(400, "Title is required.");
  if (!input.recipient || !/^0x[0-9a-fA-F]{40}$/.test(input.recipient)) {
    throw new HttpError(400, "Valid recipient address is required.");
  }
  if (!input.steps?.length) throw new HttpError(400, "At least one step is required.");
  if (input.steps.length > 20) throw new HttpError(400, "Maximum 20 steps per chain.");

  const token = input.token === "EURC" ? "EURC" : "USDC";

  // Calculate total
  const totalAmount = input.steps
    .reduce((sum, step) => sum + parseFloat(step.amount || "0"), 0)
    .toFixed(2);

  const supabase = getSupabaseAdmin();
  const chainId = randomUUID();

  // Insert chain
  const { error: chainError } = await supabase.from("milestone_chains").insert({
    id: chainId,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    recipient: input.recipient.toLowerCase(),
    counterparty: input.counterparty?.toLowerCase() || null,
    token,
    total_amount: totalAmount,
    status: "active"
  });

  if (chainError) throw new HttpError(500, chainError.message);

  // Insert steps — first step is unlocked, rest are locked
  const stepRows = input.steps.map((step, index) => ({
    id: randomUUID(),
    chain_id: chainId,
    step_number: index + 1,
    label: step.label.trim(),
    description: step.description?.trim() || null,
    amount: parseFloat(step.amount || "0").toFixed(2),
    status: index === 0 ? "unlocked" : "locked",
    unlocked_at: index === 0 ? new Date().toISOString() : null
  }));

  const { error: stepsError } = await supabase.from("milestone_steps").insert(stepRows);
  if (stepsError) throw new HttpError(500, stepsError.message);

  return readMilestoneChain(chainId);
}

// ---------- Read ----------

export async function readMilestoneChain(chainId: string): Promise<MilestoneChain> {
  const supabase = getSupabaseAdmin();

  const { data: chain, error: chainError } = await supabase
    .from("milestone_chains")
    .select("*")
    .eq("id", chainId)
    .maybeSingle();

  if (chainError) throw new HttpError(500, chainError.message);
  if (!chain) throw new HttpError(404, "Milestone chain not found.");

  const { data: steps, error: stepsError } = await supabase
    .from("milestone_steps")
    .select("*")
    .eq("chain_id", chainId)
    .order("step_number", { ascending: true });

  if (stepsError) throw new HttpError(500, stepsError.message);

  return {
    id: chain.id,
    title: chain.title,
    description: chain.description || undefined,
    recipient: chain.recipient as Address,
    counterparty: chain.counterparty as Address | undefined,
    token: chain.token,
    totalAmount: chain.total_amount,
    status: chain.status,
    steps: (steps || []).map(rowToStep),
    createdAt: chain.created_at,
    updatedAt: chain.updated_at
  };
}

export async function listMilestoneChains(recipient?: string): Promise<MilestoneChain[]> {
  const supabase = getSupabaseAdmin();

  let query = supabase.from("milestone_chains").select("*").order("created_at", { ascending: false });
  if (recipient) {
    query = query.eq("recipient", recipient.toLowerCase());
  }

  const { data, error } = await query.limit(50);
  if (error) throw new HttpError(500, error.message);

  const chains: MilestoneChain[] = [];
  for (const row of data || []) {
    const { data: steps } = await supabase
      .from("milestone_steps")
      .select("*")
      .eq("chain_id", row.id)
      .order("step_number", { ascending: true });

    chains.push({
      id: row.id,
      title: row.title,
      description: row.description || undefined,
      recipient: row.recipient as Address,
      counterparty: row.counterparty as Address | undefined,
      token: row.token,
      totalAmount: row.total_amount,
      status: row.status,
      steps: (steps || []).map(rowToStep),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  }

  return chains;
}

// ---------- Unlock step (present PSP from previous step) ----------

export async function unlockNextStep(chainId: string, pspUid: string): Promise<MilestoneChain> {
  const supabase = getSupabaseAdmin();

  // Verify the PSP is valid
  const psp = await readPspByUid(pspUid);
  if (!psp) throw new HttpError(404, "PSP not found.");

  const verifyResult = await verify(psp);
  if (!verifyResult.ok) {
    throw new HttpError(400, `PSP verification failed: ${verifyResult.reason}`);
  }

  // Get the chain and steps
  const chain = await readMilestoneChain(chainId);
  if (chain.status !== "active") {
    throw new HttpError(409, "This milestone chain is no longer active.");
  }

  // Find the completed step (the one this PSP proves)
  const completedStep = chain.steps.find(
    (step) => step.status === "unlocked" || step.status === "payment_pending"
  );
  if (!completedStep) {
    throw new HttpError(409, "No step is currently awaiting completion.");
  }

  // Verify the PSP matches the expected payment for this step
  if (completedStep.requestId && verifyResult.fields?.requestId !== completedStep.requestId) {
    throw new HttpError(400, "PSP does not match the payment request for this step.");
  }

  // Mark the current step as completed
  const now = new Date().toISOString();
  const { error: completeError } = await supabase
    .from("milestone_steps")
    .update({ status: "completed", psp_uid: pspUid, completed_at: now })
    .eq("id", completedStep.id);

  if (completeError) throw new HttpError(500, completeError.message);

  // Find and unlock the next step
  const nextStep = chain.steps.find((s) => s.stepNumber === completedStep.stepNumber + 1);
  if (nextStep) {
    const { error: unlockError } = await supabase
      .from("milestone_steps")
      .update({ status: "unlocked", requires_psp_uid: pspUid, unlocked_at: now })
      .eq("id", nextStep.id);

    if (unlockError) throw new HttpError(500, unlockError.message);
  } else {
    // All steps complete — mark chain as completed
    const { error: chainCompleteError } = await supabase
      .from("milestone_chains")
      .update({ status: "completed", updated_at: now })
      .eq("id", chainId);

    if (chainCompleteError) throw new HttpError(500, chainCompleteError.message);
  }

  return readMilestoneChain(chainId);
}

// ---------- Link payment request to a step ----------

export async function linkPaymentToStep(
  chainId: string,
  stepNumber: number,
  requestId: string
): Promise<MilestoneStep> {
  const supabase = getSupabaseAdmin();

  const chain = await readMilestoneChain(chainId);
  const step = chain.steps.find((s) => s.stepNumber === stepNumber);
  if (!step) throw new HttpError(404, "Step not found.");
  if (step.status !== "unlocked") {
    throw new HttpError(409, "This step is not unlocked yet. Present the PSP from the previous step first.");
  }

  const { error } = await supabase
    .from("milestone_steps")
    .update({ request_id: requestId, status: "payment_pending" })
    .eq("id", step.id);

  if (error) throw new HttpError(500, error.message);

  return { ...step, requestId, status: "payment_pending" };
}

// ---------- Helpers ----------

function rowToStep(row: Record<string, unknown>): MilestoneStep {
  return {
    id: row.id as string,
    chainId: row.chain_id as string,
    stepNumber: row.step_number as number,
    label: row.label as string,
    description: (row.description as string) || undefined,
    amount: row.amount as string,
    status: row.status as MilestoneStep["status"],
    requestId: (row.request_id as string) || undefined,
    pspUid: (row.psp_uid as string) || undefined,
    requiresPspUid: (row.requires_psp_uid as string) || undefined,
    unlockedAt: (row.unlocked_at as string) || undefined,
    completedAt: (row.completed_at as string) || undefined,
    createdAt: row.created_at as string
  };
}
