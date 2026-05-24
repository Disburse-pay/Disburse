// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * InterestRateModel — kinked utilization curve, Compound v2 style.
 *
 * Rate vs utilization U:
 *
 *   U in [0, kink]:   rate = base + (U / kink) × slope1
 *   U in (kink, 1]:   rate = base + slope1 + ((U − kink) / (1 − kink)) × slope2
 *
 * Where U = totalBorrows / (cash + totalBorrows − reserves).
 *
 * All parameters are 1e18-scaled and expressed as per-year rates. The pool
 * calls `getBorrowRatePerSecond` each block; the model divides by seconds-
 * per-year for the conversion.
 *
 * Recommended starting params on Arc Testnet:
 *   base   = 0          (0% APR — testnet, no risk-free baseline)
 *   kink   = 0.8e18     (80% utilization is the bend point)
 *   slope1 = 0.04e18    (4% APR at the kink)
 *   slope2 = 1.0e18     (jumps to ~104% APR at 100% utilization)
 *
 * Immutable — to change parameters, deploy a new model and `setIRM(new)` on
 * the LendingPool.
 */
contract InterestRateModel {
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant WAD = 1e18;

    uint256 public immutable baseRatePerYear;
    uint256 public immutable kinkUtilization;
    uint256 public immutable slope1PerYear;
    uint256 public immutable slope2PerYear;

    constructor(
        uint256 _baseRatePerYear,
        uint256 _kinkUtilization,
        uint256 _slope1PerYear,
        uint256 _slope2PerYear
    ) {
        require(_kinkUtilization > 0 && _kinkUtilization < WAD, "IRM: bad kink");
        baseRatePerYear = _baseRatePerYear;
        kinkUtilization = _kinkUtilization;
        slope1PerYear = _slope1PerYear;
        slope2PerYear = _slope2PerYear;
    }

    /**
     * Utilization U = borrows / (cash + borrows − reserves), 1e18-scaled.
     * If borrows == 0 returns 0. If reserves > cash + borrows (shouldn't
     * happen in practice) returns 0 to avoid underflow.
     */
    function utilization(uint256 cash, uint256 borrows, uint256 reserves)
        public
        pure
        returns (uint256)
    {
        if (borrows == 0) return 0;
        uint256 totalSupply = cash + borrows;
        if (totalSupply <= reserves) return 0;
        return (borrows * WAD) / (totalSupply - reserves);
    }

    /// Borrow APR (per-year, 1e18-scaled).
    function getBorrowRatePerYear(uint256 cash, uint256 borrows, uint256 reserves)
        public
        view
        returns (uint256)
    {
        uint256 util = utilization(cash, borrows, reserves);
        if (util <= kinkUtilization) {
            // Linear segment from (0, base) to (kink, base + slope1).
            return baseRatePerYear + (util * slope1PerYear) / kinkUtilization;
        }
        uint256 over = util - kinkUtilization;
        uint256 spanAboveKink = WAD - kinkUtilization;
        return baseRatePerYear + slope1PerYear + (over * slope2PerYear) / spanAboveKink;
    }

    /**
     * Supply APR: borrowers' interest, minus the reserve cut, distributed
     * across the utilized fraction of the pool. Equivalent to
     * `borrowRate × utilization × (1 − reserveFactor)`.
     */
    function getSupplyRatePerYear(
        uint256 cash,
        uint256 borrows,
        uint256 reserves,
        uint256 reserveFactorBps
    ) public view returns (uint256) {
        uint256 util = utilization(cash, borrows, reserves);
        uint256 borrowRate = getBorrowRatePerYear(cash, borrows, reserves);
        uint256 lendersShare = (borrowRate * (10_000 - reserveFactorBps)) / 10_000;
        return (util * lendersShare) / WAD;
    }

    /// Per-second borrow rate, 1e18-scaled. Used by LendingPool.accrueInterest.
    function getBorrowRatePerSecond(uint256 cash, uint256 borrows, uint256 reserves)
        external
        view
        returns (uint256)
    {
        return getBorrowRatePerYear(cash, borrows, reserves) / SECONDS_PER_YEAR;
    }
}
