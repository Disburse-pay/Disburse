import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { ApiResponse } from "../../server/http";
import handler from "../../api-handlers/ids.js";
import { publicClient } from "../../src/lib/arc.js";
import { buildIdClaimTypedData } from "../../src/lib/ids.js";

vi.spyOn(publicClient, "verifyTypedData").mockResolvedValue(false);

type IdRow = { handle: string; address: string; claimed_at: string };

const table = vi.hoisted(() => ({ rows: [] as IdRow[] }));

vi.mock("../../server/supabase.js", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: (column: string, value: string) => ({
          maybeSingle: async () => ({
            data: table.rows.find((row) => row[column as keyof IdRow] === value) ?? null,
            error: null
          })
        })
      }),
      insert: (row: { handle: string; address: string }) => ({
        select: () => ({
          single: async () => {
            if (table.rows.some((r) => r.handle === row.handle || r.address === row.address)) {
              return { data: null, error: { code: "23505", message: "duplicate key value" } };
            }
            const full = { ...row, claimed_at: "2026-07-16T00:00:00.000Z" };
            table.rows.push(full);
            return { data: full, error: null };
          }
        })
      })
    })
  })
}));

const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const otherAccount = privateKeyToAccount(`0x${"2".repeat(64)}`);

function futureExpiry(): number {
  return Math.floor(Date.now() / 1000) + 300;
}

async function signClaim(signer: typeof account, handle: string, expiresAt: number) {
  return signer.signTypedData(
    buildIdClaimTypedData({ handle, wallet: signer.address, expiresAt: BigInt(expiresAt) })
  );
}

describe("/api/ids", () => {
  beforeEach(() => {
    table.rows.length = 0;
  });

  it("claims a handle with a valid EIP-712 signature and resolves it both ways", async () => {
    const expiresAt = futureExpiry();
    const signature = await signClaim(account, "alice_01", expiresAt);

    const claim = createResponse();
    await handler(
      { method: "POST", body: { handle: "Alice_01", address: account.address, expiresAt, signature } },
      claim.api
    );
    expect(claim.statusCode).toBe(200);
    expect(claim.body).toMatchObject({ handle: "alice_01", address: account.address });

    const byHandle = createResponse();
    await handler({ method: "GET", query: { handle: "alice_01" } }, byHandle.api);
    expect(byHandle.statusCode).toBe(200);
    expect(byHandle.body).toMatchObject({ handle: "alice_01", address: account.address });

    const byAddress = createResponse();
    await handler({ method: "GET", query: { address: account.address } }, byAddress.api);
    expect(byAddress.statusCode).toBe(200);
    expect(byAddress.body).toMatchObject({ handle: "alice_01", address: account.address });
  });

  it("rejects a signature bound to a different EIP-712 domain", async () => {
    const expiresAt = futureExpiry();
    const typedData = buildIdClaimTypedData({
      handle: "alice_01",
      wallet: account.address,
      expiresAt: BigInt(expiresAt)
    });
    const foreignSignature = await account.signTypedData({
      ...typedData,
      domain: { ...typedData.domain, chainId: 1 }
    });

    const response = createResponse();
    await handler(
      {
        method: "POST",
        body: { handle: "alice_01", address: account.address, expiresAt, signature: foreignSignature }
      },
      response.api
    );
    expect(response.statusCode).toBe(401);
    expect(table.rows).toHaveLength(0);
  });

  it("rejects expired and over-long claim windows", async () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const expired = createResponse();
    await handler(
      {
        method: "POST",
        body: {
          handle: "alice_01",
          address: account.address,
          expiresAt: past,
          signature: await signClaim(account, "alice_01", past)
        }
      },
      expired.api
    );
    expect(expired.statusCode).toBe(401);

    const farFuture = Math.floor(Date.now() / 1000) + 86_400;
    const tooLong = createResponse();
    await handler(
      {
        method: "POST",
        body: {
          handle: "alice_01",
          address: account.address,
          expiresAt: farFuture,
          signature: await signClaim(account, "alice_01", farFuture)
        }
      },
      tooLong.api
    );
    expect(tooLong.statusCode).toBe(400);
  });

  it("rejects malformed handles", async () => {
    const expiresAt = futureExpiry();
    const response = createResponse();
    await handler(
      {
        method: "POST",
        body: {
          handle: "no spaces!",
          address: account.address,
          expiresAt,
          signature: await signClaim(account, "no spaces!", expiresAt)
        }
      },
      response.api
    );
    expect(response.statusCode).toBe(422);
  });

  it("enforces one immutable handle per wallet and unique names", async () => {
    const expiresAt = futureExpiry();
    const first = createResponse();
    await handler(
      {
        method: "POST",
        body: {
          handle: "alice_01",
          address: account.address,
          expiresAt,
          signature: await signClaim(account, "alice_01", expiresAt)
        }
      },
      first.api
    );
    expect(first.statusCode).toBe(200);

    const repeat = createResponse();
    await handler(
      {
        method: "POST",
        body: {
          handle: "alice_01",
          address: account.address,
          expiresAt,
          signature: await signClaim(account, "alice_01", expiresAt)
        }
      },
      repeat.api
    );
    expect(repeat.statusCode).toBe(200);

    const stolen = createResponse();
    await handler(
      {
        method: "POST",
        body: {
          handle: "alice_01",
          address: otherAccount.address,
          expiresAt,
          signature: await signClaim(otherAccount, "alice_01", expiresAt)
        }
      },
      stolen.api
    );
    expect(stolen.statusCode).toBe(409);

    const second = createResponse();
    await handler(
      {
        method: "POST",
        body: {
          handle: "alice_02",
          address: account.address,
          expiresAt,
          signature: await signClaim(account, "alice_02", expiresAt)
        }
      },
      second.api
    );
    expect(second.statusCode).toBe(409);
  });

  it("returns a null handle for unclaimed addresses and 404 for unknown handles", async () => {
    const byAddress = createResponse();
    await handler({ method: "GET", query: { address: otherAccount.address } }, byAddress.api);
    expect(byAddress.statusCode).toBe(200);
    expect(byAddress.body).toMatchObject({ handle: null, address: otherAccount.address });

    const byHandle = createResponse();
    await handler({ method: "GET", query: { handle: "nobody" } }, byHandle.api);
    expect(byHandle.statusCode).toBe(404);
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
