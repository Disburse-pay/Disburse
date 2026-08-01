import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { publicClient } from "../src/lib/arc.js";

vi.spyOn(publicClient, "verifyTypedData").mockResolvedValue(false);

const statementDb = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>
}));

vi.mock("./supabase.js", () => ({
  getSupabaseAdmin: () => ({
    from: () => new FakeStatementQuery(statementDb.rows)
  })
}));

import {
  authorizeStatementQuery,
  buildStatementAccessTypedData,
  generateStatement,
  normalizeStatementQuery
} from "./statements.js";

class FakeStatementQuery {
  private filters: Array<(row: Record<string, unknown>) => boolean> = [];
  private start = 0;
  private end = Number.MAX_SAFE_INTEGER;
  private includeCount = false;

  constructor(private readonly rows: Array<Record<string, unknown>>) {}

  select(_columns: string, options?: { count?: string }) {
    this.includeCount = options?.count === "exact";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  not(column: string, operator: string, value: unknown) {
    if (operator === "is" && value === null) {
      this.filters.push((row) => row[column] !== null && row[column] !== undefined);
    }
    return this;
  }

  gte(column: string, value: string) {
    this.filters.push((row) => String(row[column]) >= value);
    return this;
  }

  lte(column: string, value: string) {
    this.filters.push((row) => String(row[column]) <= value);
    return this;
  }

  order() {
    return this;
  }

  range(start: number, end: number) {
    this.start = start;
    this.end = end;
    return this;
  }

  then<TResult1 = unknown>(
    onfulfilled?:
      | ((value: { data: unknown[]; error: null; count: number | null }) => TResult1 | PromiseLike<TResult1>)
      | null
  ): Promise<TResult1> {
    const filtered = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    const result = {
      data: filtered.slice(this.start, this.end + 1),
      error: null,
      count: this.includeCount ? filtered.length : null
    };
    return Promise.resolve(result).then(onfulfilled ?? undefined) as Promise<TResult1>;
  }
}

const recipient = "0x1111111111111111111111111111111111111111";
const payer = "0x2222222222222222222222222222222222222222";

describe("statement authorization and aggregation", () => {
  it("canonicalizes date bounds and rejects timezone-ambiguous timestamps", () => {
    expect(
      normalizeStatementQuery({
        recipient,
        from: "2026-07-01",
        to: "2026-07-29"
      })
    ).toMatchObject({
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-29T23:59:59.999Z"
    });
    expect(() =>
      normalizeStatementQuery({
        recipient,
        from: "2026-07-01T12:00:00"
      })
    ).toThrow("timezone");
  });

  it("binds statement access to the exact query and a participating wallet", async () => {
    const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
    const query = normalizeStatementQuery({
      recipient: account.address,
      payer,
      token: "USDC",
      networkMode: "testnet"
    });
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 120);
    const signature = await account.signTypedData(
      buildStatementAccessTypedData({ wallet: account.address, query, expiresAt })
    );

    await expect(
      authorizeStatementQuery({ wallet: account.address, expiresAt: expiresAt.toString(), signature }, query)
    ).resolves.toMatchObject({ wallet: account.address, query });

    await expect(
      authorizeStatementQuery(
        { wallet: account.address, expiresAt: expiresAt.toString(), signature },
        { ...query, payer: "0x3333333333333333333333333333333333333333" }
      )
    ).rejects.toThrow("does not match");
  });

  it("filters before pagination and sums six-decimal token amounts exactly", async () => {
    statementDb.rows.length = 0;
    for (let index = 0; index < 600; index += 1) {
      statementDb.rows.push(
        makeRow({
          uid: `psp:unrelated${String(index).padStart(5, "0")}`,
          recipient: "0x3333333333333333333333333333333333333333",
          amount: "99"
        })
      );
    }
    statementDb.rows.push(makeRow({ uid: "psp:target000000001", amount: "1.000001" }));
    statementDb.rows.push(makeRow({ uid: "psp:target000000002", amount: "2.000002" }));

    const query = normalizeStatementQuery({
      recipient,
      token: "USDC",
      networkMode: "testnet"
    });
    const bundle = await generateStatement(query, recipient);

    expect(bundle.proofs).toHaveLength(2);
    expect(bundle.summary).toMatchObject({
      totalProofs: 2,
      totalAmount: "3.000003",
      token: "USDC",
      totals: { USDC: "3.000003" }
    });
  });

  it("keeps mixed-token totals separate", async () => {
    statementDb.rows.length = 0;
    statementDb.rows.push(makeRow({ uid: "psp:mixed000000001", amount: "1.25", token: "USDC" }));
    statementDb.rows.push(makeRow({ uid: "psp:mixed000000002", amount: "2.5", token: "EURC" }));

    const query = normalizeStatementQuery({ recipient, networkMode: "testnet" });
    const bundle = await generateStatement(query, recipient);

    expect(bundle.summary.totalAmount).toBeNull();
    expect(bundle.summary.token).toBe("MIXED");
    expect(bundle.summary.totals).toEqual({ USDC: "1.25", EURC: "2.5" });
  });

  it("fails instead of returning a silently truncated statement", async () => {
    statementDb.rows.length = 0;
    for (let index = 0; index < 101; index += 1) {
      statementDb.rows.push(
        makeRow({
          uid: `psp:target${String(index).padStart(9, "0")}`,
          amount: "1"
        })
      );
    }

    const query = normalizeStatementQuery({
      recipient,
      token: "USDC",
      networkMode: "testnet"
    });
    await expect(generateStatement(query, recipient)).rejects.toMatchObject({
      statusCode: 422
    });
  });
});

function makeRow(input: { uid: string; recipient?: string; amount: string; token?: "USDC" | "EURC" }) {
  const invoiceRecipient = (input.recipient ?? recipient).toLowerCase();
  const token = input.token ?? "USDC";
  return {
    uid: input.uid,
    network_mode: "testnet",
    invoice_recipient: invoiceRecipient,
    invoice_payer: payer.toLowerCase(),
    invoice_token: token,
    created_at: "2026-07-29T00:00:00.000Z",
    document: {
      uid: input.uid,
      version: 1,
      networkMode: "testnet",
      invoice: {
        requestId: "11111111-1111-4111-8111-111111111111",
        label: "Test",
        payer,
        recipient: input.recipient ?? recipient,
        token,
        amount: input.amount
      },
      settlement: {
        chainId: 5_042_002,
        txHash: `0x${"a".repeat(64)}`,
        blockNumber: "123",
        settledAt: "2026-07-29T00:00:01.000Z",
        settlementEvent: {
          contract: "0x3333333333333333333333333333333333333333",
          settlementId: `0x${"b".repeat(64)}`,
          eventTopic: `0x${"c".repeat(64)}`,
          logIndex: 1
        }
      },
      createdAt: "2026-07-29T00:00:00.000Z"
    }
  };
}
