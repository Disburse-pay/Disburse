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

import { createHash, randomUUID, createHmac } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from "node:https";
import { BlockList, isIP } from "node:net";
import { getSupabaseAdmin } from "./supabase.js";
import { HttpError } from "./http.js";
import { DISBURSE_TYPED_DOMAIN } from "../src/lib/ids.js";
import { getAddress, hashTypedData, isAddress, keccak256, toBytes, type Address, type Hex } from "viem";
import { readWalletSignature, verifyWalletTypedData } from "./wallet-auth.js";

export const WEBHOOK_AUTH_TTL_SECONDS = 5 * 60;
export const MAX_ACTIVE_WEBHOOKS_PER_OWNER = 5;
const MAX_WEBHOOK_DELIVERIES_PER_EVENT = 100;
const WEBHOOK_DELIVERY_CONCURRENCY = 8;
const WEBHOOK_TIMEOUT_MS = 5_000;
const DNS_TIMEOUT_MS = 2_000;
const MIN_WEBHOOK_SECRET_LENGTH = 32;
const MAX_WEBHOOK_SECRET_LENGTH = 256;
const MAX_WEBHOOK_URL_LENGTH = 2_048;
const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

const NON_PUBLIC_IPV4_RANGES = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3]
] as const) {
  NON_PUBLIC_IPV4_RANGES.addSubnet(network, prefix, "ipv4");
}
const NON_PUBLIC_IPV6_RANGES = new BlockList();
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["100:0:0:1::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8]
] as const) {
  NON_PUBLIC_IPV6_RANGES.addSubnet(network, prefix, "ipv6");
}

export const WEBHOOK_AUTHORIZATION_TYPES = {
  DisburseWebhookAuthorization: [
    { name: "wallet", type: "address" },
    { name: "action", type: "string" },
    { name: "webhookId", type: "string" },
    { name: "url", type: "string" },
    { name: "recipient", type: "address" },
    { name: "events", type: "string" },
    { name: "secretHash", type: "bytes32" },
    { name: "expiresAt", type: "uint256" }
  ]
} as const;

// ---------- Types ----------

