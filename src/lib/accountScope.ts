export type WalletAccount = `0x${string}` | undefined;

/**
 * Compare validated EVM wallet identities without depending on checksum casing.
 * Account-scoped async work must re-check this before publishing results.
 */
export function isSameWalletAccount(
  first: WalletAccount,
  second: WalletAccount
): boolean {
  if (!first || !second) {
    return first === second;
  }
  return first.toLowerCase() === second.toLowerCase();
}

export function isCurrentWalletAccount(
  active: WalletAccount,
  expected: Exclude<WalletAccount, undefined>
): boolean {
  return Boolean(active) && isSameWalletAccount(active, expected);
}
