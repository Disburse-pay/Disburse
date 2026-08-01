import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hash, Hex } from "viem";
import type { PaymentRequest, Receipt } from "../../src/lib/payments.js";
import {
  computePspClaimDomainSeparator,
  PSP_CLAIM_TYPEHASH,
} from "../../src/lib/psp/claim.js";
import { issuePsp } from "./issue.js";

const mocks = vi.hoisted(() => ({
  existingDocument: null as Record<string, unknown> | null,
  upsert: vi.fn(),
  eventInsert: vi.fn(),
  getChainId: vi.fn(),
  getCode: vi.fn(),
  readContract: vi.fn(),
  readDirectSettlementLog: vi.fn(),
  readCrossChainSettlementLog: vi.fn(),
  readSourcePaymentLog: vi.fn(),
}));

vi.mock("../supabase.js", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "psp_documents") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: mocks.existingDocument
                  ? { document: mocks.existingDocument }
                  : null,
                error: null,
              }),
            }),
          }),
          upsert: mocks.upsert,
        };
      }
      if (table === "payment_request_events") {
        return { insert: mocks.eventInsert };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

vi.mock("./fetchLogs.js", () => ({
  readDirectSettlementLog: mocks.readDirectSettlementLog,
  readCrossChainSettlementLog: mocks.readCrossChainSettlementLog,
  readSourcePaymentLog: mocks.readSourcePaymentLog,
}));

vi.mock("../../src/lib/arc.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/arc.js")>();
  return {
    ...actual,
    publicClient: {
      getChainId: mocks.getChainId,
      getCode: mocks.getCode,
      readContract: mocks.readContract,
    },
  };
});

const signingKey =
  "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex;
const issuer = privateKeyToAccount(signingKey).address;
const verifier =
  "0x9999999999999999999999999999999999999999" as Address;
const settlementContract =
  "0x3333333333333333333333333333333333333333" as Address;
const txHash = `0x${"a".repeat(64)}` as Hash;
const settlementId = `0x${"b".repeat(64)}` as Hex;
const eventTopic = `0x${"c".repeat(64)}` as Hex;

