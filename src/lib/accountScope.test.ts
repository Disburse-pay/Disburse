import { describe, expect, it } from "vitest";
import { isCurrentWalletAccount, isSameWalletAccount } from "./accountScope";

const accountA = "0x1111111111111111111111111111111111111111" as const;
const accountB = "0x2222222222222222222222222222222222222222" as const;

describe("account-scoped async ownership", () => {
  it("accepts only the wallet that started the work", () => {
    expect(isCurrentWalletAccount(accountA, accountA)).toBe(true);
    expect(isCurrentWalletAccount(accountB, accountA)).toBe(false);
    expect(isCurrentWalletAccount(undefined, accountA)).toBe(false);
  });

  it("compares EVM account casing without treating disconnect as another wallet", () => {
    expect(isSameWalletAccount(accountA.toUpperCase() as `0x${string}`, accountA)).toBe(true);
    expect(isSameWalletAccount(undefined, undefined)).toBe(true);
    expect(isSameWalletAccount(accountA, undefined)).toBe(false);
  });
});
