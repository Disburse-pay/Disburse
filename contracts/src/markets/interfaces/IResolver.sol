// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Minimal resolver interface for prediction markets.
 *
 * v1 implementation: AdminResolver — single owner key sets the winning outcome.
 * v2: swappable optimistic-oracle module (UMA-lite) implementing the same
 * interface; Market contracts do not change.
 *
 * The Market contract calls resolve(); the Resolver decides who is allowed
 * to do that. Resolvers MUST reject duplicate resolutions for the same market.
 */
interface IResolver {
    /// Emitted when this resolver finalizes an outcome for a market.
    event Resolved(address indexed market, uint8 winningOutcome);

    /// 0 = NO, 1 = YES. v1 is binary only.
    function resolve(address market, uint8 winningOutcome) external;

    /// Returns true if this resolver has authority over `market`.
    function canResolve(address market) external view returns (bool);
}