export type Webhook = {
  id: string;
  ownerWallet: Address;
  url: string;
  secret: string;
  recipient: Address;
  events: string[];
  active: boolean;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateWebhookInput = {
  ownerWallet: Address;
  url: string;
  secret: string;
  recipient: Address;
  events: string[];
};

export type WebhookAuthorizationAction = "list" | "create" | "delete";

export type WebhookAuthorizationInput = {
  wallet: Address;
  action: WebhookAuthorizationAction;
  expiresAt: bigint;
  webhookId?: string;
  url?: string;
  recipient?: Address;
  events?: string[];
  secret?: string;
};

export type WebhookAuthorizationCredential = {
  wallet: string;
  expiresAt: string;
  signature: string;
};

type HostLookup = (hostname: string) => Promise<readonly { address: string; family: number }[]>;
type SafeWebhookTarget = {
  url: string;
  address: string;
  family: 4 | 6;
};

export type PspWebhookPayload = {
  event: "psp.issued";
  uid?: string;
  requestId?: string;
  networkMode?: string;
  createdAt: string;
  psp: Record<string, unknown>;
};

// ---------- Wallet authorization ----------

export function buildWebhookAuthorizationTypedData(input: WebhookAuthorizationInput) {
  return {
    domain: DISBURSE_TYPED_DOMAIN,
    types: WEBHOOK_AUTHORIZATION_TYPES,
    primaryType: "DisburseWebhookAuthorization",
    message: {
      wallet: input.wallet,
      action: input.action,
      webhookId: input.webhookId ?? "",
      url: input.url ?? "",
      recipient: input.recipient ?? input.wallet,
      events: (input.events ?? []).join(","),
      secretHash: input.secret === undefined ? ZERO_HASH : keccak256(toBytes(input.secret)),
      expiresAt: input.expiresAt
    }
  } as const;
}

export async function authorizeWebhookAction(
  credential: WebhookAuthorizationCredential,
  action: WebhookAuthorizationAction,
  payload: {
    webhookId?: string;
    url?: unknown;
    recipient?: unknown;
    events?: unknown;
    secret?: unknown;
  } = {}
): Promise<{
  wallet: Address;
  expiresAt: bigint;
  webhookId?: string;
  url?: string;
  recipient: Address;
  events: string[];
  secret?: string;
  authorizationDigest: Hex;
}> {
  if (!isAddress(credential.wallet)) {
    throw new HttpError(401, "A valid webhook-owner wallet is required.");
  }
  const wallet = getAddress(credential.wallet);
  const expiresAt = readAuthorizationExpiry(credential.expiresAt);
  assertFreshAuthorization(expiresAt);

  const signature = readWalletSignature(
    credential.signature,
    401,
    "A valid webhook authorization signature is required."
  );

  const webhookId = payload.webhookId?.trim();
  if (action === "delete" && (!webhookId || !isUuid(webhookId))) {
    throw new HttpError(400, "A valid webhook id is required.");
  }

  let url: string | undefined;
  let secret: string | undefined;
  let recipient = wallet;
  let events: string[] = [];

  if (action === "create") {
    url = normalizeWebhookUrl(payload.url);
    secret = normalizeWebhookSecret(payload.secret);
    recipient = normalizeOwnedRecipient(payload.recipient, wallet);
    events = normalizeWebhookEvents(payload.events);
  }

  const typedData = buildWebhookAuthorizationTypedData({
    wallet,
    action,
    expiresAt,
    webhookId,
    url,
    recipient,
    events,
    secret
  });
  const verified = await verifyWalletTypedData({
    ...typedData,
    address: wallet,
    signature
  });

  if (!verified) {
    throw new HttpError(401, "Webhook authorization signature does not match the request.");
  }

  return {
    wallet,
    expiresAt,
    webhookId,
    url,
    recipient,
    events,
    secret,
    authorizationDigest: hashTypedData(typedData)
  };
}

export async function consumeWebhookMutationAuthorization(input: {
  wallet: Address;
  action: "create" | "delete";
  authorizationDigest: Hex;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "consume_webhook_mutation_authorization",
    {
      p_authorization_digest: input.authorizationDigest.toLowerCase(),
      p_owner_wallet: input.wallet.toLowerCase(),
      p_action: input.action
    }
  );
  if (error) {
    throw new HttpError(503, "Webhook replay protection is temporarily unavailable.");
  }
  if (data === "replay") {
    throw new HttpError(409, "This webhook authorization was already used.");
  }
  if (data !== "ok") {
    throw new HttpError(503, "Webhook authorization could not be reserved.");
  }
}

// ---------- Create ----------

export async function createWebhook(
  ownerWallet: Address,
  url: string,
  secret: string,
  recipient: Address,
  events: string[]
): Promise<Webhook> {
  const owner = getAddress(ownerWallet);
  const normalizedUrl = normalizeWebhookUrl(url);
  const normalizedSecret = normalizeWebhookSecret(secret);
  const normalizedRecipient = normalizeOwnedRecipient(recipient, owner);
  const normalizedEvents = normalizeWebhookEvents(events);
  await assertSafeWebhookUrl(normalizedUrl);

  const supabase = getSupabaseAdmin();
  const ownerLower = owner.toLowerCase();
  const recipientLower = normalizedRecipient.toLowerCase();
  const registrationKey = createWebhookRegistrationKey(normalizedUrl, recipientLower);

  const { data: existing, error: existingError } = await supabase
    .from("webhooks")
    .select("*")
    .eq("owner_wallet", ownerLower)
    .eq("registration_key", registrationKey)
    .maybeSingle();

  if (existingError) {
    throw new HttpError(500, "Failed to inspect existing webhook registrations.");
  }

  if (existing) {
    const { data, error } = await supabase
      .from("webhooks")
      .update({
        url: normalizedUrl,
        secret: normalizedSecret,
        recipient: recipientLower,
        events: normalizedEvents,
        active: true,
        failure_count: 0,
        updated_at: new Date().toISOString()
      })
      .eq("id", existing.id as string)
      .eq("owner_wallet", ownerLower)
      .select("*")
      .single();

    if (error?.code === "23514") {
      throw new HttpError(
        429,
        `Each wallet may have at most ${MAX_ACTIVE_WEBHOOKS_PER_OWNER} active webhooks.`
      );
    }
    if (error || !data) {
      throw new HttpError(500, "Failed to update the webhook registration.");
    }
    return rowToWebhook(data as Record<string, unknown>);
  }

  const { count, error: countError } = await supabase
    .from("webhooks")
    .select("id", { count: "exact", head: true })
    .eq("owner_wallet", ownerLower)
    .eq("active", true);

  if (countError) {
    throw new HttpError(500, "Failed to enforce the webhook registration quota.");
  }
  if ((count ?? 0) >= MAX_ACTIVE_WEBHOOKS_PER_OWNER) {
    throw new HttpError(
      429,
      `Each wallet may have at most ${MAX_ACTIVE_WEBHOOKS_PER_OWNER} active webhooks.`
    );
  }

  const id = randomUUID();
  const { data, error } = await supabase
    .from("webhooks")
    .insert({
      id,
      owner_wallet: ownerLower,
      registration_key: registrationKey,
      url: normalizedUrl,
      secret: normalizedSecret,
      recipient: recipientLower,
      events: normalizedEvents,
      active: true,
      failure_count: 0
    })
    .select("*")
    .single();

  if (error || !data) {
    if (error?.code === "23514") {
      throw new HttpError(
        429,
        `Each wallet may have at most ${MAX_ACTIVE_WEBHOOKS_PER_OWNER} active webhooks.`
      );
    }
    throw new HttpError(500, "Failed to create the webhook registration.");
  }

  return rowToWebhook(data as Record<string, unknown>);
}

// ---------- List ----------

export async function listWebhooks(ownerWallet: Address): Promise<Webhook[]> {
  const supabase = getSupabaseAdmin();
  const ownerLower = getAddress(ownerWallet).toLowerCase();

  const { data, error } = await supabase
    .from("webhooks")
    .select("*")
    .eq("owner_wallet", ownerLower)
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) throw new HttpError(500, "Failed to list webhook registrations.");

  return (data || []).map(rowToWebhook);
}

