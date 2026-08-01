import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { ApiResponse } from "../../server/http";
import handler from "../../api-handlers/notifications.js";
import {
  authorizePaymentRequestCreation,
  openNotificationRequestToken,
  sealNotificationRequestToken
} from "../../server/notifications.js";
import { publicClient } from "../../src/lib/arc.js";
import { buildInboxAccessTypedData, INBOX_ACCESS_TTL_SECONDS } from "../../src/lib/ids.js";
import {
  buildPaymentRequestAuthorizationTypedData,
  PAYMENT_REQUEST_AUTH_TTL_SECONDS
} from "../../src/lib/paymentRequestNotificationAuthorization.js";

vi.spyOn(publicClient, "verifyTypedData").mockResolvedValue(false);

type IdRow = { handle: string; address: string };
type NoteRow = {
  id: string;
  recipient_handle: string;
  kind: "payment_request" | "payment_received";
  request_id: string | null;
  payload: Record<string, unknown>;
  status: "unread" | "read" | "ignored";
  created_at: string;
};

const db = vi.hoisted(() => ({
  ids: [] as IdRow[],
  notifications: [] as NoteRow[],
  reservationResult: "ok",
  reservationError: null as { message: string } | null,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>
}));

vi.mock("../../server/supabase.js", () => ({
  getSupabaseAdmin: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      db.rpcCalls.push({ name, args });
      return { data: db.reservationResult, error: db.reservationError };
    },
    from: (table: string) => {
      if (table === "disburse_ids") {
        return {
          select: () => ({
            eq: (column: string, value: string) => ({
              maybeSingle: async () => ({
                data: db.ids.find((row) => row[column as keyof IdRow] === value) ?? null,
                error: null
              })
            })
          })
        };
      }
      return {
        select: () => ({
          eq: (_column: string, handle: string) => ({
            order: () => ({
              limit: async (count: number) => ({
                data: db.notifications
                  .filter((row) => row.recipient_handle === handle)
                  .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
                  .slice(0, count),
                error: null
              })
            })
          })
        }),
        update: (patch: Partial<NoteRow>) => {
          const filters: Array<[string, string]> = [];
          const builder = {
            eq(column: string, value: string) {
              filters.push([column, value]);
              return builder;
            },
            then(resolve: (result: { error: null }) => void) {
              for (const row of db.notifications) {
                if (filters.every(([column, value]) => row[column as keyof NoteRow] === value)) {
                  Object.assign(row, patch);
                }
              }
              resolve({ error: null });
            }
          };
          return builder;
        }
      };
    }
  })
}));

const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const strangerAccount = privateKeyToAccount(`0x${"2".repeat(64)}`);

function futureExpiry(): number {
  return Math.floor(Date.now() / 1000) + 3600;
}

async function signAccess(signer: typeof account, expiresAt: number) {
  return signer.signTypedData(
    buildInboxAccessTypedData({ wallet: signer.address, expiresAt: BigInt(expiresAt) })
  );
}

function seedNotification(overrides: Partial<NoteRow> = {}): NoteRow {
  const row: NoteRow = {
    id: "11111111-1111-4111-8111-111111111111",
    recipient_handle: "alice_01",
    kind: "payment_request",
    request_id: "22222222-2222-4222-8222-222222222222",
    payload: { request: { id: "22222222-2222-4222-8222-222222222222", amount: "10", token: "USDC" } },
    status: "unread",
    created_at: "2026-07-17T00:00:00.000Z",
    ...overrides
  };
  db.notifications.push(row);
  return row;
}

async function postInbox(body: Record<string, unknown>) {
  const response = createResponse();
  await handler({ method: "POST", body }, response.api);
  return response;
}

describe("notification capability encryption", () => {
  it("stores no plaintext bearer token and binds decryption to its inbox row", () => {
    const previous = process.env.DISBURSE_NOTIFICATION_ENCRYPTION_KEY;
    process.env.DISBURSE_NOTIFICATION_ENCRYPTION_KEY = "ab".repeat(32);
    try {
      const token = "cd".repeat(32);
      const associatedData = "alice_01:22222222-2222-4222-8222-222222222222";
      const envelope = sealNotificationRequestToken(token, associatedData);

      expect(JSON.stringify(envelope)).not.toContain(token);
      expect(openNotificationRequestToken(envelope, associatedData)).toBe(token);
      expect(() => openNotificationRequestToken(envelope, `mallory:${associatedData}`)).toThrow();
    } finally {
      if (previous === undefined) {
        delete process.env.DISBURSE_NOTIFICATION_ENCRYPTION_KEY;
      } else {
        process.env.DISBURSE_NOTIFICATION_ENCRYPTION_KEY = previous;
      }
    }
  });
});

