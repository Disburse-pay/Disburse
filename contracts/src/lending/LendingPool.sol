// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AUsdc} from "./AUsdc.sol";

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IInterestRateModel {
    function getBorrowRatePerSecond(uint256 cash, uint256 borrows, uint256 reserves)
        external
        view
        returns (uint256);
}

interface IPriceAdapter {
    /// Returns 1e18-scaled USD price per 1 unit of the underlying asset.
    function getPrice() external view returns (uint256);
}

/**
 * LendingPool — Aave/Compound-style two-sided money market.
 *
 *   Supply side (lenders):
 *     deposit(usdcAmount)  → receives aUSDC shares; earns variable APR.
 *     withdraw(shares)     → burns aUSDC, returns USDC + accrued interest.
 *
 *   Borrow side (cirBTC depositors):
 *     depositCollateral(cirBtcAmount)
 *     borrow(usdcAmount)   → up to MAX_LTV_BPS of collateral value
 *     repay(usdcAmount)    → permits anyone to repay on behalf of borrower
 *     withdrawCollateral(cirBtcAmount) → if resulting HF stays ≥ 1
 *
 *   Liquidation (anyone):
 *     liquidate(borrower, repayUsdc) — when HF < 1, liquidator repays up
 *     to 50% (close factor) of debt and receives equivalent cirBTC + a
 *     LIQUIDATION_BONUS_BPS bonus, taken from the borrower's collateral.
 *
 * Interest accrual (continuous via per-block compounding):
 *   - `borrowIndex` grows each accrual: actualBorrows = scaledBorrows × borrowIndex / 1e18
 *   - `supplyIndex` grows each accrual: actualSupply = aUSDC.totalSupply × supplyIndex / 1e18
 *   - Reserve cut (RESERVE_FACTOR_BPS of accrued interest) sits in `totalReserves`,
 *     withdrawable by the protocol owner.
 *
 * All public state-changing entrypoints call `_accrueInterest()` first, so
 * any read of user balance/debt after a state change reflects current state.
 *
 * Scale conventions:
 *   - USDC amounts: 6 decimals
 *   - cirBTC amounts: 8 decimals
 *   - Indexes (supply/borrow): 1e18-scaled (WAD)
 *   - Prices from oracle: 1e18-scaled USD per 1 underlying unit
 *   - HF, LTV, utilization: 1e18-scaled (1e18 = 1.0)
 *
 * SECURITY NOTES:
 *   - Reentrancy: USDC transfers happen after state writes; cirBTC transfers
 *     happen via OpenZeppelin-style standard transfer semantics. A simple
 *     nonReentrant guard wraps every public state-changer for defense in depth.
 *   - Oracle: PythPriceAdapter has its own staleness check. If the oracle
 *     reverts, all collateral-aware operations revert — safer than letting
 *     a stale price decide a liquidation.
 *   - Bad debt: if cirBTC crashes faster than liquidators can act, the pool
 *     can become undercollateralized. v1 has no socialized-loss mechanism;
 *     the owner reserves are the buffer. Document this risk to lenders.
 */