// ---------- Delete (deactivate) ----------

export async function deleteWebhook(ownerWallet: Address, id: string): Promise<void> {
  if (!isUuid(id)) throw new HttpError(400, "A valid webhook id is required.");

  const supabase = getSupabaseAdmin();
  const ownerLower = getAddress(ownerWallet).toLowerCase();

  const { data, error } = await supabase
    .from("webhooks")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_wallet", ownerLower)
    .select("id")
    .maybeSingle();

  if (error) throw new HttpError(500, "Failed to deactivate the webhook registration.");
  if (!data) throw new HttpError(404, "Webhook registration not found.");
}

// ---------- Trigger (fire webhooks after PSP issuance) ----------

export async function triggerWebhooks(psp: Record<string, unknown>): Promise<void> {
  const supabase = getSupabaseAdmin();
  const recipient = readPspRecipient(psp);
  if (!recipient) {
    return;
  }

  // Fetch only registrations owned by this PSP's recipient. The database
  // migration enforces the same owner/recipient invariant for active rows.
  const { data: webhooks, error } = await supabase
    .from("webhooks")
    .select("*")
    .eq("active", true)
    .eq("recipient", recipient)
    .order("created_at", { ascending: true })
    .limit(MAX_WEBHOOK_DELIVERIES_PER_EVENT + 1);

  if (error || !webhooks?.length) return;

  const payload = buildPspWebhookPayload(psp);
  const eligible = webhooks.filter((row) => matchesWebhookRecipient(row, psp));
  const bounded = eligible.slice(0, MAX_WEBHOOK_DELIVERIES_PER_EVENT);

  if (eligible.length > MAX_WEBHOOK_DELIVERIES_PER_EVENT) {
    console.error(
      `[webhooks] delivery cap reached for PSP ${typeof psp.uid === "string" ? psp.uid : "unknown"}; ` +
        `${eligible.length - MAX_WEBHOOK_DELIVERIES_PER_EVENT} registration(s) were deferred.`
    );
  }

  await runWithConcurrency(bounded, WEBHOOK_DELIVERY_CONCURRENCY, async (row) => {
    const events: string[] = Array.isArray(row.events) ? (row.events as string[]) : [];
    if (!events.includes("psp.issued")) return;
    await deliverWebhook(row, payload, supabase);
  });
}

export function buildPspWebhookPayload(psp: Record<string, unknown>, now = new Date()): PspWebhookPayload {
  const invoice = isRecord(psp.invoice) ? psp.invoice : {};
  return {
    event: "psp.issued",
    uid: typeof psp.uid === "string" ? psp.uid : undefined,
    requestId: typeof invoice.requestId === "string" ? invoice.requestId : undefined,
    networkMode: typeof psp.networkMode === "string" ? psp.networkMode : undefined,
    createdAt: now.toISOString(),
    psp
  };
}

