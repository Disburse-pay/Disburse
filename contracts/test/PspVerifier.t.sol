// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PspVerifier} from "../src/PspVerifier.sol";

contract MockPspSettlement {
    mapping(bytes32 settlementId => bool confirmed) public settled;

    function setSettled(bytes32 settlementId, bool confirmed) external {
        settled[settlementId] = confirmed;
    }
}

contract PspVerifierTest is Test {
    uint256 private constant ISSUER_KEY = 0xA11CE;
    uint256 private constant SECOND_ISSUER_KEY = 0xB0B;
    bytes32 private constant SETTLEMENT_ID = keccak256("settlement-one");
    bytes32 private constant SECOND_SETTLEMENT_ID =
        keccak256("settlement-two");

    address private issuer;
    address private secondIssuer;
    MockPspSettlement private settlement;
    MockPspSettlement private secondSettlement;
    PspVerifier private verifier;

    function setUp() public {
        vm.chainId(5_042_002);
        issuer = vm.addr(ISSUER_KEY);
        secondIssuer = vm.addr(SECOND_ISSUER_KEY);
        settlement = new MockPspSettlement();
        secondSettlement = new MockPspSettlement();
        verifier = new PspVerifier(address(settlement), issuer);
        settlement.setSettled(SETTLEMENT_ID, true);
    }

    function testDeploymentRejectsUnsupportedChain() public {
        vm.chainId(1);
        vm.expectRevert("unsupported chain");
        new PspVerifier(address(settlement), issuer);
    }

    function testSignedMainnetLabelIsRejectedOnArcTestnet() public {
        PspVerifier.PspFields memory fields = _settlementFields(
            address(settlement),
            1,
            SETTLEMENT_ID
        );
        fields.networkMode = "mainnet";
        bytes memory signature = _sign(fields, ISSUER_KEY);

        (bool ok, address recovered) = verifier.verifySettlementClaim(
            fields,
            signature
        );
        assertFalse(ok);
        assertEq(recovered, address(0));
    }

    function testSettlementClaimAuthenticatesAllFields() public {
        PspVerifier.PspFields memory fields = _settlementFields(
            address(settlement),
            1,
            SETTLEMENT_ID
        );
        bytes memory signature = _sign(verifier, fields, ISSUER_KEY);

        (bool ok, address recovered) = verifier.verifySettlementClaim(
            fields,
            signature
        );

        assertTrue(ok);
        assertEq(recovered, issuer);
    }

    function testExposesV2DomainFingerprint() public view {
        assertEq(verifier.VERIFIER_VERSION(), 2);
        assertEq(
            verifier.PSP_FIELDS_TYPEHASH(),
            keccak256(
                "PspFields(bytes32 documentDigest,string networkMode,string verificationMode,address settlementContract,uint64 settlementRegistryVersion,bytes32 settlementId,address invoicePayer,address invoiceRecipient,string invoiceToken,string invoiceAmount,string requestId,uint256 settlementChainId,bytes32 settlementTxHash)"
            )
        );
        assertTrue(verifier.domainSeparator() != bytes32(0));
    }

    function testAnyPspFieldTamperingInvalidatesClaim() public {
        PspVerifier.PspFields memory original = _settlementFields(
            address(settlement),
            1,
            SETTLEMENT_ID
        );
        bytes memory signature = _sign(verifier, original, ISSUER_KEY);
        bytes32 originalHash = verifier.hashPspFields(original);
        PspVerifier.PspFields memory tampered;

        tampered = _settlementFields(address(settlement), 1, SETTLEMENT_ID);
        tampered.documentDigest = keccak256("other document");
        _assertTamperRejected(originalHash, tampered, signature);

        tampered = _settlementFields(address(settlement), 1, SETTLEMENT_ID);
        tampered.networkMode = "mainnet";
        _assertTamperRejected(originalHash, tampered, signature);

        tampered = _settlementFields(address(settlement), 1, SETTLEMENT_ID);
        tampered.verificationMode = "direct-signature-only";
        _assertTamperRejected(originalHash, tampered, signature);

        tampered = _settlementFields(address(secondSettlement), 1, SETTLEMENT_ID);
        _assertTamperRejected(originalHash, tampered, signature);

        tampered = _settlementFields(address(settlement), 2, SETTLEMENT_ID);
        _assertTamperRejected(originalHash, tampered, signature);

        tampered = _settlementFields(
            address(settlement),
            1,
            SECOND_SETTLEMENT_ID
        );
        _assertTamperRejected(originalHash, tampered, signature);

        tampered = _settlementFields(address(settlement), 1, SETTLEMENT_ID);
        tampered.invoicePayer = address(0x1234);
        _assertTamperRejected(originalHash, tampered, signature);

        tampered = _settlementFields(address(settlement), 1, SETTLEMENT_ID);
        tampered.invoiceRecipient = address(0x5678);
        _assertTamperRejected(originalHash, tampered, signature);

        tampered = _settlementFields(address(settlement), 1, SETTLEMENT_ID);
        tampered.invoiceToken = "EURC";
        _assertTamperRejected(originalHash, tampered, signature);

        tampered = _settlementFields(address(settlement), 1, SETTLEMENT_ID);
        tampered.invoiceAmount = "999.00";
        _assertTamperRejected(originalHash, tampered, signature);

        tampered = _settlementFields(address(settlement), 1, SETTLEMENT_ID);
        tampered.requestId = "other-request";
        _assertTamperRejected(originalHash, tampered, signature);

        tampered = _settlementFields(address(settlement), 1, SETTLEMENT_ID);
        tampered.settlementChainId = block.chainid + 1;
        _assertTamperRejected(originalHash, tampered, signature);

        tampered = _settlementFields(address(settlement), 1, SETTLEMENT_ID);
        tampered.settlementTxHash = keccak256("other tx");
        _assertTamperRejected(originalHash, tampered, signature);
    }

    function testFullVerificationRejectsZeroSettlementId() public {
        PspVerifier.PspFields memory fields = _settlementFields(
            address(settlement),
            1,
            bytes32(0)
        );
        bytes memory signature = _sign(verifier, fields, ISSUER_KEY);

        (bool ok, ) = verifier.verifySettlementClaim(fields, signature);

        assertFalse(ok);
    }

    function testDirectVerificationHasExplicitReducedScope() public {
        PspVerifier.PspFields memory fields = _settlementFields(
            address(0x3600000000000000000000000000000000000000),
            0,
            SETTLEMENT_ID
        );
        fields.verificationMode = "direct-signature-only";
        bytes memory signature = _sign(verifier, fields, ISSUER_KEY);

        (bool directOk, address recovered) = verifier.verifyDirectClaim(
            fields,
            signature
        );
        (bool fullOk, ) = verifier.verifySettlementClaim(fields, signature);

        assertTrue(directOk);
        assertEq(recovered, issuer);
        assertFalse(fullOk);
    }

    function testSettlementRegistrySupportsMigrationWithoutInvalidatingOldProofs()
        public
    {
        uint64 secondVersion = verifier.registerSettlement(
            address(secondSettlement)
        );
        assertEq(secondVersion, 2);
        secondSettlement.setSettled(SECOND_SETTLEMENT_ID, true);

        PspVerifier.PspFields memory oldFields = _settlementFields(
            address(settlement),
            1,
            SETTLEMENT_ID
        );
        PspVerifier.PspFields memory newFields = _settlementFields(
            address(secondSettlement),
            secondVersion,
            SECOND_SETTLEMENT_ID
        );

        (bool oldOk, ) = verifier.verifySettlementClaim(
            oldFields,
            _sign(verifier, oldFields, ISSUER_KEY)
        );
        (bool newOk, ) = verifier.verifySettlementClaim(
            newFields,
            _sign(verifier, newFields, ISSUER_KEY)
        );

        assertTrue(oldOk);
        assertTrue(newOk);
    }

    function testRejectsRepeatedIssuerAndSettlementRegistration() public {
        vm.expectRevert("issuer already registered");
        verifier.registerIssuer(issuer);

        vm.expectRevert("settlement already registered");
        verifier.registerSettlement(address(settlement));
    }

    function testRejectsMalformedRegistryEntriesAndSignature() public {
        vm.expectRevert("invalid issuer");
        verifier.registerIssuer(address(0));

        vm.expectRevert("settlement has no code");
        verifier.registerSettlement(address(0xBEEF));

        PspVerifier.PspFields memory fields = _settlementFields(
            address(settlement),
            1,
            SETTLEMENT_ID
        );
        (bool ok, address recovered) = verifier.verifySettlementClaim(
            fields,
            hex"1234"
        );
        assertFalse(ok);
        assertEq(recovered, address(0));
    }

    function testClaimCannotReplayAgainstAnotherVerifier() public {
        PspVerifier secondVerifier = new PspVerifier(
            address(settlement),
            issuer
        );
        PspVerifier.PspFields memory fields = _settlementFields(
            address(settlement),
            1,
            SETTLEMENT_ID
        );
        bytes memory signature = _sign(verifier, fields, ISSUER_KEY);

        (bool ok, ) = secondVerifier.verifySettlementClaim(fields, signature);

        assertFalse(ok);
    }

    function testOwnershipTransferRequiresAcceptance() public {
        address newOwner = address(0xCAFE);

        verifier.transferOwnership(newOwner);
        assertEq(verifier.owner(), address(this));
        assertEq(verifier.pendingOwner(), newOwner);

        vm.prank(newOwner);
        verifier.acceptOwnership();
        assertEq(verifier.owner(), newOwner);
        assertEq(verifier.pendingOwner(), address(0));
    }

    function testCanDisableTrustRootsForEmergencyRevocation() public {
        verifier.setIssuerEnabled(issuer, false);
        assertFalse(verifier.trustedIssuers(issuer));

        verifier.setSettlementEnabled(address(settlement), false);
        (, bool enabled) = verifier.settlementRegistrations(
            address(settlement)
        );
        assertFalse(enabled);
    }

    function testIssuerRegistrySupportsNonDestructiveRotation() public {
        verifier.registerIssuer(secondIssuer);
        PspVerifier.PspFields memory fields = _settlementFields(
            address(settlement),
            1,
            SETTLEMENT_ID
        );
        bytes memory firstSignature = _sign(verifier, fields, ISSUER_KEY);
        bytes memory secondSignature = _sign(
            verifier,
            fields,
            SECOND_ISSUER_KEY
        );

        (bool firstOk, ) = verifier.verifySettlementClaim(
            fields,
            firstSignature
        );
        (bool secondOk, ) = verifier.verifySettlementClaim(
            fields,
            secondSignature
        );

        assertTrue(firstOk);
        assertTrue(secondOk);
    }

    function _assertTamperRejected(
        bytes32 originalHash,
        PspVerifier.PspFields memory tampered,
        bytes memory signature
    ) private view {
        assertNotEq(verifier.hashPspFields(tampered), originalHash);
        (bool ok, ) = verifier.verifySettlementClaim(tampered, signature);
        assertFalse(ok);
    }

    function _settlementFields(
        address settlementContract,
        uint64 registryVersion,
        bytes32 settlementId
    ) private view returns (PspVerifier.PspFields memory) {
        return
            PspVerifier.PspFields({
                documentDigest: keccak256("canonical psp document"),
                networkMode: "testnet",
                verificationMode: "settlement",
                settlementContract: settlementContract,
                settlementRegistryVersion: registryVersion,
                settlementId: settlementId,
                invoicePayer: address(0x1111),
                invoiceRecipient: address(0x2222),
                invoiceToken: "USDC",
                invoiceAmount: "10.00",
                requestId: "request-1",
                settlementChainId: block.chainid,
                settlementTxHash: keccak256("settlement tx")
            });
    }

    function _sign(
        PspVerifier target,
        PspVerifier.PspFields memory fields,
        uint256 privateKey
    ) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            privateKey,
            target.hashPspFields(fields)
        );
        return abi.encodePacked(r, s, v);
    }
}