describe("/api/notifications", () => {
  beforeEach(() => {
    db.ids.length = 0;
    db.notifications.length = 0;
    db.reservationResult = "ok";
    db.reservationError = null;
    db.rpcCalls.length = 0;
    db.ids.push({ handle: "alice_01", address: account.address.toLowerCase() });
  });

  it("lists the wallet's notifications with an unread count", async () => {
    seedNotification();
    seedNotification({
      id: "33333333-3333-4333-8333-333333333333",
      kind: "payment_received",
      status: "read",
      created_at: "2026-07-16T00:00:00.000Z"
    });

    const expiresAt = futureExpiry();
    const response = await postInbox({
      wallet: account.address,
      expiresAt,
      signature: await signAccess(account, expiresAt),
      action: "list"
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ handle: "alice_01", unreadCount: 1 });
    const { notifications } = response.body as { notifications: Array<{ id: string; kind: string }> };
    expect(notifications).toHaveLength(2);
    expect(notifications[0].kind).toBe("payment_request");
  });

  it("never returns a legacy plaintext capability without a valid encrypted envelope", async () => {
    const legacyToken = "cd".repeat(32);
    seedNotification({
      payload: {
        request: {
          id: "22222222-2222-4222-8222-222222222222",
          amount: "10",
          token: "USDC",
          requestToken: legacyToken
        },
        requestToken: legacyToken
      }
    });
    const expiresAt = futureExpiry();
    const response = await postInbox({
      wallet: account.address,
      expiresAt,
      signature: await signAccess(account, expiresAt),
      action: "list"
    });

    expect(response.statusCode).toBe(200);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(legacyToken);
    expect(response.body).toMatchObject({
      notifications: [{ payload: { capabilityUnavailable: true } }]
    });
  });

  it("returns a capability only after decrypting the envelope for the exact inbox row", async () => {
    const previous = process.env.DISBURSE_NOTIFICATION_ENCRYPTION_KEY;
    process.env.DISBURSE_NOTIFICATION_ENCRYPTION_KEY = "ab".repeat(32);
    try {
      const requestToken = "ef".repeat(32);
      const requestId = "22222222-2222-4222-8222-222222222222";
      seedNotification({
        request_id: requestId,
        payload: {
          request: { id: requestId, amount: "10", token: "USDC" },
          requestTokenEnvelope: sealNotificationRequestToken(
            requestToken,
            `alice_01:${requestId}`
          )
        }
      });
      const expiresAt = futureExpiry();
      const response = await postInbox({
        wallet: account.address,
        expiresAt,
        signature: await signAccess(account, expiresAt),
        action: "list"
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toMatchObject({
        notifications: [{
          payload: {
            request: { requestToken }
          }
        }]
      });
      expect(JSON.stringify(response.body)).not.toContain("requestTokenEnvelope");
    } finally {
      if (previous === undefined) {
        delete process.env.DISBURSE_NOTIFICATION_ENCRYPTION_KEY;
      } else {
        process.env.DISBURSE_NOTIFICATION_ENCRYPTION_KEY = previous;
      }
    }
  });

  it("marks everything read when the inbox is opened", async () => {
    seedNotification();
    const expiresAt = futureExpiry();
    const response = await postInbox({
      wallet: account.address,
      expiresAt,
      signature: await signAccess(account, expiresAt),
      action: "read"
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ unreadCount: 0 });
    expect(db.notifications[0].status).toBe("read");
  });

  it("ignores a single notification and keeps it in the list", async () => {
    const seeded = seedNotification({ status: "read" });
    const expiresAt = futureExpiry();
    const response = await postInbox({
      wallet: account.address,
      expiresAt,
      signature: await signAccess(account, expiresAt),
      action: "ignore",
      id: seeded.id
    });

    expect(response.statusCode).toBe(200);
    expect(db.notifications[0].status).toBe("ignored");
    const { notifications } = response.body as { notifications: Array<{ status: string }> };
    expect(notifications[0].status).toBe("ignored");
  });

  it("returns an empty inbox for a wallet without a Disburse ID", async () => {
    const expiresAt = futureExpiry();
    const response = await postInbox({
      wallet: strangerAccount.address,
      expiresAt,
      signature: await signAccess(strangerAccount, expiresAt),
      action: "list"
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ handle: null, unreadCount: 0, notifications: [] });
  });

  it("rejects a signature bound to a different EIP-712 domain", async () => {
    const expiresAt = futureExpiry();
    const typedData = buildInboxAccessTypedData({
      wallet: account.address,
      expiresAt: BigInt(expiresAt)
    });
    const foreignSignature = await account.signTypedData({
      ...typedData,
      domain: { ...typedData.domain, chainId: 1 }
    });

    const response = await postInbox({
      wallet: account.address,
      expiresAt,
      signature: foreignSignature,
      action: "list"
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects expired and over-long access windows", async () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const expired = await postInbox({
      wallet: account.address,
      expiresAt: past,
      signature: await signAccess(account, past),
      action: "list"
    });
    expect(expired.statusCode).toBe(401);

    const farFuture = Math.floor(Date.now() / 1000) + INBOX_ACCESS_TTL_SECONDS + 3600;
    const tooLong = await postInbox({
      wallet: account.address,
      expiresAt: farFuture,
      signature: await signAccess(account, farFuture),
      action: "list"
    });
    expect(tooLong.statusCode).toBe(400);
  });

  it("rejects unknown actions and malformed ignore ids", async () => {
    seedNotification();
    const expiresAt = futureExpiry();
    const signature = await signAccess(account, expiresAt);

    const badAction = await postInbox({ wallet: account.address, expiresAt, signature, action: "purge" });
    expect(badAction.statusCode).toBe(400);

    const badId = await postInbox({
      wallet: account.address,
      expiresAt,
      signature,
      action: "ignore",
      id: "nope"
    });
    expect(badId.statusCode).toBe(400);
    expect(db.notifications[0].status).toBe("unread");
  });
});

describe("payment-request notification authorization", () => {
  beforeEach(() => {
    db.reservationResult = "ok";
    db.reservationError = null;
    db.rpcCalls.length = 0;
  });

  it("accepts a short-lived recipient signature covering every displayed field", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + PAYMENT_REQUEST_AUTH_TTL_SECONDS - 30;
    const authorization = {
      wallet: account.address,
      notify: "alice_01",
      recipient: account.address,
      token: "USDC" as const,
      amount: "12.34",
      label: "Invoice 42",
      note: "July services",
      invoiceDate: "2026-07-29",
      expiresAt: BigInt(expiresAt)
    };
    const signature = await account.signTypedData(buildPaymentRequestAuthorizationTypedData(authorization));

    await expect(
      authorizePaymentRequestCreation({
        ...authorization,
        expiresAt,
        signature
      })
    ).resolves.toMatchObject(authorization);
  });

  it("rejects an altered target or invoice field", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 120;
    const authorization = {
      wallet: account.address,
      notify: "alice_01",
      recipient: account.address,
      token: "USDC" as const,
      amount: "12.34",
      label: "Invoice 42",
      note: "",
      invoiceDate: "2026-07-29",
      expiresAt: BigInt(expiresAt)
    };
    const signature = await account.signTypedData(buildPaymentRequestAuthorizationTypedData(authorization));

    await expect(
      authorizePaymentRequestCreation({
        ...authorization,
        notify: "mallory_01",
        expiresAt,
        signature
      })
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("requires the recipient signature even when no inbox target is requested", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 120;
    const authorization = {
      wallet: account.address,
      notify: "",
      recipient: account.address,
      token: "USDC" as const,
      amount: "1",
      label: "Signed QR",
      note: undefined,
      invoiceDate: "2026-07-29",
      expiresAt: BigInt(expiresAt)
    };
    const signature = await account.signTypedData(buildPaymentRequestAuthorizationTypedData(authorization));

    const authorized = await authorizePaymentRequestCreation({
      ...authorization,
      expiresAt,
      signature
    });
    expect(authorized).toMatchObject(authorization);
    expect(authorized.authorizationDigest).toMatch(/^0x[0-9a-f]{64}$/);

    await expect(
      authorizePaymentRequestCreation({
        ...authorization,
        expiresAt,
        signature: ""
      })
    ).rejects.toMatchObject({ statusCode: 401 });
  });

});

function createResponse() {
  const state: {
    statusCode?: number;
    body?: unknown;
    headers: Record<string, string>;
    api: ApiResponse;
  } = {
    headers: {},
    api: undefined as unknown as ApiResponse
  };

  state.api = {
    status: vi.fn((code: number) => {
      state.statusCode = code;
      return state.api;
    }),
    json: vi.fn((body: unknown) => {
      state.body = body;
    }),
    setHeader: vi.fn((name: string, value: string) => {
      state.headers[name.toLowerCase()] = value;
    })
  };

  return state;
}