describe("PSP v2 issuance integration", () => {
  beforeEach(() => {
    for (const key of [
      "PSP_VERIFIER_V2_ADDRESS",
      "PSP_SETTLEMENT_REGISTRY_VERSION",
      "PSP_REQUIRE_ONCHAIN_CLAIM",
      "SOURCE_CONTRACT_84532",
    ]) {
      delete process.env[key];
    }
    process.env.DISBURSE_PSP_SIGNING_KEY = signingKey;
    process.env.PSP_NETWORK_MODE = "testnet";
    process.env.ARC_SETTLEMENT_CONTRACT = settlementContract;

    mocks.existingDocument = null;
    mocks.upsert.mockReset();
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.eventInsert.mockReset();
    mocks.eventInsert.mockResolvedValue({ error: null });
    mocks.getChainId.mockReset();
    mocks.getChainId.mockResolvedValue(5_042_002);
    mocks.getCode.mockReset();
    mocks.getCode.mockResolvedValue("0x6000");
    mocks.readContract.mockReset();
    mocks.readContract.mockImplementation(defaultVerifierRead);
    mocks.readDirectSettlementLog.mockReset();
    mocks.readDirectSettlementLog.mockResolvedValue({
      settlement: directSettlement(),
    });
    mocks.readCrossChainSettlementLog.mockReset();
    mocks.readCrossChainSettlementLog.mockResolvedValue({
      settlement: crossChainSettlement(),
    });
    mocks.readSourcePaymentLog.mockReset();
    mocks.readSourcePaymentLog.mockResolvedValue({
      source: {
        chainId: 84532,
        txHash: `0x${"d".repeat(64)}`,
        blockNumber: "88",
        payer: "0x1111111111111111111111111111111111111111",
        token: "0x4444444444444444444444444444444444444444",
        amount: "10000000",
      },
      evidence: {
        requestId: `0x${"e".repeat(64)}`,
        payer: "0x1111111111111111111111111111111111111111",
        recipient: "0x2222222222222222222222222222222222222222",
        sourceToken: "0x4444444444444444444444444444444444444444",
        amount: 10_000_000n,
        destinationChainId: 5_042_002,
        nonce: 7n,
        logIndex: 4,
      },
    });
  });

  it("keeps unconfigured issuance explicitly legacy and offline-only", async () => {
    const result = await issuePsp({
      kind: "payment",
      request: directRequest(),
      receipt: directReceipt(),
    });

    expect(result.claimStatus).toBe("legacy_offline_only");
    expect(result.psp.onchainClaim).toBeUndefined();
    expect(mocks.readContract).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.not.objectContaining({ onchainClaim: expect.anything() }),
      }),
      { onConflict: "request_id" }
    );
  });

  it("attaches and validates an explicit direct signature-only claim", async () => {
    process.env.PSP_VERIFIER_V2_ADDRESS = verifier;
    process.env.PSP_REQUIRE_ONCHAIN_CLAIM = "1";

    const result = await issuePsp({
      kind: "payment",
      request: directRequest(),
      receipt: directReceipt(),
    });

    expect(result.claimStatus).toBe("v2_attached");
    expect(result.psp.onchainClaim).toMatchObject({
      mode: "direct-signature-only",
      verifier,
      chainId: 5_042_002,
      settlementRegistryVersion: 0,
    });
    expect(mocks.readContract).toHaveBeenLastCalledWith(
      expect.objectContaining({ functionName: "verifyDirectClaim" })
    );
  });

  it("attaches a full claim only for the configured settlement registry version", async () => {
    process.env.PSP_VERIFIER_V2_ADDRESS = verifier;
    process.env.PSP_SETTLEMENT_REGISTRY_VERSION = "1";
    process.env.PSP_REQUIRE_ONCHAIN_CLAIM = "1";
    process.env.SOURCE_CONTRACT_84532 =
      "0x5555555555555555555555555555555555555555";

    const result = await issuePsp({
      kind: "payment",
      request: crossChainRequest(),
      receipt: crossChainReceipt(),
    });

    expect(result.claimStatus).toBe("v2_attached");
    expect(result.psp.onchainClaim).toMatchObject({
      mode: "settlement",
      settlementRegistryVersion: 1,
    });
    expect(mocks.readContract).toHaveBeenLastCalledWith(
      expect.objectContaining({ functionName: "verifySettlementClaim" })
    );
  });

  it("fails closed when v2 is required but its address is missing", async () => {
    process.env.PSP_REQUIRE_ONCHAIN_CLAIM = "1";

    await expect(
      issuePsp({
        kind: "payment",
        request: directRequest(),
        receipt: directReceipt(),
      })
    ).rejects.toThrow(/requires PSP_VERIFIER_V2_ADDRESS/);

    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("does not persist a claim the configured verifier rejects", async () => {
    process.env.PSP_VERIFIER_V2_ADDRESS = verifier;
    mocks.readContract.mockImplementation(
      ({ functionName }: { functionName: string }) =>
        functionName === "verifyDirectClaim"
          ? [false, issuer]
          : defaultVerifierRead({ functionName })
    );

    await expect(
      issuePsp({
        kind: "payment",
        request: directRequest(),
        receipt: directReceipt(),
      })
    ).rejects.toThrow(/did not accept the newly signed direct/);

    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects mainnet labeling on the Arc Testnet-pinned issuer", async () => {
    process.env.PSP_NETWORK_MODE = "mainnet";

    await expect(
      issuePsp({
        kind: "payment",
        request: directRequest(),
        receipt: directReceipt(),
      })
    ).rejects.toThrow(/must be testnet for Arc chain 5042002/);

    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects an old or incompatible verifier fingerprint", async () => {
    process.env.PSP_VERIFIER_V2_ADDRESS = verifier;
    mocks.readContract.mockImplementation(
      ({ functionName }: { functionName: string }) =>
        functionName === "VERIFIER_VERSION"
          ? 1n
          : defaultVerifierRead({ functionName })
    );

    await expect(
      issuePsp({
        kind: "payment",
        request: directRequest(),
        receipt: directReceipt(),
      })
    ).rejects.toThrow(/unsupported version 1/);

    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("does not silently issue a cross-chain PSP without its source contract", async () => {
    process.env.PSP_VERIFIER_V2_ADDRESS = verifier;
    process.env.PSP_SETTLEMENT_REGISTRY_VERSION = "1";

    await expect(
      issuePsp({
        kind: "payment",
        request: crossChainRequest(),
        receipt: crossChainReceipt(),
      })
    ).rejects.toThrow(/SOURCE_CONTRACT_84532 must be a non-zero EVM address/);

    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("does not silently return a legacy proof after v2 is configured", async () => {
    const legacy = await issuePsp({
      kind: "payment",
      request: directRequest(),
      receipt: directReceipt(),
    });
    process.env.PSP_VERIFIER_V2_ADDRESS = verifier;
    mocks.existingDocument = legacy.psp as unknown as Record<string, unknown>;

    await expect(
      issuePsp({
        kind: "payment",
        request: directRequest(),
        receipt: directReceipt(),
      })
    ).rejects.toThrow(/legacy offline-only proof/);
  });
});

function directRequest(): PaymentRequest {
  return {
    id: "request-1",
    recipient: "0x2222222222222222222222222222222222222222",
    token: "USDC",
    amount: "10.00",
    label: "Invoice",
    createdAt: "2026-07-29T00:00:00.000Z",
    startBlock: "1",
    status: "paid",
    txHash,
  };
}

function crossChainRequest(): PaymentRequest {
  return {
    ...directRequest(),
    destinationChainId: 5_042_002,
    allowedSourceChainIds: [84532],
    settlement: {
      stage: "settled",
      sourceChainId: 84532,
      sourceTxHash: `0x${"d".repeat(64)}`,
      sourceBlockNumber: "88",
      sourceLogIndex: 4,
      destinationChainId: 5_042_002,
      destinationTxHash: txHash,
      destinationBlockNumber: "123",
    },
  };
}

function directReceipt(): Receipt {
  return {
    requestId: "request-1",
    txHash,
    from: "0x1111111111111111111111111111111111111111",
    to: "0x2222222222222222222222222222222222222222",
    token: "USDC",
    amount: "10.00",
    blockNumber: "123",
    confirmedAt: "2026-07-29T00:01:00.000Z",
    explorerUrl: "https://explorer.example/tx",
  };
}

function crossChainReceipt(): Receipt {
  return {
    ...directReceipt(),
    chainId: 5_042_002,
    sourceChainId: 84532,
    sourceTxHash: `0x${"d".repeat(64)}`,
  };
}

function directSettlement() {
  return {
    chainId: 5_042_002,
    txHash,
    blockNumber: "123",
    settledAt: "2026-07-29T00:01:00.000Z",
    settlementEvent: {
      // Actual direct shape: token contract + tx hash as the synthetic ID.
      contract: "0x3600000000000000000000000000000000000000" as Address,
      settlementId: txHash,
      eventTopic,
      logIndex: 0,
    },
  };
}

function crossChainSettlement() {
  return {
    chainId: 5_042_002,
    txHash,
    blockNumber: "123",
    settledAt: "2026-07-29T00:01:00.000Z",
    settlementEvent: {
      contract: settlementContract,
      settlementId,
      eventTopic,
      logIndex: 0,
    },
  };
}

function defaultVerifierRead({
  functionName,
}: {
  functionName: string;
}) {
  switch (functionName) {
    case "VERIFIER_VERSION":
      return 2n;
    case "ARC_TESTNET_CHAIN_ID":
      return 5_042_002n;
    case "PSP_FIELDS_TYPEHASH":
      return PSP_CLAIM_TYPEHASH;
    case "domainSeparator":
      return computePspClaimDomainSeparator(5_042_002, verifier);
    case "trustedIssuers":
      return true;
    case "settlementRegistrations":
      return [1n, true] as const;
    case "verifyDirectClaim":
    case "verifySettlementClaim":
      return [true, issuer] as const;
    default:
      throw new Error(`Unexpected verifier function ${functionName}`);
  }
}
