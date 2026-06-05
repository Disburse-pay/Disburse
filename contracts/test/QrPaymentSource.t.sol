// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {QrPaymentSource} from "../src/QrPaymentSource.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract QrPaymentSourceTest is Test {
    event QrPaymentInitiated(
        bytes32 indexed requestId,
        address indexed payer,
        address indexed recipient,
        address token,
        uint256 amount,
        uint256 destinationChainId,
        uint256 nonce
    );

    QrPaymentSource internal source;
    MockERC20 internal token;

    address internal payer = address(0xCAFE);
    address internal recipient = address(0xBEEF);
    address internal stranger = address(0xDEAD);
    uint256 internal destChainId = 5_042_002; // Arc Testnet
    uint256 internal expiresAt;

    function setUp() public {
        source = new QrPaymentSource();
        token = new MockERC20("USD Coin", "USDC", 6);
        token.mint(payer, 1_000_000e6);
        vm.prank(payer);
        token.approve(address(source), type(uint256).max);
        expiresAt = block.timestamp + 1 hours;
    }

    function _pay(bytes32 requestId, uint256 amount, uint256 nonce) internal {
        vm.prank(payer);
        source.pay(requestId, recipient, address(token), amount, destChainId, expiresAt, nonce);
    }

    function test_Pay_EscrowsAndEmits() public {
        bytes32 requestId = keccak256("req-1");
        uint256 amount = 250e6;

        vm.expectEmit(true, true, true, true);
        emit QrPaymentInitiated(requestId, payer, recipient, address(token), amount, destChainId, 7);

        _pay(requestId, amount, 7);

        assertEq(token.balanceOf(address(source)), amount, "escrowed");
        assertEq(token.balanceOf(payer), 1_000_000e6 - amount, "payer debited");
        assertTrue(source.paidRequests(requestId), "request flagged");
    }

    function test_Pay_RevertOnReplay() public {
        bytes32 requestId = keccak256("req-1");
        _pay(requestId, 10e6, 1);
        vm.prank(payer);
        vm.expectRevert(bytes("request already paid"));
        source.pay(requestId, recipient, address(token), 10e6, destChainId, expiresAt, 1);
    }

    function test_Pay_RevertSameChainRoute() public {
        vm.prank(payer);
        vm.expectRevert(bytes("same-chain route"));
        source.pay(keccak256("r"), recipient, address(token), 10e6, block.chainid, expiresAt, 1);
    }

    function test_Pay_RevertWhenExpired() public {
        // Use fixed literals for now/deadline. Deriving the deadline from
        // block.timestamp and then vm.warp-ing past it is unreliable under
        // viaIR, which caches block.timestamp across the cheatcode.
        vm.warp(10_000);
        vm.prank(payer);
        vm.expectRevert(bytes("request expired"));
        source.pay(keccak256("r"), recipient, address(token), 10e6, destChainId, 9_999, 1);
    }

    function test_Pay_RevertZeroAmount() public {
        vm.prank(payer);
        vm.expectRevert(bytes("invalid amount"));
        source.pay(keccak256("r"), recipient, address(token), 0, destChainId, expiresAt, 1);
    }

    function test_Pay_RevertZeroRecipient() public {
        vm.prank(payer);
        vm.expectRevert(bytes("invalid recipient"));
        source.pay(keccak256("r"), address(0), address(token), 10e6, destChainId, expiresAt, 1);
    }

    function test_Sweep_OnlyOwner() public {
        token.mint(address(source), 500e6);
        vm.prank(stranger);
        vm.expectRevert(bytes("not owner"));
        source.sweep(address(token), stranger, 500e6);
    }

    function test_Sweep_TransfersToTreasury() public {
        token.mint(address(source), 500e6);
        address treasury = address(0x7EA5);
        source.sweep(address(token), treasury, 500e6); // this contract is owner
        assertEq(token.balanceOf(treasury), 500e6);
    }

    function test_TransferOwnership_MovesControl() public {
        address newOwner = address(0x0044);
        source.transferOwnership(newOwner);
        assertEq(source.owner(), newOwner);
        vm.expectRevert(bytes("not owner"));
        source.sweep(address(token), newOwner, 0);
    }
}