export function matchesWebhookRecipient(row: Record<string, unknown>, psp: Record<string, unknown>): boolean {
  const configuredRecipient = typeof row.recipient === "string" ? row.recipient.toLowerCase() : "";
  if (!configuredRecipient) {
    return false;
  }
  return configuredRecipient === readPspRecipient(psp);
}

export function readPspRecipient(psp: Record<string, unknown>): string | undefined {
  const invoice = isRecord(psp.invoice) ? psp.invoice : undefined;
  const recipient = invoice?.recipient;
  return typeof recipient === "string" ? recipient.toLowerCase() : undefined;
}

export function signWebhookPayload(payloadJson: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadJson).digest("hex");
}

// ---------- Delivery ----------

async function deliverWebhook(
  row: Record<string, unknown>,
  payloadBody: PspWebhookPayload,
  supabase: ReturnType<typeof getSupabaseAdmin>
): Promise<void> {
  const payload = JSON.stringify(payloadBody);
  const signature = signWebhookPayload(payload, row.secret as string);

  try {
    // The delivery socket is pinned to the address we vetted. Resolving and
    // then calling fetch(hostname) would leave a DNS-rebinding gap because the
    // HTTP client could perform a second, attacker-controlled lookup.
    const target = await resolveSafeWebhookTarget(row.url);
    const status = await postWebhook(target, payload, signature);

    if (status >= 300 && status < 400) {
      throw new Error("Redirect responses are not allowed.");
    }
    if (status < 200 || status >= 300) {
      throw new Error(`HTTP ${status}`);
    }

    await supabase.rpc("record_webhook_delivery_result_atomic", {
      p_webhook_id: row.id as string,
      p_succeeded: true
    });
  } catch (err) {
    const { data } = await supabase.rpc(
      "record_webhook_delivery_result_atomic",
      {
        p_webhook_id: row.id as string,
        p_succeeded: false
      }
    );
    const failureCount =
      isRecord(data) && typeof data.failure_count === "number"
        ? data.failure_count
        : undefined;

    console.error(
      `[webhooks] delivery failed for ${redactWebhookUrl(row.url)}${failureCount === undefined ? "" : ` (attempt ${failureCount})`}:`,
      err instanceof Error ? err.message : err
    );
  }
}

// ---------- Helpers ----------

function readAuthorizationExpiry(value: string): bigint {
  if (!/^\d{1,20}$/.test(value)) {
    throw new HttpError(401, "Webhook authorization expiry is invalid.");
  }
  return BigInt(value);
}

function assertFreshAuthorization(expiresAt: bigint): void {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (expiresAt <= now) {
    throw new HttpError(401, "Webhook authorization has expired.");
  }
  if (expiresAt > now + BigInt(WEBHOOK_AUTH_TTL_SECONDS)) {
    throw new HttpError(
      401,
      `Webhook authorization may be valid for at most ${WEBHOOK_AUTH_TTL_SECONDS} seconds.`
    );
  }
}

function normalizeWebhookUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "Webhook url is required.");
  }
  if (value.length > MAX_WEBHOOK_URL_LENGTH) {
    throw new HttpError(400, `Webhook url may be at most ${MAX_WEBHOOK_URL_LENGTH} characters.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new HttpError(400, "Webhook url must be a valid URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new HttpError(400, "Webhook url must use HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new HttpError(400, "Webhook url must not contain embedded credentials.");
  }
  if (parsed.port && parsed.port !== "443") {
    throw new HttpError(400, "Webhook url must use the standard HTTPS port.");
  }
  if (parsed.hash) {
    throw new HttpError(400, "Webhook url must not contain a fragment.");
  }

  return parsed.toString();
}

function normalizeWebhookSecret(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "Webhook secret is required.");
  }
  if (value.length < MIN_WEBHOOK_SECRET_LENGTH || value.length > MAX_WEBHOOK_SECRET_LENGTH) {
    throw new HttpError(
      400,
      `Webhook secret must be ${MIN_WEBHOOK_SECRET_LENGTH}-${MAX_WEBHOOK_SECRET_LENGTH} characters.`
    );
  }
  return value;
}

function normalizeOwnedRecipient(value: unknown, ownerWallet: Address): Address {
  const recipient =
    value === undefined || value === null || value === ""
      ? ownerWallet
      : typeof value === "string" && isAddress(value)
        ? getAddress(value)
        : undefined;
  if (!recipient) {
    throw new HttpError(400, "Webhook recipient must be a valid wallet address.");
  }
  if (recipient.toLowerCase() !== ownerWallet.toLowerCase()) {
    throw new HttpError(403, "A webhook may subscribe only to PSPs received by its owner wallet.");
  }
  return recipient;
}

function normalizeWebhookEvents(value: unknown): string[] {
  if (value === undefined || value === null) {
    return ["psp.issued"];
  }
  if (!Array.isArray(value) || value.length !== 1 || value[0] !== "psp.issued") {
    throw new HttpError(400, 'Webhook events must be exactly ["psp.issued"].');
  }
  return ["psp.issued"];
}

function createWebhookRegistrationKey(url: string, recipient: string): string {
  return createHash("sha256").update(`${url}\n${recipient}`).digest("hex");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function assertSafeWebhookUrl(
  value: string,
  lookupHost: HostLookup = lookupPublicHost
): Promise<string> {
  return (await resolveSafeWebhookTarget(value, lookupHost)).url;
}

async function resolveSafeWebhookTarget(
  value: unknown,
  lookupHost: HostLookup = lookupPublicHost
): Promise<SafeWebhookTarget> {
  const normalized = normalizeWebhookUrl(value);
  const parsed = new URL(normalized);
  const hostname = stripIpv6Brackets(parsed.hostname).toLowerCase();

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa")
  ) {
    throw new HttpError(400, "Webhook url must use a public internet host.");
  }

  const literalFamily = isIP(hostname);
  if (literalFamily) {
    if (!isPublicIpAddress(hostname)) {
      throw new HttpError(400, "Webhook url must not target a private or reserved address.");
    }
    return { url: normalized, address: hostname, family: literalFamily as 4 | 6 };
  }

  // Reject single-label hostnames because local DNS search domains can resolve
  // them inside the deployment network.
  if (!hostname.includes(".")) {
    throw new HttpError(400, "Webhook url must use a fully-qualified public hostname.");
  }

  let records: readonly { address: string; family: number }[];
  try {
    records = await withTimeout(lookupHost(hostname), DNS_TIMEOUT_MS, "Webhook hostname lookup timed out.");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Webhook hostname could not be resolved.");
  }

  if (!records.length || records.some((record) => !isPublicIpAddress(record.address))) {
    throw new HttpError(400, "Webhook hostname must resolve only to public internet addresses.");
  }
  const selected = records[0];
  const family = isIP(selected.address);
  if (family !== 4 && family !== 6) {
    throw new HttpError(400, "Webhook hostname returned an invalid address.");
  }
  return { url: normalized, address: selected.address, family };
}

async function lookupPublicHost(hostname: string): Promise<readonly { address: string; family: number }[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

export function isPublicIpAddress(value: string): boolean {
  const address = stripIpv6Brackets(value).toLowerCase();
  const family = isIP(address);
  if (family === 4) return !NON_PUBLIC_IPV4_RANGES.check(address, "ipv4");
  if (family === 6) return !NON_PUBLIC_IPV6_RANGES.check(address, "ipv6");
  return false;
}

function postWebhook(target: SafeWebhookTarget, payload: string, signature: string): Promise<number> {
  const pinnedLookup: NonNullable<HttpsRequestOptions["lookup"]> = (_hostname, _options, callback) => {
    callback(null, target.address, target.family);
  };

  return new Promise<number>((resolve, reject) => {
    const request = httpsRequest(
      target.url,
      {
        method: "POST",
        lookup: pinnedLookup,
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload).toString(),
          "X-Disburse-Event": "psp.issued",
          "X-Disburse-Signature": signature
        }
      },
      (response) => {
        const status = response.statusCode ?? 0;
        // Headers are enough to classify the attempt; immediately close the
        // stream so an endpoint cannot make us retain an unbounded response.
        response.destroy();
        resolve(status);
      }
    );
    request.once("error", reject);
    request.end(payload);
  });
}

function stripIpv6Brackets(value: string): string {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

function redactWebhookUrl(value: unknown): string {
  if (typeof value !== "string") return "invalid-url";
  try {
    return new URL(value).origin;
  } catch {
    return "invalid-url";
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new HttpError(400, message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function rowToWebhook(row: Record<string, unknown>): Webhook {
  return {
    id: row.id as string,
    ownerWallet: getAddress(row.owner_wallet as string),
    url: row.url as string,
    secret: row.secret as string,
    recipient: getAddress(row.recipient as string),
    events: (row.events as string[]) || ["psp.issued"],
    active: row.active as boolean,
    failureCount: (row.failure_count as number) || 0,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
