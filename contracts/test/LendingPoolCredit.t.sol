// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LendingPool} from "../src/lending/LendingPool.sol";
import {AUsdc} from "../src/lending/AUsdc.sol";
import {InterestRateModel} from "../src/lending/InterestRateModel.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPriceAdapter} from "./mocks/MockPriceAdapter.sol";

/**
 * Unsecured, revenue-backed credit lines on LendingPool.
 *
 * A governance-set `underwriter` grants per-borrower credit limits. Active
 * credit adds to the borrow allowance AND the health factor, so a borrower
 * cannot be liquidated for credit-backed debt while the line is live. Once a
 * line expires or is defaulted, the credit contributes nothing — and because a
 * pure-credit borrower has no collateral, there is nothing for liquidators to
 * seize (default recovery is the underwriter's job, off-chain).
 */
contract LendingPoolCreditTest is Test {
    LendingPool internal pool;
    AUsdc internal aToken;
    MockERC20 internal usdc; // 6 decimals
    MockERC20 internal cirBtc; // 8 decimals
    InterestRateModel internal irm;
    MockPriceAdapter internal oracle;

    address internal lender = address(0xA11CE);
    address internal borrower = address(0xB0B);
    address internal liquidator = address(0x110D);
    address internal underwriter = address(0xC0DE);
    address internal stranger = address(0xDEAD);

    // $50,000 per cirBTC, 1e18-scaled.
    uint256 internal constant BTC = 50_000e18;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        cirBtc = new MockERC20("Circle BTC", "cirBTC", 8);
        irm = new InterestRateModel(0, 0.8e18, 0.04e18, 1.0e18);
        oracle = new MockPriceAdapter(BTC);
        pool = new LendingPool(address(usdc), address(cirBtc), address(irm), address(oracle));
        aToken = pool.aToken();

        // The test contract deployed the pool, so it is `owner`; wire the
        // underwriter so credit lines can be granted.
        pool.setUnderwriter(underwriter);

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

    function _grantCredit(address who, uint256 amount, uint64 expiry) internal {
        vm.prank(underwriter);
        pool.setCreditLimit(who, amount, expiry);
    }

    function _in30Days() internal view returns (uint64) {
        return uint64(block.timestamp + 30 days);
    }

    // ---------- borrow against credit ----------

    function test_Borrow_AgainstCreditNoCollateral() public {
        _supply(lender, 100_000e6);
        _grantCredit(borrower, 10_000e6, _in30Days());

        uint256 before = usdc.balanceOf(borrower);
        _borrow(borrower, 10_000e6);

        assertEq(pool.userDebtUsdc(borrower), 10_000e6, "debt");
        assertEq(usdc.balanceOf(borrower) - before, 10_000e6, "usdc received");
        assertEq(pool.collateral(borrower), 0, "no collateral posted");
    }

    function test_Borrow_RevertWhenExceedsCreditLimit() public {
        _supply(lender, 100_000e6);
        _grantCredit(borrower, 10_000e6, _in30Days());

        vm.prank(borrower);
        vm.expectRevert(bytes("Pool: exceeds LTV"));
        pool.borrow(10_000e6 + 1e6);
    }

    function test_Borrow_RevertWhenCreditExpired() public {
        _supply(lender, 100_000e6);
        _grantCredit(borrower, 10_000e6, uint64(block.timestamp + 1 days));

        vm.warp(block.timestamp + 2 days);
        vm.prank(borrower);
        vm.expectRevert(bytes("Pool: exceeds LTV"));
        pool.borrow(1_000e6);
    }

    function test_Borrow_CreditPlusCollateralCompose() public {
        _supply(lender, 200_000e6);
        _addCollateral(borrower, 1e8); // $50k -> $40k at MAX_LTV
        _grantCredit(borrower, 10_000e6, _in30Days());

        // $40k collateral allowance + $10k credit = $50k.
        _borrow(borrower, 50_000e6);
        assertEq(pool.userDebtUsdc(borrower), 50_000e6, "combined debt");
    }

    function test_Borrow_RevertWhenOverCombinedAllowance() public {
        _supply(lender, 200_000e6);
        _addCollateral(borrower, 1e8);
        _grantCredit(borrower, 10_000e6, _in30Days());

        vm.prank(borrower);
        vm.expectRevert(bytes("Pool: exceeds LTV"));
        pool.borrow(50_000e6 + 1e6);
    }

    function test_Repay_RestoresCreditHeadroom() public {
        _supply(lender, 100_000e6);
        _grantCredit(borrower, 10_000e6, _in30Days());
        _borrow(borrower, 10_000e6);

        vm.startPrank(borrower);
        usdc.approve(address(pool), 5_000e6);
        pool.repay(borrower, 5_000e6);
        pool.borrow(5_000e6); // headroom freed by the repayment
        vm.stopPrank();

        assertEq(pool.userDebtUsdc(borrower), 10_000e6, "back to full line");
    }

    // ---------- health factor / liquidation ----------

    function test_CreditBorrower_NotLiquidatableWhileActive() public {
        _supply(lender, 100_000e6);
        _grantCredit(borrower, 10_000e6, _in30Days());
        _borrow(borrower, 10_000e6);

        // HF = activeCredit / debt = 1.0 → healthy.
        assertGe(pool.healthFactor(borrower), 1e18, "healthy while credit active");

        vm.startPrank(liquidator);
        usdc.approve(address(pool), 5_000e6);
        vm.expectRevert(bytes("Pool: healthy"));
        pool.liquidate(borrower, 5_000e6);
        vm.stopPrank();
    }

    function test_DefaultedCredit_NoCollateralToSeize() public {
        _supply(lender, 100_000e6);
        _grantCredit(borrower, 10_000e6, _in30Days());
        _borrow(borrower, 6_000e6);

        vm.prank(underwriter);
        pool.markCreditDefault(borrower);

        // Unhealthy now (no active credit, no collateral) but there is nothing
        // to seize — credit defaults are recovered off-chain, not via liquidate.
        assertLt(pool.healthFactor(borrower), 1e18, "unhealthy after default");

        vm.startPrank(liquidator);
        usdc.approve(address(pool), 3_000e6);
        vm.expectRevert(bytes("Pool: seize > collateral"));
        pool.liquidate(borrower, 3_000e6);
        vm.stopPrank();
    }

    // ---------- limit lifecycle ----------

    function test_MarkCreditDefault_FreezesLineButDebtRemains() public {
        _supply(lender, 100_000e6);
        _grantCredit(borrower, 10_000e6, _in30Days());
        _borrow(borrower, 6_000e6);

        vm.prank(underwriter);
        pool.markCreditDefault(borrower);

        assertEq(pool.activeCredit(borrower), 0, "credit frozen");
        assertEq(pool.userDebtUsdc(borrower), 6_000e6, "debt remains owed");

        vm.prank(borrower);
        vm.expectRevert(bytes("Pool: exceeds LTV"));
        pool.borrow(1e6);
    }

    function test_ActiveCredit_ExpiresAndMaxBorrowDrops() public {
        _supply(lender, 100_000e6);
        _grantCredit(borrower, 10_000e6, uint64(block.timestamp + 1 days));

        assertEq(pool.activeCredit(borrower), 10_000e6, "active before expiry");
        assertEq(pool.maxBorrow(borrower), 10_000e6, "borrowable before expiry");

        vm.warp(block.timestamp + 2 days);
        assertEq(pool.activeCredit(borrower), 0, "inactive after expiry");
        assertEq(pool.maxBorrow(borrower), 0, "no capacity after expiry");
    }

    // ---------- access control ----------

    function test_SetUnderwriter_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("Pool: not owner"));
        pool.setUnderwriter(stranger);
    }

    function test_SetUnderwriter_UpdatesAddress() public {
        pool.setUnderwriter(stranger);
        assertEq(pool.underwriter(), stranger);
    }

    function test_SetCreditLimit_OnlyUnderwriter() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("Pool: not underwriter"));
        pool.setCreditLimit(borrower, 1_000e6, _in30Days());
    }

    function test_SetCreditLimit_RevertZeroUser() public {
        vm.prank(underwriter);
        vm.expectRevert(bytes("Pool: zero user"));
        pool.setCreditLimit(address(0), 1_000e6, _in30Days());
    }

    function test_MarkCreditDefault_OnlyUnderwriter() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("Pool: not underwriter"));
        pool.markCreditDefault(borrower);
    }

    function test_SetCreditLimit_RevertWhenUnderwriterUnset() public {
        // Fresh pool with no underwriter configured — credit is disabled.
        LendingPool fresh = new LendingPool(address(usdc), address(cirBtc), address(irm), address(oracle));
        vm.prank(underwriter);
        vm.expectRevert(bytes("Pool: not underwriter"));
        fresh.setCreditLimit(borrower, 1_000e6, _in30Days());
    }

    // ---------- origination fee ----------

    function test_OriginationFee_ChargedOnCreditDrawAndRetained() public {
        _supply(lender, 100_000e6);
        pool.setOriginationFeeBps(100); // 1%
        _grantCredit(borrower, 10_000e6, _in30Days());

        uint256 before = usdc.balanceOf(borrower);
        _borrow(borrower, 10_000e6); // fully credit-funded

        // fee = 1% of 10,000 = 100; borrower receives 9,900 but owes 10,000.
        assertEq(usdc.balanceOf(borrower) - before, 9_900e6, "net of fee");
        assertEq(pool.userDebtUsdc(borrower), 10_000e6, "owes gross");
        assertEq(pool.totalReserves(), 100e6, "fee retained as reserves");
    }

    function test_OriginationFee_OnlyOnCreditPortionNotCollateral() public {
        _supply(lender, 200_000e6);
        pool.setOriginationFeeBps(100); // 1%
        _addCollateral(borrower, 1e8); // $50k -> $40k collateral allowance
        _grantCredit(borrower, 10_000e6, _in30Days());

        uint256 before = usdc.balanceOf(borrower);
        _borrow(borrower, 50_000e6); // 40k collateral + 10k credit

        // Fee charged only on the 10k credit slice: 1% = 100.
        assertEq(usdc.balanceOf(borrower) - before, 49_900e6, "fee only on credit slice");
        assertEq(pool.totalReserves(), 100e6, "reserves");
    }

    function test_OriginationFee_NotChargedForCollateralOnly() public {
        _supply(lender, 200_000e6);
        pool.setOriginationFeeBps(100);
        _addCollateral(borrower, 1e8); // $50k

        uint256 before = usdc.balanceOf(borrower);
        _borrow(borrower, 40_000e6); // entirely collateral-backed

        assertEq(usdc.balanceOf(borrower) - before, 40_000e6, "no fee on collateral borrow");
        assertEq(pool.totalReserves(), 0, "no reserves captured");
    }

    function test_SetOriginationFee_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("Pool: not owner"));
        pool.setOriginationFeeBps(100);
    }

    function test_SetOriginationFee_RevertAboveCap() public {
        vm.expectRevert(bytes("Pool: fee too high"));
        pool.setOriginationFeeBps(1_001); // > MAX_ORIGINATION_FEE_BPS (1000)
    }
}
