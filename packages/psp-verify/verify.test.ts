import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildSignedPsp } from "./src/sign";
import { verify } from "./src/verify";
import type { PspCore } from "./src/types";

describe("@disburse/psp-verify market-claim PSPs", () => {
  it("verifies a signed market-claim PSP and returns market_claim fields", async () => {
    const privateKey = generatePrivateKey();
    const issuer = privateKeyToAccount(privateKey);
    const core: PspCore = {
      version: 1,
      networkMode: "testnet",
      issuer: {
        name: "Disburse",
        url: "https://disburse.app",
        publicKey: issuer.address,
      },
      marketClaim: {
        marketId: "7e7b5b2f-9df1-4ea1-a0da-0889fb6bd4fd",
        onchainMarket: "0x1111111111111111111111111111111111111111",
        question: "Will this test pass?",
        outcome: "YES",
        winningOutcome: "YES",
        sharesRedeemed: "1000000",
        payoutAmount: "1.00",
        resolvedAt: "2026-05-19T00:00:00.000Z",
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

    const psp = await buildSignedPsp(core, privateKey);
    const result = await verify(psp);

    expect(result.ok).toBe(true);
    expect(result.fields).toMatchObject({
      kind: "market_claim",
      marketId: core.marketClaim?.marketId,
      outcome: "YES",
      payoutAmount: "1.00",
    });
  });
});

