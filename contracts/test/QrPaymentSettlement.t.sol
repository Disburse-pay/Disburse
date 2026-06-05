// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {QrPaymentSettlement} from "../src/QrPaymentSettlement.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockProver} from "./mocks/MockProver.sol";

contract QrPaymentSettlementTest is Test {
    // Mirror of the contract event so we can use vm.expectEmit.
    event QrPaymentSettled(
        bytes32 indexed settlementId,
        bytes32 indexed requestId,
        address indexed recipient,
        uint32 sourceChainId,
        address payer,
        address sourceToken,
        address destinationToken,
        uint256 amount,
        uint256 nonce
    );

    QrPaymentSettlement internal settlement;
    MockProver internal prover;
    MockERC20 internal usdc;

    address internal recipient = address(0xBEEF);
    address internal payer = address(0xCAFE);
    address internal sourceContract = address(0x500A11CE);
    address internal sourceToken = address(0x70CE7);
    address internal stranger = address(0xDEAD);
    uint32 internal sourceChainId = 84_532; // Base Sepolia

    function setUp() public {
        prover = new MockProver();
        settlement = new QrPaymentSettlement(address(prover));
        usdc = new MockERC20("USD Coin", "USDC", 6);

        settlement.setAllowedSource(sourceChainId, sourceContract, true);
        settlement.setTokenRoute(sourceChainId, sourceToken, address(usdc));
        usdc.mint(address(settlement), 1_000_000e6);
    }

    // ---------- proof construction helpers ----------

    function _topics(bytes32 selector, bytes32 requestId, address payer_, address recipient_)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(
            selector, requestId, bytes32(uint256(uint160(payer_))), bytes32(uint256(uint160(recipient_)))
        );
    }

    function _proof(
        address srcContract,
        bytes32 requestId,
        address srcToken,
        uint256 amount,
        uint256 destChainId,
        uint256 nonce
    ) internal view returns (bytes memory) {
        bytes memory topics =
            _topics(settlement.QR_PAYMENT_INITIATED_SELECTOR(), requestId, payer, recipient);
        bytes memory unindexed = abi.encode(srcToken, amount, destChainId, nonce);
        return abi.encode(sourceChainId, srcContract, topics, unindexed);
    }

    function _validProof(bytes32 requestId, uint256 amount, uint256 nonce)
        internal
        view
        returns (bytes memory)
    {
        return _proof(sourceContract, requestId, sourceToken, amount, block.chainid, nonce);
    }

    function _expectedSettlementId(bytes32 requestId, uint256 amount, uint256 nonce)
        internal
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                sourceChainId,
                sourceContract,
                requestId,
                payer,
                recipient,
                sourceToken,
                address(usdc),
                amount,
                nonce
            )
        );
    }

    // ---------- settle: happy path ----------

    function test_Settle_TransfersAndMarksSettled() public {
        bytes32 requestId = keccak256("req-1");
        uint256 amount = 100e6;

        bytes32 expectedId = _expectedSettlementId(requestId, amount, 1);
        vm.expectEmit(true, true, true, true);
        emit QrPaymentSettled(
            expectedId, requestId, recipient, sourceChainId, payer, sourceToken, address(usdc), amount, 1
        );

        bytes32 settlementId = settlement.settle(_validProof(requestId, amount, 1));

        assertEq(settlementId, expectedId, "returned settlementId");
        assertEq(usdc.balanceOf(recipient), amount, "recipient paid");
        assertTrue(settlement.settled(settlementId), "settled flag set");
        assertTrue(settlement.settledRequests(requestId), "request flag set");
    }

    // ---------- settle: reverts ----------

    function test_Settle_RevertWhenSourceUnauthorized() public {
        bytes memory proof = _proof(stranger, keccak256("r"), sourceToken, 1e6, block.chainid, 1);
        vm.expectRevert(bytes("unauthorized source"));
        settlement.settle(proof);
    }

    function test_Settle_RevertAfterSourceRevoked() public {
        settlement.setAllowedSource(sourceChainId, sourceContract, false);
        // Build the proof before arming expectRevert: _validProof makes an
        // external getter call (QR_PAYMENT_INITIATED_SELECTOR) that would
        // otherwise be consumed as the "next call".
        bytes memory proof = _validProof(keccak256("r"), 1e6, 1);
        vm.expectRevert(bytes("unauthorized source"));
        settlement.settle(proof);
    }

    function test_Settle_RevertWhenTopicsLengthWrong() public {
        // Only 3 words (96 bytes) instead of the required 4 (128 bytes).
        bytes memory badTopics = abi.encodePacked(
            settlement.QR_PAYMENT_INITIATED_SELECTOR(), keccak256("r"), bytes32(uint256(uint160(payer)))
        );
        bytes memory unindexed = abi.encode(sourceToken, uint256(1e6), block.chainid, uint256(1));
        bytes memory proof = abi.encode(sourceChainId, sourceContract, badTopics, unindexed);
        vm.expectRevert(bytes("invalid topics"));
        settlement.settle(proof);
    }

    function test_Settle_RevertWhenEventSelectorWrong() public {
        bytes memory topics = _topics(keccak256("WrongEvent(uint256)"), keccak256("r"), payer, recipient);
        bytes memory unindexed = abi.encode(sourceToken, uint256(1e6), block.chainid, uint256(1));
        bytes memory proof = abi.encode(sourceChainId, sourceContract, topics, unindexed);
        vm.expectRevert(bytes("invalid event"));
        settlement.settle(proof);
    }

    function test_Settle_RevertWhenWrongDestinationChain() public {
        bytes memory proof =
            _proof(sourceContract, keccak256("r"), sourceToken, 1e6, block.chainid + 1, 1);
        vm.expectRevert(bytes("wrong destination"));
        settlement.settle(proof);
    }

    function test_Settle_RevertWhenTokenRouteMissing() public {
        address unrouted = address(0xABCD);
        bytes memory proof = _proof(sourceContract, keccak256("r"), unrouted, 1e6, block.chainid, 1);
        vm.expectRevert(bytes("unsupported token route"));
        settlement.settle(proof);
    }

    function test_Settle_RevertOnReplay() public {
        bytes memory proof = _validProof(keccak256("req-replay"), 10e6, 1);
        settlement.settle(proof);
        vm.expectRevert(bytes("request already settled"));
        settlement.settle(proof);
    }

    function test_Settle_RevertWhenTokenTransferFails() public {
        usdc.setTransferShouldFail(true);
        bytes memory proof = _validProof(keccak256("r"), 10e6, 1);
        vm.expectRevert(bytes("settlement transfer failed"));
        settlement.settle(proof);
    }

    // ---------- admin ----------

    function test_Constructor_RevertZeroProver() public {
        vm.expectRevert(bytes("invalid prover"));
        new QrPaymentSettlement(address(0));
    }

    function test_SetAllowedSource_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("not owner"));
        settlement.setAllowedSource(sourceChainId, sourceContract, true);
    }

    function test_SetAllowedSource_RevertZeroSource() public {
        vm.expectRevert(bytes("invalid source"));
        settlement.setAllowedSource(sourceChainId, address(0), true);
    }

    function test_SetTokenRoute_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("not owner"));
        settlement.setTokenRoute(sourceChainId, sourceToken, address(usdc));
    }

    function test_SetTokenRoute_RevertZeroSourceToken() public {
        vm.expectRevert(bytes("invalid source token"));
        settlement.setTokenRoute(sourceChainId, address(0), address(usdc));
    }

    function test_SetTokenRoute_RevertZeroDestinationToken() public {
        vm.expectRevert(bytes("invalid destination token"));
        settlement.setTokenRoute(sourceChainId, sourceToken, address(0));
    }

    function test_TransferOwnership_TwoStep() public {
        address newOwner = address(0x0044);

        // Step 1: nominate. Owner does not change yet.
        settlement.transferOwnership(newOwner);
        assertEq(settlement.owner(), address(this), "owner unchanged until accepted");
        assertEq(settlement.pendingOwner(), newOwner, "pending set");

        // Old owner still in control before acceptance.
        settlement.setAllowedSource(sourceChainId, sourceContract, false);

        // Step 2: nominee accepts.
        vm.prank(newOwner);
        settlement.acceptOwnership();
        assertEq(settlement.owner(), newOwner, "owner moved");
        assertEq(settlement.pendingOwner(), address(0), "pending cleared");

        // Old owner can no longer administer; new owner can.
        vm.expectRevert(bytes("not owner"));
        settlement.setAllowedSource(sourceChainId, sourceContract, true);
        vm.prank(newOwner);
        settlement.setAllowedSource(sourceChainId, sourceContract, true);
    }

    function test_AcceptOwnership_OnlyPending() public {
        settlement.transferOwnership(address(0x0044));
        vm.prank(stranger);
        vm.expectRevert(bytes("not pending owner"));
        settlement.acceptOwnership();
    }

    function test_TransferOwnership_RevertZero() public {
        vm.expectRevert(bytes("invalid owner"));
        settlement.transferOwnership(address(0));
    }

    // ---------- pause (circuit breaker) ----------

    function test_Settle_RevertWhenPaused() public {
        settlement.setPaused(true);
        bytes memory proof = _validProof(keccak256("r"), 10e6, 1);
        vm.expectRevert(bytes("paused"));
        settlement.settle(proof);
    }

    function test_Unpause_RestoresSettlement() public {
        settlement.setPaused(true);
        settlement.setPaused(false);
        settlement.settle(_validProof(keccak256("r"), 10e6, 1));
        assertEq(usdc.balanceOf(recipient), 10e6);
    }

    function test_SetPaused_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("not owner"));
        settlement.setPaused(true);
    }

    // ---------- rescue (recover prefunded liquidity) ----------

    function test_RescueTokens_OwnerRecoversLiquidity() public {
        address treasury = address(0x7EA5);
        uint256 balBefore = usdc.balanceOf(address(settlement));
        settlement.rescueTokens(address(usdc), treasury, 100_000e6);
        assertEq(usdc.balanceOf(treasury), 100_000e6, "treasury funded");
        assertEq(usdc.balanceOf(address(settlement)), balBefore - 100_000e6, "pool drawn down");
    }

    function test_RescueTokens_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("not owner"));
        settlement.rescueTokens(address(usdc), stranger, 1);
    }

    function test_RescueTokens_RevertZeroToken() public {
        vm.expectRevert(bytes("invalid token"));
        settlement.rescueTokens(address(0), recipient, 1);
    }

    function test_RescueTokens_RevertZeroRecipient() public {
        vm.expectRevert(bytes("invalid recipient"));
        settlement.rescueTokens(address(usdc), address(0), 1);
    }
}
