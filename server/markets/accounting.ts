/**
 * Shared accounting helpers for the cached market_positions table.
 *
 * The cache has one aggregate cost_basis per market/user, while balances are
 * split by outcome. When a user sells or claims one outcome, allocate basis
 * to that outcome pro-rata by positive share balance, then reduce it pro-rata
 * by the shares leaving the account.
 */

export type CachedPosition = {
  yesShares: bigint;
  noShares: bigint;
  costBasis: bigint;
  realizedPnl: bigint;
};

export function positive(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

export function outcomeShares(position: CachedPosition, outcome: 0 | 1): bigint {
  return outcome === 1 ? positive(position.yesShares) : positive(position.noShares);
}

export function totalPositiveShares(position: CachedPosition): bigint {
  return positive(position.yesShares) + positive(position.noShares);
}

export function clampShareReduction(
  position: CachedPosition,
  outcome: 0 | 1,
  requestedShares: bigint
): bigint {
  if (requestedShares <= 0n) return 0n;
  const held = outcomeShares(position, outcome);
  return requestedShares > held ? held : requestedShares;
}

export function costBasisForShareReduction(
  position: CachedPosition,
  outcome: 0 | 1,
  shareReduction: bigint
): bigint {
  const held = outcomeShares(position, outcome);
  const totalShares = totalPositiveShares(position);
  if (shareReduction <= 0n || held <= 0n || totalShares <= 0n || position.costBasis <= 0n) {
    return 0n;
  }

  const clampedReduction = shareReduction > held ? held : shareReduction;
  const sideBasis = (position.costBasis * held) / totalShares;
  return (sideBasis * clampedReduction) / held;
}

export function prorateAmount(amount: bigint, part: bigint, whole: bigint): bigint {
  if (amount <= 0n || part <= 0n || whole <= 0n) return 0n;
  return (amount * part) / whole;
}