contract LendingPool {
    // ───── Constants ─────
    uint256 public constant WAD = 1e18;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    /// 80% — max borrow at open
    uint256 public constant MAX_LTV_BPS = 8_000;
    /// 90% — HF goes < 1 above this
    uint256 public constant LIQUIDATION_THRESHOLD_BPS = 9_000;
    /// 5% bonus paid to liquidator (taken from borrower's collateral)
    uint256 public constant LIQUIDATION_BONUS_BPS = 500;
    /// 10% of accrued interest captured by protocol
    uint256 public constant RESERVE_FACTOR_BPS = 1_000;
    /// 50% — max fraction of debt liquidator may repay in one call
    uint256 public constant CLOSE_FACTOR_BPS = 5_000;
    /// cirBTC has 8 decimals
    uint256 public constant COLLATERAL_DECIMALS = 1e8;
    /// USDC has 6 decimals
    uint256 public constant USDC_DECIMALS = 1e6;

    // ───── Immutable refs ─────
    IERC20 public immutable usdc;
    IERC20 public immutable cirBtc;
    AUsdc public immutable aToken;
    address public deployer; // initial owner (governance)

    // ───── Governance-mutable ─────
    address public owner;
    IInterestRateModel public irm;
    IPriceAdapter public priceAdapter;
    bool public paused;

    // ───── Accrual state ─────
    uint256 public supplyIndex;        // 1e18-scaled, starts at WAD
    uint256 public borrowIndex;        // 1e18-scaled, starts at WAD
    uint256 public scaledTotalBorrows; // sum of scaled borrows (principal × WAD / borrowIndex_at_borrow)
    uint256 public totalReserves;      // USDC owed to protocol, captured from interest
    uint256 public lastAccrualTime;    // unix seconds

    // ───── Per-user state ─────
    /// User's cirBTC deposit (in raw 8-decimal units).
    mapping(address => uint256) public collateral;
    /// User's scaled borrow principal: actualDebt = scaledBorrow × borrowIndex / 1e18.
    mapping(address => uint256) public scaledBorrow;

    // ───── Events ─────
    event Deposited(address indexed user, uint256 usdcAmount, uint256 sharesMinted);
    event Withdrew(address indexed user, uint256 sharesBurned, uint256 usdcAmount);
    event CollateralDeposited(address indexed user, uint256 cirBtcAmount);
    event CollateralWithdrew(address indexed user, uint256 cirBtcAmount);
    event Borrowed(address indexed user, uint256 usdcAmount);
    event Repaid(address indexed payer, address indexed user, uint256 usdcAmount);
    event Liquidated(
        address indexed liquidator,
        address indexed borrower,
        uint256 usdcRepaid,
        uint256 cirBtcSeized,
        uint256 bonusBtc
    );
    event InterestAccrued(uint256 dt, uint256 newBorrowIndex, uint256 newSupplyIndex, uint256 reservesAdded);
    event ReservesWithdrawn(address indexed to, uint256 amount);
    event IRMSet(address indexed prev, address indexed next);
    event PriceAdapterSet(address indexed prev, address indexed next);
    event OwnerTransferred(address indexed prev, address indexed next);
    event PausedSet(bool paused);

    // ───── Reentrancy guard ─────
    uint256 private _entered; // 0=open, 1=entered
    modifier nonReentrant() {
        require(_entered == 0, "Pool: reentrancy");
        _entered = 1;
        _;
        _entered = 0;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Pool: not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Pool: paused");
        _;
    }

    constructor(address _usdc, address _cirBtc, address _irm, address _priceAdapter) {
        require(_usdc != address(0), "Pool: zero usdc");
        require(_cirBtc != address(0), "Pool: zero cirBtc");
        require(_irm != address(0), "Pool: zero irm");
        require(_priceAdapter != address(0), "Pool: zero adapter");

        usdc = IERC20(_usdc);
        cirBtc = IERC20(_cirBtc);
        irm = IInterestRateModel(_irm);
        priceAdapter = IPriceAdapter(_priceAdapter);

        deployer = msg.sender;
        owner = msg.sender;

        // AUsdc binds its pool to its deployer (this contract) in its
        // constructor. So the pool IS the only minter, by construction.
        aToken = new AUsdc();

        supplyIndex = WAD;
        borrowIndex = WAD;
        lastAccrualTime = block.timestamp;

        emit OwnerTransferred(address(0), msg.sender);
    }

    // ═════════════════════════════════════════════════════════════════════
    // ═ Governance
    // ═════════════════════════════════════════════════════════════════════

    function transferOwnership(address next) external onlyOwner {
        require(next != address(0), "Pool: zero next owner");
        emit OwnerTransferred(owner, next);
        owner = next;
    }

    function setIRM(address next) external onlyOwner {
        require(next != address(0), "Pool: zero irm");
        _accrueInterest();
        emit IRMSet(address(irm), next);
        irm = IInterestRateModel(next);
    }

    function setPriceAdapter(address next) external onlyOwner {
        require(next != address(0), "Pool: zero adapter");
        emit PriceAdapterSet(address(priceAdapter), next);
        priceAdapter = IPriceAdapter(next);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedSet(_paused);
    }

    function withdrawReserves(address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "Pool: zero to");
        _accrueInterest();
        require(amount <= totalReserves, "Pool: amount > reserves");
        totalReserves -= amount;
        require(usdc.transfer(to, amount), "Pool: usdc xfer");
        emit ReservesWithdrawn(to, amount);
    }

    // ═════════════════════════════════════════════════════════════════════
    // ═ Supply side (lenders)
    // ═════════════════════════════════════════════════════════════════════

    function deposit(uint256 usdcAmount) external nonReentrant whenNotPaused {
        require(usdcAmount > 0, "Pool: zero amount");
        _accrueInterest();

        // mint shares before pulling tokens, so the index doesn't shift mid-call.
        uint256 shares = (usdcAmount * WAD) / supplyIndex;
        require(shares > 0, "Pool: dust deposit");

        require(usdc.transferFrom(msg.sender, address(this), usdcAmount), "Pool: usdc pull");
        aToken.mint(msg.sender, shares);

        emit Deposited(msg.sender, usdcAmount, shares);
    }

    function withdraw(uint256 shares) external nonReentrant {
        require(shares > 0, "Pool: zero shares");
        _accrueInterest();

        uint256 usdcAmount = (shares * supplyIndex) / WAD;
        require(usdcAmount > 0, "Pool: dust withdraw");
        require(usdcAmount <= _availableCash(), "Pool: insufficient cash");

        aToken.burn(msg.sender, shares);
        require(usdc.transfer(msg.sender, usdcAmount), "Pool: usdc xfer");

        emit Withdrew(msg.sender, shares, usdcAmount);
    }

    /// USDC value of `user`'s aUSDC at current supplyIndex (view-only,
    /// does NOT accrue — for accurate value, call after any state op).
    function balanceOfUnderlying(address user) external view returns (uint256) {
        return (aToken.balanceOf(user) * supplyIndex) / WAD;
    }

    // ═════════════════════════════════════════════════════════════════════
    // ═ Borrow side
    // ═════════════════════════════════════════════════════════════════════

    function depositCollateral(uint256 cirBtcAmount) external nonReentrant whenNotPaused {
        require(cirBtcAmount > 0, "Pool: zero amount");
        // No accrual needed: collateral changes don't affect borrow/supply indexes.

        require(
            cirBtc.transferFrom(msg.sender, address(this), cirBtcAmount),
            "Pool: cirBtc pull"
        );
        collateral[msg.sender] += cirBtcAmount;

        emit CollateralDeposited(msg.sender, cirBtcAmount);
    }

    function withdrawCollateral(uint256 cirBtcAmount) external nonReentrant {
        require(cirBtcAmount > 0, "Pool: zero amount");
        _accrueInterest();

        uint256 bal = collateral[msg.sender];
        require(cirBtcAmount <= bal, "Pool: exceeds collateral");

        // Tentatively reduce collateral; re-check health factor.
        collateral[msg.sender] = bal - cirBtcAmount;
        require(_healthFactor(msg.sender) >= WAD, "Pool: would be unhealthy");

        require(cirBtc.transfer(msg.sender, cirBtcAmount), "Pool: cirBtc xfer");
        emit CollateralWithdrew(msg.sender, cirBtcAmount);
    }

    function borrow(uint256 usdcAmount) external nonReentrant whenNotPaused {
        require(usdcAmount > 0, "Pool: zero amount");
        require(usdcAmount <= _availableCash(), "Pool: insufficient cash");
        _accrueInterest();

        // Add scaled debt to user's principal, then verify the new LTV is OK.
        uint256 newScaled = (usdcAmount * WAD) / borrowIndex;
        require(newScaled > 0, "Pool: dust borrow");

        scaledBorrow[msg.sender] += newScaled;
        scaledTotalBorrows += newScaled;

        // Check that user is under MAX_LTV_BPS post-borrow.
        uint256 collateralUsd = _collateralValueUsdc(msg.sender);
        uint256 debtUsd = _userDebtUsdc(msg.sender);
        require(
            debtUsd * 10_000 <= collateralUsd * MAX_LTV_BPS,
            "Pool: exceeds LTV"
        );

        require(usdc.transfer(msg.sender, usdcAmount), "Pool: usdc xfer");
        emit Borrowed(msg.sender, usdcAmount);
    }

    /**
     * Repay USDC on behalf of `user`. `msg.sender` pays; the credit goes to
     * `user`. Use `user == msg.sender` for self-repay (the common case).
     *
     * Pass `type(uint256).max` to repay the FULL outstanding debt at this
     * moment. We re-read debt after accrual and clamp.
     */
    function repay(address user, uint256 usdcAmount) external nonReentrant {
        require(user != address(0), "Pool: zero user");
        _accrueInterest();

        uint256 currentDebt = (scaledBorrow[user] * borrowIndex) / WAD;
        if (currentDebt == 0) return;

        uint256 repayAmount = usdcAmount > currentDebt ? currentDebt : usdcAmount;
        require(repayAmount > 0, "Pool: zero repay");

        uint256 scaledRepay = (repayAmount * WAD) / borrowIndex;
        if (scaledRepay > scaledBorrow[user]) scaledRepay = scaledBorrow[user];

        scaledBorrow[user] -= scaledRepay;
        scaledTotalBorrows -= scaledRepay;

        require(usdc.transferFrom(msg.sender, address(this), repayAmount), "Pool: usdc pull");
        emit Repaid(msg.sender, user, repayAmount);
    }

    // ═════════════════════════════════════════════════════════════════════
    // ═ Liquidation
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Liquidate an unhealthy borrower: pay up to CLOSE_FACTOR_BPS of their
     * outstanding debt in USDC, receive equivalent cirBTC + LIQUIDATION_BONUS_BPS.
     *
     * Anyone may call. `repayUsdc` is the amount the liquidator wants to repay;
     * we clamp it to the close factor.
     *
     * Reverts if borrower is healthy (HF ≥ 1). On success, borrower's debt
     * decreases by repayUsdc and collateral decreases by the seized cirBTC.
     */
    function liquidate(address borrower, uint256 repayUsdc) external nonReentrant {
        require(borrower != msg.sender, "Pool: self-liquidate");
        require(repayUsdc > 0, "Pool: zero repay");
        _accrueInterest();

        require(_healthFactor(borrower) < WAD, "Pool: healthy");

        uint256 fullDebt = (scaledBorrow[borrower] * borrowIndex) / WAD;
        uint256 maxRepay = (fullDebt * CLOSE_FACTOR_BPS) / 10_000;
        uint256 actualRepay = repayUsdc > maxRepay ? maxRepay : repayUsdc;
        require(actualRepay > 0, "Pool: nothing to liquidate");

        // Seize collateral worth (actualRepay × (1 + bonus)) in USD.
        // cirBtcAmount = usdValue × 1e8 / priceWad   [scaling derivation below]
        //
        // priceWad is USD per 1 cirBTC at 1e18-scale.
        // actualRepay is USDC at 6 decimals = USD × 1e6.
        // We want cirBtcAmount at 8 decimals.
        //   usdValue1e18  = actualRepay × 1e12          (USDC to 1e18-USD)
        //   bonusFactor   = (10_000 + bonus) / 10_000   (in bps)
        //   usdValueAfter = usdValue1e18 × (10_000 + bonus) / 10_000
        //   cirBtc8       = usdValueAfter × 1e8 / priceWad
        uint256 priceWad = priceAdapter.getPrice();
        require(priceWad > 0, "Pool: bad price");

        uint256 usdValue1e18 = actualRepay * 1e12;
        uint256 grossedUp = (usdValue1e18 * (10_000 + LIQUIDATION_BONUS_BPS)) / 10_000;
        uint256 cirBtcToSeize = (grossedUp * COLLATERAL_DECIMALS) / priceWad;
        uint256 bonusBtcOnly = (cirBtcToSeize * LIQUIDATION_BONUS_BPS) / (10_000 + LIQUIDATION_BONUS_BPS);

        require(cirBtcToSeize <= collateral[borrower], "Pool: seize > collateral");

        // Apply state changes.
        uint256 scaledRepay = (actualRepay * WAD) / borrowIndex;
        if (scaledRepay > scaledBorrow[borrower]) scaledRepay = scaledBorrow[borrower];
        scaledBorrow[borrower] -= scaledRepay;
        scaledTotalBorrows -= scaledRepay;
        collateral[borrower] -= cirBtcToSeize;

        // Move funds. USDC IN from liquidator, cirBTC OUT to liquidator.
        require(usdc.transferFrom(msg.sender, address(this), actualRepay), "Pool: usdc pull");
        require(cirBtc.transfer(msg.sender, cirBtcToSeize), "Pool: cirBtc xfer");

        emit Liquidated(msg.sender, borrower, actualRepay, cirBtcToSeize, bonusBtcOnly);
    }

    // ═════════════════════════════════════════════════════════════════════
    // ═ Internal: interest accrual
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Brings supplyIndex and borrowIndex forward to block.timestamp.
     *
     * Per-second linear approximation (small dt → effectively continuous):
     *   borrowRate  = irm.getBorrowRatePerSecond(cash, actualBorrows, reserves)
     *   interest    = actualBorrows × borrowRate × dt / 1e18
     *   reserveCut  = interest × RESERVE_FACTOR_BPS / 10_000
     *   lendersCut  = interest − reserveCut
     *
     *   newBorrowIndex = borrowIndex × (1e18 + borrowRate × dt) / 1e18
     *   totalReserves  += reserveCut
     *
     *   The supplyIndex tracks USDC-per-share for lenders. New supplyIndex
     *   is computed from the increased pool value attributable to lenders:
     *     totalShares      = aToken.totalSupply
     *     oldLenderValue   = totalShares × supplyIndex / 1e18
     *     newLenderValue   = oldLenderValue + lendersCut
     *     newSupplyIndex   = newLenderValue × 1e18 / totalShares
     *
     *   If totalShares == 0 we still advance borrowIndex (so existing
     *   borrowers' debt keeps growing if somehow there are borrows without
     *   suppliers — shouldn't happen, but guard against div-by-zero).
     */
    function _accrueInterest() internal {
        uint256 dt = block.timestamp - lastAccrualTime;
        if (dt == 0) return;

        uint256 cash = _availableCash();
        uint256 actualBorrows = (scaledTotalBorrows * borrowIndex) / WAD;

        if (actualBorrows == 0) {
            // No debt → nothing to accrue, just bump the timestamp so future
            // accruals don't double-count this gap when a borrow appears.
            lastAccrualTime = block.timestamp;
            emit InterestAccrued(dt, borrowIndex, supplyIndex, 0);
            return;
        }

        uint256 ratePerSecond = irm.getBorrowRatePerSecond(cash, actualBorrows, totalReserves);
        // interest = actualBorrows × rate × dt / 1e18
        uint256 interest = (actualBorrows * ratePerSecond * dt) / WAD;

        // Bump borrowIndex multiplicatively: new = old × (actualBorrows + interest) / actualBorrows.
        // Equivalent to: borrowIndex × (1e18 + rate × dt) / 1e18.
        // (Algebraically identical, computed this way to avoid a second mulDiv.)
        uint256 newBorrowIndex = borrowIndex + (borrowIndex * ratePerSecond * dt) / WAD;

        uint256 reserveCut = (interest * RESERVE_FACTOR_BPS) / 10_000;
        uint256 lendersCut = interest - reserveCut;
        totalReserves += reserveCut;

        uint256 totalShares = aToken.totalSupply();
        uint256 newSupplyIndex = supplyIndex;
        if (totalShares > 0) {
            uint256 oldLenderValue = (totalShares * supplyIndex) / WAD;
            uint256 newLenderValue = oldLenderValue + lendersCut;
            newSupplyIndex = (newLenderValue * WAD) / totalShares;
        }

        borrowIndex = newBorrowIndex;
        supplyIndex = newSupplyIndex;
        lastAccrualTime = block.timestamp;

        emit InterestAccrued(dt, newBorrowIndex, newSupplyIndex, reserveCut);
    }

    // ═════════════════════════════════════════════════════════════════════
    // ═ Internal: math
    // ═════════════════════════════════════════════════════════════════════

    /// Cash available to lend: pool USDC balance minus reserves (which are
    /// owed to the protocol and not part of the lendable pool).
    function _availableCash() internal view returns (uint256) {
        uint256 bal = usdc.balanceOf(address(this));
        if (bal <= totalReserves) return 0;
        return bal - totalReserves;
    }

    /**
     * Collateral USD value for `user`, in USDC 6-decimal units.
     *
     *   collateralUsdc6 = cirBtc8 × priceWad / 1e8 / 1e12
     *                   = cirBtc8 × priceWad / 1e20
     *
     * Returns 0 if user has no collateral or oracle returns 0 (shouldn't
     * happen — adapter reverts on bad price).
     */
    function _collateralValueUsdc(address user) internal view returns (uint256) {
        uint256 bal = collateral[user];
        if (bal == 0) return 0;
        uint256 priceWad = priceAdapter.getPrice();
        return (bal * priceWad) / 1e20;
    }

    /// User's current debt, scaled to USDC 6-decimal units.
    function _userDebtUsdc(address user) internal view returns (uint256) {
        return (scaledBorrow[user] * borrowIndex) / WAD;
    }

    /**
     * Health factor: 1e18-scaled. Equal to 1.0 (= WAD) at the liquidation
     * boundary, above 1 when healthy, below 1 when liquidatable.
     *
     *   HF = (collateralValueUsd × LIQUIDATION_THRESHOLD_BPS) / debt / 10_000
     *
     * If debt == 0, HF is +∞; we return type(uint256).max as the saturated
     * representation so off-chain consumers can compare safely.
     */
    function _healthFactor(address user) internal view returns (uint256) {
        uint256 debt = _userDebtUsdc(user);
        if (debt == 0) return type(uint256).max;
        uint256 collat = _collateralValueUsdc(user);
        // HF = (collat × LT × 1e18) / (debt × 10000)
        return (collat * LIQUIDATION_THRESHOLD_BPS * WAD) / (debt * 10_000);
    }

    // ═════════════════════════════════════════════════════════════════════
    // ═ Public views
    // ═════════════════════════════════════════════════════════════════════

    function healthFactor(address user) external view returns (uint256) {
        return _healthFactor(user);
    }

    function collateralValueUsdc(address user) external view returns (uint256) {
        return _collateralValueUsdc(user);
    }

    function userDebtUsdc(address user) external view returns (uint256) {
        return _userDebtUsdc(user);
    }

    function availableCash() external view returns (uint256) {
        return _availableCash();
    }

    function totalBorrows() external view returns (uint256) {
        return (scaledTotalBorrows * borrowIndex) / WAD;
    }

    function maxBorrow(address user) external view returns (uint256) {
        uint256 collat = _collateralValueUsdc(user);
        uint256 capByLtv = (collat * MAX_LTV_BPS) / 10_000;
        uint256 currentDebt = _userDebtUsdc(user);
        if (capByLtv <= currentDebt) return 0;
        uint256 headroom = capByLtv - currentDebt;
        uint256 cash = _availableCash();
        return headroom < cash ? headroom : cash;
    }
}
