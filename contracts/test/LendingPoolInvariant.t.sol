// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LendingPool} from "../src/lending/LendingPool.sol";
import {AUsdc} from "../src/lending/AUsdc.sol";
import {InterestRateModel} from "../src/lending/InterestRateModel.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPriceAdapter} from "./mocks/MockPriceAdapter.sol";

/**
 * Drives the pool with a bounded random sequence of actions across a small set
 * of actors. Every action is wrapped in try/catch so legitimate reverts (e.g.
 * borrowing past the LTV) don't abort the run; we only care about the
 * accounting invariants that must hold no matter the path taken.
 */
contract LendingHandler is Test {
    LendingPool internal pool;
    MockERC20 internal usdc;
    MockERC20 internal cirBtc;
    address[] internal actors;
    address internal currentActor;

    constructor(LendingPool _pool, MockERC20 _usdc, MockERC20 _cirBtc, address[] memory _actors) {
        pool = _pool;
        usdc = _usdc;
        cirBtc = _cirBtc;
        actors = _actors;
    }

    modifier useActor(uint256 seed) {
        currentActor = actors[seed % actors.length];
        vm.startPrank(currentActor);
        _;
        vm.stopPrank();
    }

    function supply(uint256 seed, uint256 amount) external useActor(seed) {
        amount = bound(amount, 0, 100_000e6);
        usdc.approve(address(pool), amount);
        try pool.deposit(amount) {} catch {}
    }

    function withdraw(uint256 seed, uint256 shares) external useActor(seed) {
        uint256 bal = pool.aToken().balanceOf(currentActor);
        if (bal == 0) return;
        shares = bound(shares, 1, bal);
        try pool.withdraw(shares) {} catch {}
    }

    function addCollateral(uint256 seed, uint256 amount) external useActor(seed) {
        amount = bound(amount, 0, 10e8);
        cirBtc.approve(address(pool), amount);
        try pool.depositCollateral(amount) {} catch {}
    }

    function borrow(uint256 seed, uint256 amount) external useActor(seed) {
        amount = bound(amount, 0, 50_000e6);
        try pool.borrow(amount) {} catch {}
    }

    function repay(uint256 seed, uint256 amount) external useActor(seed) {
        amount = bound(amount, 0, 50_000e6);
        usdc.approve(address(pool), amount);
        try pool.repay(currentActor, amount) {} catch {}
    }

    function warpTime(uint256 secs) external {
        secs = bound(secs, 0, 30 days);
        vm.warp(block.timestamp + secs);
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function actorAt(uint256 i) external view returns (address) {
        return actors[i];
    }
}

contract LendingPoolInvariantTest is Test {
    LendingPool internal pool;
    MockERC20 internal usdc;
    MockERC20 internal cirBtc;
    InterestRateModel internal irm;
    MockPriceAdapter internal oracle;
    LendingHandler internal handler;

    address[] internal actors;
    uint256 internal lastBorrowIndex;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        cirBtc = new MockERC20("Circle BTC", "cirBTC", 8);
        irm = new InterestRateModel(0, 0.8e18, 0.04e18, 1.0e18);
        oracle = new MockPriceAdapter(50_000e18);
        pool = new LendingPool(address(usdc), address(cirBtc), address(irm), address(oracle));

        actors.push(address(0xA1));
        actors.push(address(0xA2));
        actors.push(address(0xA3));
        for (uint256 i; i < actors.length; i++) {
            usdc.mint(actors[i], 1_000_000e6);
            cirBtc.mint(actors[i], 100e8);
        }

        handler = new LendingHandler(pool, usdc, cirBtc, actors);
        lastBorrowIndex = pool.borrowIndex();

        // Only fuzz the handler's action functions.
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = handler.supply.selector;
        selectors[1] = handler.withdraw.selector;
        selectors[2] = handler.addCollateral.selector;
        selectors[3] = handler.borrow.selector;
        selectors[4] = handler.repay.selector;
        selectors[5] = handler.warpTime.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    /// The pool's accounting total for scaled borrows must always equal the
    /// sum of every actor's scaled borrow — they are maintained in lockstep.
    function invariant_ScaledBorrowsSumConsistent() public view {
        uint256 sum;
        for (uint256 i; i < actors.length; i++) {
            sum += pool.scaledBorrow(actors[i]);
        }
        assertEq(sum, pool.scaledTotalBorrows());
    }

    /// aUSDC totalSupply must equal the sum of holder balances — no shares are
    /// minted or burned outside the deposit/withdraw paths.
    function invariant_ShareSupplyConsistent() public view {
        AUsdc a = pool.aToken();
        uint256 sum;
        for (uint256 i; i < actors.length; i++) {
            sum += a.balanceOf(actors[i]);
        }
        assertEq(sum, a.totalSupply());
    }

    /// The borrow index is the debt accumulator; interest accrual can only ever
    /// move it forward, never backward.
    function invariant_BorrowIndexMonotonic() public {
        uint256 bi = pool.borrowIndex();
        assertGe(bi, lastBorrowIndex);
        lastBorrowIndex = bi;
    }
}
