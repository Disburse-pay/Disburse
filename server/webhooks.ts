/**
 * PSP Webhook Delivery
 *
 * Registers webhook endpoints that receive POST notifications whenever
 * a new PSP is issued. Each delivery is signed with HMAC-SHA256 so the
 * receiver can verify authenticity via the X-Disburse-Signature header.
 *
 * Delivery is non-fatal: failures are logged, failure_count is incremented,
 * and webhooks are automatically deactivated after 10 consecutive failures.
 */

import { randomUUID, createHmac } from "node:crypto";
import { getSupabaseAdmin } from "./supabase.js";
import { HttpError } from "./http.js";
import type { Address } from "viem";

// ---------- Types ----------

export type Webhook = {
  id: string;
  url: string;
  secret: string;
  recipient?: Address;
  events: string[];
  active: boolean;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateWebhookInput = {
  url: string;
  secret: string;
  recipient?: string;
  events?: string[];
};

// ---------- Create ----------

export async function createWebhook(
  url: string,
  secret: string,
  recipient?: string,
  events?: string[]
): Promise<Webhook> {
  if (!url?.trim()) throw new HttpError(400, "Webhook url is required.");
  if (!secret?.trim()) throw new HttpError(400, "Webhook secret is required.");

  try {
    new URL(url);
  } catch {
    throw new HttpError(400, "Webhook url must be a valid URL.");
  }

  const supabase = getSupabaseAdmin();
  const id = randomUUID();
  const resolvedEvents = events?.length ? events : ["psp.issued"];

  const { error } = await supabase.from("webhooks").insert({
    id,
    url: url.trim(),
    secret,
    recipient: recipient?.toLowerCase() || null,
    events: resolvedEvents,
    active: true,
    failure_count: 0
  });

  if (error) throw new HttpError(500, error.message);

  return {
    id,
    url: url.trim(),
    secret,
    recipient: (recipient?.toLowerCase() as Address) || undefined,
    events: resolvedEvents,
    active: true,
    failureCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

// ---------- List ----------

export async function listWebhooks(): Promise<Webhook[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("webhooks")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) throw new HttpError(500, error.message);

  return (data || []).map(rowToWebhook);
}

// ---------- Delete (deactivate) ----------

export async function deleteWebhook(id: string): Promise<void> {
  if (!id?.trim()) throw new HttpError(400, "Webhook id is required.");

  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from("webhooks")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new HttpError(500, error.message);
}

// ---------- Trigger (fire webhooks after PSP issuance) ----------

export async function triggerWebhooks(psp: Record<string, unknown>): Promise<void> {
  const supabase = getSupabaseAdmin();

  // Fetch all active webhooks
  const { data: webhooks, error } = await supabase
    .from("webhooks")
    .select("*")
    .eq("active", true);

  if (error || !webhooks?.length) return;

  const pspRecipient = (psp.recipient as string)?.toLowerCase();

  for (const row of webhooks) {
    // Filter by recipient if the webhook specifies one
    if (row.recipient && row.recipient !== pspRecipient) continue;

    // Filter by event type
    const events: string[] = row.events || ["psp.issued"];
    if (!events.includes("psp.issued")) continue;

    await deliverWebhook(row, psp, supabase);
  }
}

// ---------- Delivery ----------

async function deliverWebhook(
  row: Record<string, unknown>,
  psp: Record<string, unknown>,
  supabase: ReturnType<typeof getSupabaseAdmin>
): Promise<void> {
  const payload = JSON.stringify(psp);
  const signature = createHmac("sha256", row.secret as string)
    .update(payload)
    .digest("hex");

  try {
    const res = await fetch(row.url as string, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Disburse-Signature": signature
      },
      body: payload,
      signal: AbortSignal.timeout(10_000)
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    // Reset failure count on success
    if ((row.failure_count as number) > 0) {
      await supabase
        .from("webhooks")
        .update({ failure_count: 0, updated_at: new Date().toISOString() })
        .eq("id", row.id as string);
    }
  } catch (err) {
    const newCount = ((row.failure_count as number) || 0) + 1;
    const update: Record<string, unknown> = {
      failure_count: newCount,
      updated_at: new Date().toISOString()
    };

    // Deactivate after 10 consecutive failures
    if (newCount >= 10) {
      update.active = false;
    }

    await supabase
      .from("webhooks")
      .update(update)
      .eq("id", row.id as string);

    console.error(
      `[webhooks] delivery failed for ${row.url} (attempt ${newCount}):`,
      err instanceof Error ? err.message : err
    );
  }
}

// ---------- Helpers ----------

function rowToWebhook(row: Record<string, unknown>): Webhook {
  return {
    id: row.id as string,
    url: row.url as string,
    secret: row.secret as string,
    recipient: (row.recipient as Address) || undefined,
    events: (row.events as string[]) || ["psp.issued"],
    active: row.active as boolean,
    failureCount: (row.failure_count as number) || 0,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  };
}
