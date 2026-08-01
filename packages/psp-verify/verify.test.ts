import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildSignedPsp } from "./src/sign";
import { verify } from "./src/verify";
import type { PspCore } from "./src/types";

function paymentCore(issuerAddress: `0x${string}`): PspCore {
  return {
    version: 1,
    networkMode: "testnet",
    issuer: {
      name: "Disburse",
      url: "https://disburse.online",
      publicKey: issuerAddress,
    },
    invoice: {
      requestId: "req_123",
      label: "Invoice 123",
      payer: "0x2222222222222222222222222222222222222222",
      recipient: "0x3333333333333333333333333333333333333333",
      token: "USDC",
      amount: "1.00",
    },
    settlement: {
      chainId: 5_042_002,
      txHash: `0x${"a".repeat(64)}`,
      blockNumber: "123",
      settledAt: "2026-05-19T00:01:00.000Z",
      settlementEvent: {
        contract: "0x1111111111111111111111111111111111111111",
        settlementId: `0x${"b".repeat(64)}`,
        eventTopic: `0x${"c".repeat(64)}`,
        logIndex: 0,
      },
    },
  };
}

describe("@disburse/psp-verify payment PSPs", () => {
  it("verifies a signed payment PSP", async () => {
    const privateKey = generatePrivateKey();
    const issuer = privateKeyToAccount(privateKey);
    const core = paymentCore(issuer.address);
    const psp = await buildSignedPsp(core, privateKey);

    const result = await verify(psp, { expectedIssuer: issuer.address });

    expect(result.ok).toBe(true);
    expect(result.trust).toBe("trusted_issuer");
    expect(result.settlementStatus).toBe("not_checked");
    expect(result.fields).toMatchObject({
      kind: "payment",
      requestId: core.invoice.requestId,
      token: "USDC",
      amount: "1.00",
    });
  });

  it("rejects unsigned top-level extension fields", async () => {
    const privateKey = generatePrivateKey();
    const issuer = privateKeyToAccount(privateKey);
    const psp = await buildSignedPsp(paymentCore(issuer.address), privateKey);
    const extendedProof = {
      ...psp,
      untrustedMetadata: { value: "not signed" },
    };

    const result = await verify(extendedProof, { expectedIssuer: issuer.address });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Unsupported PSP field: untrustedMetadata");
  });
});
