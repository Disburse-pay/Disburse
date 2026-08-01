import { describe, expect, it, vi } from "vitest";
import type { EthereumProvider } from "./onchain";
import { assertProviderAccount } from "./providerAccount";

const accountA = "0x1111111111111111111111111111111111111111" as const;
const accountB = "0x2222222222222222222222222222222222222222" as const;

function providerReturning(value: unknown): EthereumProvider {
  return { request: vi.fn().mockResolvedValue(value) } as unknown as EthereumProvider;
}

describe("signing-provider account ownership", () => {
  it("accepts the account bound to the reviewed operation", async () => {
    await expect(assertProviderAccount(providerReturning([accountA]), accountA))
      .resolves.toBeUndefined();
  });

  it("rejects an account switch before signing", async () => {
    await expect(assertProviderAccount(providerReturning([accountB]), accountA))
      .rejects.toThrow("account changed");
  });

  it.each([[], undefined, ["not-an-address"]])(
    "rejects an unverifiable provider response %#",
    async (accounts) => {
      await expect(assertProviderAccount(providerReturning(accounts), accountA))
        .rejects.toThrow("could not be verified");
    }
  );
});
