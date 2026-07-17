// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LendingPool} from "../src/lending/LendingPool.sol";
import {InterestRateModel} from "../src/lending/InterestRateModel.sol";
import {RevenueRegistry} from "../src/credit/RevenueRegistry.sol";
import {CreditController} from "../src/credit/CreditController.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPriceAdapter} from "./mocks/MockPriceAdapter.sol";
import {MockRevenueProofVerifier} from "./mocks/MockRevenueProofVerifier.sol";

/**
 * CreditController — opens an unsecured credit line on LendingPool from a ZK
 * revenue proof verified against a registered Merkle root. The proof verifier
 * is mocked (the real bb-generated verifier drops in via setVerifier); these
 * tests cover the full on-chain integration: registry gating, proof gating,
 * policy mapping, and borrowing against the granted line.
 */
contract CreditControllerTest is Test {
    LendingPool internal pool;
    MockERC20 internal usdc;
    MockERC20 internal cirBtc;
    InterestRateModel internal irm;
    MockPriceAdapter internal oracle;
    RevenueRegistry internal registry;
    MockRevenueProofVerifier internal verifier;
    CreditController internal controller;

    address internal lender = address(0xA11CE);
    address internal borrower = address(0xB0B);
    address internal stranger = address(0xDEAD);

    bytes internal proof = hex"01"; // opaque; the mock ignores it
    bytes32 internal root = keccak256("epoch-1");
    uint64 internal wf = 1000;
    uint64 internal wt = 2000;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        cirBtc = new MockERC20("Circle BTC", "cirBTC", 8);
        irm = new InterestRateModel(0, 0.8e18, 0.04e18, 1.0e18);
        oracle = new MockPriceAdapter(50_000e18);
        pool = new LendingPool(address(usdc), address(cirBtc), address(irm), address(oracle));

        registry = new RevenueRegistry(address(this)); // issuer = test contract
        verifier = new MockRevenueProofVerifier();
        // 0.5x revenue, $5k cap, 30-day term, min 3 distinct payers.
        controller = new CreditController(
            address(pool), address(registry), address(verifier), 5_000, 5_000e6, 30 days, 3
        );

        pool.setUnderwriter(address(controller));
        registry.postRoot(root);

        usdc.mint(lender, 1_000_000e6);
    }

    function _open(uint256 provenRevenue, uint256 provenPayers) internal returns (uint256 limit) {
        (limit, ) = controller.openCreditLine(proof, root, borrower, provenRevenue, provenPayers, wf, wt);
    }

    function test_OpenCreditLine_SetsLimitOnPool() public {
        uint256 limit = _open(600e6, 4);
        assertEq(limit, 300e6, "0.5x of proven revenue");
        assertEq(pool.creditLimitUsdc(borrower), 300e6, "limit stored on pool");
        assertEq(pool.activeCredit(borrower), 300e6, "active");
    }

    function test_OpenCreditLine_CapApplied() public {
        uint256 limit = _open(20_000e6, 9); // 0.5x = 10k, capped to 5k
        assertEq(limit, 5_000e6, "capped");
    }

    function test_OpenCreditLine_RevertUnknownRoot() public {
        vm.expectRevert(bytes("Credit: unknown root"));
        controller.openCreditLine(proof, keccak256("nope"), borrower, 600e6, 4, wf, wt);
    }

    function test_OpenCreditLine_RevertInvalidProof() public {
        verifier.setResult(false);
        vm.expectRevert(bytes("Credit: invalid proof"));
        _open(600e6, 4);
    }

    function test_OpenCreditLine_RevertPayersTooFew() public {
        vm.expectRevert(bytes("Credit: payers too few"));
        _open(600e6, 2); // < minDistinctPayers (3)
    }

    function test_OpenCreditLine_RevertWhenControllerNotUnderwriter() public {
        // A controller that the pool has not authorized cannot set limits.
        CreditController rogue = new CreditController(
            address(pool), address(registry), address(verifier), 5_000, 5_000e6, 30 days, 3
        );
        vm.expectRevert(bytes("Pool: not underwriter"));
        rogue.openCreditLine(proof, root, borrower, 600e6, 4, wf, wt);
    }

    function test_Integration_BorrowAgainstZkLine() public {
        // Lender funds the pool.
        vm.startPrank(lender);
        usdc.approve(address(pool), 100_000e6);
        pool.deposit(100_000e6);
        vm.stopPrank();

        _open(600e6, 4); // 300e6 line

        vm.prank(borrower);
        pool.borrow(300e6);
        assertEq(pool.userDebtUsdc(borrower), 300e6, "borrowed against ZK credit line");
        assertEq(usdc.balanceOf(borrower), 300e6, "received funds");
    }

    function test_SetVerifier_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("Credit: not owner"));
        controller.setVerifier(address(verifier));
    }
}
