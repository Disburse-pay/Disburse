import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { attachPspOnchainClaim, buildSignedPsp } from "./src/sign";
import { verifyOnline } from "./src/online";
import type { PspCore, PspV1 } from "./src/types";

const rpc = vi.hoisted(() => ({
  getChainId: vi.fn(),
  readContract: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => rpc),
    http: vi.fn(() => ({ type: "mock" })),
  };
});

const verifierAddress =
  "0x9999999999999999999999999999999999999999" as Address;

describe("verifyOnline proof scope", () => {
  beforeEach(() => {
    rpc.getChainId.mockReset();
    rpc.readContract.mockReset();
    rpc.getChainId.mockResolvedValue(5_042_002);
  });

  it("reports direct verification as signature-only with settlement not checked", async () => {
    const { psp, issuer } = await createClaimedPsp("direct-signature-only");
    rpc.readContract.mockResolvedValueOnce([true, issuer]);

    const result = await verifyOnline(psp, {
      rpcUrl: "https://rpc.example",
      verifierAddress,
      mode: "direct-signature-only",
    });

    expect(result).toMatchObject({
      ok: true,
      verificationLevel: "trusted_issuer_signature_only",
      issuerStatus: "trusted",
      settlementStatus: "not_checked",
    });
  });

  it("reports full verification only after the settlement claim succeeds", async () => {
    const { psp, issuer } = await createClaimedPsp("settlement");
    rpc.readContract.mockResolvedValueOnce([true, issuer]);

    const result = await verifyOnline(psp, {
      rpcUrl: "https://rpc.example",
      verifierAddress,
      mode: "settlement",
    });

    expect(result).toMatchObject({
      ok: true,
      verificationLevel: "trusted_issuer_and_settlement",
      issuerStatus: "trusted",
      settlementStatus: "confirmed",
    });
  });

  it("never represents a legacy claim-less PSP as on-chain verified", async () => {
    const { psp } = await createClaimedPsp("direct-signature-only");
    const legacy = { ...psp, onchainClaim: undefined };

    const result = await verifyOnline(legacy, {
      rpcUrl: "https://rpc.example",
      verifierAddress,
      mode: "direct-signature-only",
    });

    expect(result).toMatchObject({
      ok: false,
      verificationLevel: "failed",
      settlementStatus: "not_checked",
    });
    expect(result.reason).toContain("no PspVerifier v2");
    expect(rpc.readContract).not.toHaveBeenCalled();
  });

  it("does not downgrade a cross-chain settlement claim to direct scope", async () => {
    const { psp } = await createClaimedPsp("settlement");

    const result = await verifyOnline(psp, {
      rpcUrl: "https://rpc.example",
      verifierAddress,
      mode: "direct-signature-only",
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("mode mismatch");
    expect(result.settlementStatus).toBe("not_checked");
  });

  it("distinguishes a trusted issuer from an unconfirmed settlement", async () => {
    const { psp, issuer } = await createClaimedPsp("settlement");
    rpc.readContract
      .mockResolvedValueOnce([false, issuer])
      .mockResolvedValueOnce(true);

    const result = await verifyOnline(psp, {
      rpcUrl: "https://rpc.example",
      verifierAddress,
      mode: "settlement",
    });

    expect(result).toMatchObject({
      ok: false,
      issuerStatus: "trusted",
      settlementStatus: "unconfirmed",
      verificationLevel: "failed",
    });
  });
});

async function createClaimedPsp(
  mode: "settlement" | "direct-signature-only"
): Promise<{ psp: PspV1; issuer: Address }> {
  const privateKey = generatePrivateKey();
  const issuer = privateKeyToAccount(privateKey).address;
  const core: PspCore = {
    version: 1,
    networkMode: "testnet",
    issuer: {
      name: "Test issuer",
      url: "https://issuer.example",
      publicKey: issuer,
    },
    invoice: {
      requestId: "request-1",
      label: "Invoice",
      payer: "0x1111111111111111111111111111111111111111",
      recipient: "0x2222222222222222222222222222222222222222",
      token: "USDC",
      amount: "10.00",
    },
    settlement: {
      chainId: 5_042_002,
      txHash: `0x${"a".repeat(64)}` as Hex,
      blockNumber: "123",
      settledAt: "2026-07-29T00:00:00.000Z",
      settlementEvent: {
        contract: "0x3333333333333333333333333333333333333333",
        settlementId: `0x${"b".repeat(64)}` as Hex,
        eventTopic: `0x${"c".repeat(64)}` as Hex,
        logIndex: 0,
      },
    },
    source:
      mode === "settlement"
        ? {
            chainId: 84532,
            txHash: `0x${"d".repeat(64)}` as Hex,
            blockNumber: "100",
            payer: "0x1111111111111111111111111111111111111111",
            token: "0x4444444444444444444444444444444444444444",
            amount: "10000000",
          }
        : undefined,
  };
  const portable = await buildSignedPsp(core, privateKey);
  const psp = await attachPspOnchainClaim(portable, privateKey, {
    verifierAddress,
    chainId: 5_042_002,
    mode,
    settlementRegistryVersion: mode === "settlement" ? 1 : undefined,
  });
  return { psp, issuer };
}
