// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LendingPool} from "../src/lending/LendingPool.sol";
import {AUsdc} from "../src/lending/AUsdc.sol";
import {InterestRateModel} from "../src/lending/InterestRateModel.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPriceAdapter} from "./mocks/MockPriceAdapter.sol";

contract LendingPoolTest is Test {
    LendingPool internal pool;
    AUsdc internal aToken;
    MockERC20 internal usdc; // 6 decimals
    MockERC20 internal cirBtc; // 8 decimals
    InterestRateModel internal irm;
    MockPriceAdapter internal oracle;

    address internal lender = address(0xA11CE);
    address internal borrower = address(0xB0B);
    address internal liquidator = address(0x110D);
    address internal stranger = address(0xDEAD);

    // $50,000 per cirBTC, 1e18-scaled.
    uint256 internal constant BTC = 50_000e18;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        cirBtc = new MockERC20("Circle BTC", "cirBTC", 8);
        // base 0%, kink 80%, slope1 4% APR, slope2 100% APR.
        irm = new InterestRateModel(0, 0.8e18, 0.04e18, 1.0e18);
        oracle = new MockPriceAdapter(BTC);
        pool = new LendingPool(address(usdc), address(cirBtc), address(irm), address(oracle));
        aToken = pool.aToken();

        usdc.mint(lender, 1_000_000e6);
        usdc.mint(borrower, 1_000_000e6);
        usdc.mint(liquidator, 1_000_000e6);
        cirBtc.mint(borrower, 100e8);
    }

    // ---------- helpers ----------

    function _supply(address who, uint256 amount) internal {
        vm.startPrank(who);
        usdc.approve(address(pool), amount);
        pool.deposit(amount);
        vm.stopPrank();
    }

    function _addCollateral(address who, uint256 amount) internal {
        vm.startPrank(who);
        cirBtc.approve(address(pool), amount);
        pool.depositCollateral(amount);
        vm.stopPrank();
    }

    function _borrow(address who, uint256 amount) internal {
        vm.prank(who);
        pool.borrow(amount);
    }

    // ---------- supply side ----------

    function test_Deposit_MintsSharesAndPullsUsdc() public {
        _supply(lender, 1_000e6);
        // supplyIndex starts at WAD, so 1 USDC -> 1 share at issuance.
        assertEq(aToken.balanceOf(lender), 1_000e6, "shares");
        assertEq(pool.balanceOfUnderlying(lender), 1_000e6, "underlying");
        assertEq(usdc.balanceOf(address(pool)), 1_000e6, "pool cash");
        assertEq(pool.availableCash(), 1_000e6, "available cash");
    }

    function test_Deposit_RevertWhenZero() public {
        vm.prank(lender);
        vm.expectRevert(bytes("Pool: zero amount"));
        pool.deposit(0);
    }

    function test_Withdraw_BurnsSharesReturnsUsdc() public {
        _supply(lender, 1_000e6);
        uint256 before = usdc.balanceOf(lender);
        vm.prank(lender);
        pool.withdraw(400e6);
        assertEq(aToken.balanceOf(lender), 600e6, "remaining shares");
        assertEq(usdc.balanceOf(lender) - before, 400e6, "usdc returned");
    }

    function test_Withdraw_RevertWhenInsufficientCash() public {
        _supply(lender, 1_000e6);
        _addCollateral(borrower, 1e8);
        _borrow(borrower, 800e6); // pool cash now 200e6
        vm.prank(lender);
        vm.expectRevert(bytes("Pool: insufficient cash"));
        pool.withdraw(1_000e6);
    }

    // ---------- collateral ----------

    function test_DepositCollateral_Tracks() public {
        _addCollateral(borrower, 2e8);
        assertEq(pool.collateral(borrower), 2e8);
        assertEq(cirBtc.balanceOf(address(pool)), 2e8);
    }

    function test_WithdrawCollateral_NoDebt() public {
        _addCollateral(borrower, 1e8);
        vm.prank(borrower);
        pool.withdrawCollateral(1e8);
        assertEq(pool.collateral(borrower), 0);
        assertEq(cirBtc.balanceOf(borrower), 100e8);
    }

    function test_WithdrawCollateral_RevertWhenWouldBeUnhealthy() public {
        _supply(lender, 100_000e6);
        _addCollateral(borrower, 1e8); // $50k
        _borrow(borrower, 30_000e6);
        vm.prank(borrower);
        vm.expectRevert(bytes("Pool: would be unhealthy"));
        pool.withdrawCollateral(1e8); // removing all collateral with debt open
    }

    // ---------- borrow ----------

    function test_Borrow_UpToMaxLtv() public {
        _supply(lender, 100_000e6);
        _addCollateral(borrower, 1e8); // $50k -> max 80% = $40k
        uint256 before = usdc.balanceOf(borrower);
        _borrow(borrower, 40_000e6);
        assertEq(pool.userDebtUsdc(borrower), 40_000e6, "debt");
        assertEq(usdc.balanceOf(borrower) - before, 40_000e6, "usdc received");
    }

    function test_Borrow_RevertWhenExceedsLtv() public {
        _supply(lender, 100_000e6);
        _addCollateral(borrower, 1e8); // $50k
        vm.prank(borrower);
        vm.expectRevert(bytes("Pool: exceeds LTV"));
        pool.borrow(40_000e6 + 1e6); // $40,001 > 80%
    }

    function test_Borrow_RevertWhenInsufficientCash() public {
        _supply(lender, 1_000e6);
        _addCollateral(borrower, 1e8); // plenty of collateral
        vm.prank(borrower);
        vm.expectRevert(bytes("Pool: insufficient cash"));
        pool.borrow(2_000e6);
    }

    // ---------- repay ----------

    function test_Repay_Self() public {
        _supply(lender, 100_000e6);
        _addCollateral(borrower, 1e8);
        _borrow(borrower, 10_000e6);
        vm.startPrank(borrower);
        usdc.approve(address(pool), 10_000e6);
        pool.repay(borrower, 10_000e6);
        vm.stopPrank();
        assertEq(pool.userDebtUsdc(borrower), 0);
    }

    function test_Repay_OnBehalf() public {
        _supply(lender, 100_000e6);
        _addCollateral(borrower, 1e8);
        _borrow(borrower, 10_000e6);
        vm.startPrank(liquidator); // third party repays
        usdc.approve(address(pool), 10_000e6);
        pool.repay(borrower, 10_000e6);
        vm.stopPrank();
        assertEq(pool.userDebtUsdc(borrower), 0);
    }

    function test_Repay_MaxClampsToOutstandingDebt() public {
        _supply(lender, 100_000e6);
        _addCollateral(borrower, 1e8);
        _borrow(borrower, 10_000e6);
        uint256 before = usdc.balanceOf(borrower);
        vm.startPrank(borrower);
        usdc.approve(address(pool), type(uint256).max);
        pool.repay(borrower, type(uint256).max);
        vm.stopPrank();
        assertEq(pool.userDebtUsdc(borrower), 0, "debt cleared");
        assertEq(before - usdc.balanceOf(borrower), 10_000e6, "only debt pulled");
    }

    // ---------- interest accrual ----------

    function test_InterestAccrual_GrowsDebtSupplyAndReserves() public {
        _supply(lender, 100_000e6);
        _addCollateral(borrower, 10e8); // ample collateral
        _borrow(borrower, 40_000e6); // 40% utilization -> 2% APR

        uint256 debt0 = pool.userDebtUsdc(borrower);
        uint256 lenderVal0 = pool.balanceOfUnderlying(lender);
        uint256 bi0 = pool.borrowIndex();

        vm.warp(block.timestamp + 365 days);
        pool.withdrawReserves(address(this), 0); // poke: accrues without moving funds

        assertGt(pool.borrowIndex(), bi0, "borrowIndex grew");
        assertGt(pool.userDebtUsdc(borrower), debt0, "debt grew");
        assertGt(pool.balanceOfUnderlying(lender), lenderVal0, "lender value grew");
        assertGt(pool.totalReserves(), 0, "reserves captured");

        // ~2% APR over one year on a $40k loan.
        assertApproxEqRel(pool.userDebtUsdc(borrower), 40_800e6, 0.01e18);
    }

    // ---------- liquidation ----------

    function test_Liquidate_SeizesCollateralWithBonus() public {
        _supply(lender, 100_000e6);
        _addCollateral(borrower, 1e8); // $50k
        _borrow(borrower, 40_000e6); // HF = 50k*0.9/40k = 1.125

        oracle.setPrice(40_000e18); // collateral now $40k -> HF = 0.9 < 1
        assertLt(pool.healthFactor(borrower), 1e18, "unhealthy");

        uint256 repay = 20_000e6; // 50% close factor of $40k debt
        vm.startPrank(liquidator);
        usdc.approve(address(pool), repay);
        pool.liquidate(borrower, repay);
        vm.stopPrank();

        // seize = repay * (1 + 5%) / price = 20k * 1.05 / 40k = 0.525 cirBTC
        assertEq(cirBtc.balanceOf(liquidator), 52_500_000, "cirBTC seized + bonus");
        assertEq(pool.collateral(borrower), 1e8 - 52_500_000, "collateral reduced");
        assertEq(pool.userDebtUsdc(borrower), 20_000e6, "debt halved");
    }

    function test_Liquidate_RevertWhenHealthy() public {
        _supply(lender, 100_000e6);
        _addCollateral(borrower, 1e8);
        _borrow(borrower, 20_000e6); // HF = 2.25
        vm.startPrank(liquidator);
        usdc.approve(address(pool), 10_000e6);
        vm.expectRevert(bytes("Pool: healthy"));
        pool.liquidate(borrower, 10_000e6);
        vm.stopPrank();
    }

    function test_Liquidate_RevertOnSelfLiquidate() public {
        vm.prank(borrower);
        vm.expectRevert(bytes("Pool: self-liquidate"));
        pool.liquidate(borrower, 1e6);
    }

    // ---------- health factor ----------

    function test_HealthFactor_NoDebtIsMax() public {
        _addCollateral(borrower, 1e8);
        assertEq(pool.healthFactor(borrower), type(uint256).max);
    }

    // ---------- pause ----------

    function test_Paused_BlocksEntriesAllowsExits() public {
        _supply(lender, 1_000e6);
        pool.setPaused(true);

        vm.startPrank(lender);
        usdc.approve(address(pool), 100e6);
        vm.expectRevert(bytes("Pool: paused"));
        pool.deposit(100e6);
        vm.stopPrank();

        // withdraw is not gated by whenNotPaused — users can always exit.
        vm.prank(lender);
        pool.withdraw(100e6);
        assertEq(aToken.balanceOf(lender), 900e6);
    }

    // ---------- governance ----------

    function test_SetPaused_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("Pool: not owner"));
        pool.setPaused(true);
    }

    function test_WithdrawReserves_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("Pool: not owner"));
        pool.withdrawReserves(stranger, 0);
    }

    function test_WithdrawReserves_TransfersAccrued() public {
        _supply(lender, 100_000e6);
        _addCollateral(borrower, 10e8);
        _borrow(borrower, 40_000e6);
        vm.warp(block.timestamp + 365 days);
        pool.withdrawReserves(address(this), 0); // accrue

        uint256 reserves = pool.totalReserves();
        assertGt(reserves, 0);

        uint256 before = usdc.balanceOf(address(this));
        pool.withdrawReserves(address(this), reserves);
        assertEq(usdc.balanceOf(address(this)) - before, reserves, "reserves paid out");
        assertEq(pool.totalReserves(), 0, "reserves drained");
    }

    function test_WithdrawReserves_RevertWhenExceedsReserves() public {
        vm.expectRevert(bytes("Pool: amount > reserves"));
        pool.withdrawReserves(address(this), 1);
    }

    function test_TransferOwnership_MovesControl() public {
        pool.transferOwnership(stranger);
        assertEq(pool.owner(), stranger);
        vm.expectRevert(bytes("Pool: not owner"));
        pool.setPaused(true);
    }
}
