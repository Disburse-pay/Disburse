// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title PspVerifier
 * @notice View-only verifier for payment Portable Settlement Proof claims.
 *
 * Version 2 removes caller-supplied digests. Issuers sign an EIP-712 PspFields
 * struct whose domain is bound to this contract and chain. Every field consumed
 * by verification is therefore authenticated.
 *
 * Settlement contracts and issuers are registries, not immutable singletons.
 * A new settlement deployment receives a monotonically increasing version so
 * old and new proofs can remain verifiable during a migration.
 */

interface IQrPaymentSettlement {
    function settled(bytes32 settlementId) external view returns (bool);
}

contract PspVerifier {
    uint256 public constant VERIFIER_VERSION = 2;
    uint256 public constant ARC_TESTNET_CHAIN_ID = 5_042_002;

    struct PspFields {
        bytes32 documentDigest;
        string networkMode;
        string verificationMode;
        address settlementContract;
        uint64 settlementRegistryVersion;
        bytes32 settlementId;
        address invoicePayer;
        address invoiceRecipient;
        string invoiceToken;
        string invoiceAmount;
        string requestId;
        uint256 settlementChainId;
        bytes32 settlementTxHash;
    }

    struct SettlementRegistration {
        uint64 version;
        bool enabled;
    }

    bytes32 public constant PSP_FIELDS_TYPEHASH = keccak256(
        "PspFields(bytes32 documentDigest,string networkMode,string verificationMode,address settlementContract,uint64 settlementRegistryVersion,bytes32 settlementId,address invoicePayer,address invoiceRecipient,string invoiceToken,string invoiceAmount,string requestId,uint256 settlementChainId,bytes32 settlementTxHash)"
    );
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("Disburse PSP Verifier");
    bytes32 private constant VERSION_HASH = keccak256("2");
    bytes32 private constant TESTNET_HASH = keccak256("testnet");
    bytes32 private constant SETTLEMENT_MODE_HASH = keccak256("settlement");
    bytes32 private constant DIRECT_MODE_HASH = keccak256("direct-signature-only");
    uint256 private constant SECP256K1_HALF_N =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    address public owner;
    address public pendingOwner;
    uint64 public nextSettlementRegistryVersion = 1;
    uint64 public enabledSettlementCount;
    uint64 public enabledIssuerCount;

    mapping(address issuer => bool registered) public registeredIssuers;
    mapping(address issuer => bool trusted) public trustedIssuers;
    mapping(address settlement => SettlementRegistration registration)
        public settlementRegistrations;

    event OwnershipTransferStarted(
        address indexed currentOwner,
        address indexed pendingOwner
    );
    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );
    event IssuerRegistered(address indexed issuer);
    event IssuerStatusChanged(address indexed issuer, bool enabled);
    event SettlementRegistered(
        address indexed settlementContract,
        uint64 indexed registryVersion
    );
    event SettlementStatusChanged(
        address indexed settlementContract,
        uint64 indexed registryVersion,
        bool enabled
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address initialSettlement, address initialIssuer) {
        require(block.chainid == ARC_TESTNET_CHAIN_ID, "unsupported chain");
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        _registerIssuer(initialIssuer);
        _registerSettlement(initialSettlement);
    }

    // ---------------------------------------------------------------------
    // Ownership and registries
    // ---------------------------------------------------------------------

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "invalid owner");
        require(newOwner != owner, "owner unchanged");
        require(newOwner != pendingOwner, "transfer already pending");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending owner");
        address previousOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, msg.sender);
    }

    function registerIssuer(address issuer) external onlyOwner {
        _registerIssuer(issuer);
    }

    function setIssuerEnabled(address issuer, bool enabled) external onlyOwner {
        require(registeredIssuers[issuer], "issuer not registered");
        require(trustedIssuers[issuer] != enabled, "issuer status unchanged");
        if (enabled) {
            enabledIssuerCount += 1;
        } else {
            enabledIssuerCount -= 1;
        }
        trustedIssuers[issuer] = enabled;
        emit IssuerStatusChanged(issuer, enabled);
    }

    function registerSettlement(
        address settlementContract
    ) external onlyOwner returns (uint64 registryVersion) {
        return _registerSettlement(settlementContract);
    }

    function setSettlementEnabled(
        address settlementContract,
        bool enabled
    ) external onlyOwner {
        SettlementRegistration storage registration =
            settlementRegistrations[settlementContract];
        require(registration.version != 0, "settlement not registered");
        require(registration.enabled != enabled, "settlement status unchanged");
        if (enabled) {
            require(settlementContract.code.length > 0, "settlement has no code");
            enabledSettlementCount += 1;
        } else {
            enabledSettlementCount -= 1;
        }
        registration.enabled = enabled;
        emit SettlementStatusChanged(
            settlementContract,
            registration.version,
            enabled
        );
    }

    // ---------------------------------------------------------------------
    // EIP-712 hashing and verification
    // ---------------------------------------------------------------------

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                NAME_HASH,
                VERSION_HASH,
                block.chainid,
                address(this)
            )
        );
    }

    function hashPspFields(
        PspFields calldata fields
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                PSP_FIELDS_TYPEHASH,
                fields.documentDigest,
                keccak256(bytes(fields.networkMode)),
                keccak256(bytes(fields.verificationMode)),
                fields.settlementContract,
                fields.settlementRegistryVersion,
                fields.settlementId,
                fields.invoicePayer,
                fields.invoiceRecipient,
                keccak256(bytes(fields.invoiceToken)),
                keccak256(bytes(fields.invoiceAmount)),
                keccak256(bytes(fields.requestId)),
                fields.settlementChainId,
                fields.settlementTxHash
            )
        );
        return keccak256(
            abi.encodePacked("\x19\x01", domainSeparator(), structHash)
        );
    }

    /**
     * @notice Verify a direct-payment claim.
     * @dev This intentionally does not check settlement existence. The function
     * name and signed mode make the reduced proof scope explicit.
     */
    function verifyDirectClaim(
        PspFields calldata fields,
        bytes calldata signature
    ) external view returns (bool ok, address recoveredSigner) {
        if (
            keccak256(bytes(fields.verificationMode)) != DIRECT_MODE_HASH ||
            fields.settlementRegistryVersion != 0 ||
            !_validCommonFields(fields)
        ) {
            return (false, address(0));
        }

        recoveredSigner = _recoverSigner(hashPspFields(fields), signature);
        ok = recoveredSigner != address(0) && trustedIssuers[recoveredSigner];
    }

    /**
     * @notice Verify both a trusted issuer claim and settlement existence.
     * @dev Zero settlement IDs, unregistered contracts, disabled versions, and
     * version mismatches are rejected before the external lookup.
     */
    function verifySettlementClaim(
        PspFields calldata fields,
        bytes calldata signature
    ) external view returns (bool ok, address recoveredSigner) {
        if (
            keccak256(bytes(fields.verificationMode)) != SETTLEMENT_MODE_HASH ||
            fields.settlementRegistryVersion == 0 ||
            fields.settlementId == bytes32(0) ||
            !_validCommonFields(fields)
        ) {
            return (false, address(0));
        }

        SettlementRegistration memory registration =
            settlementRegistrations[fields.settlementContract];
        if (
            !registration.enabled ||
            registration.version != fields.settlementRegistryVersion
        ) {
            return (false, address(0));
        }

        recoveredSigner = _recoverSigner(hashPspFields(fields), signature);
        if (
            recoveredSigner == address(0) ||
            !trustedIssuers[recoveredSigner]
        ) {
            return (false, recoveredSigner);
        }

        try IQrPaymentSettlement(fields.settlementContract).settled(
            fields.settlementId
        ) returns (bool isConfirmed) {
            return (isConfirmed, recoveredSigner);
        } catch {
            return (false, recoveredSigner);
        }
    }

    function isSettled(
        address settlementContract,
        uint64 registryVersion,
        bytes32 settlementId
    ) external view returns (bool) {
        if (settlementId == bytes32(0)) {
            return false;
        }
        SettlementRegistration memory registration =
            settlementRegistrations[settlementContract];
        if (
            !registration.enabled ||
            registration.version != registryVersion
        ) {
            return false;
        }
        try IQrPaymentSettlement(settlementContract).settled(settlementId)
            returns (bool isConfirmed)
        {
            return isConfirmed;
        } catch {
            return false;
        }
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    function _registerIssuer(address issuer) internal {
        require(issuer != address(0), "invalid issuer");
        require(!registeredIssuers[issuer], "issuer already registered");
        registeredIssuers[issuer] = true;
        trustedIssuers[issuer] = true;
        enabledIssuerCount += 1;
        emit IssuerRegistered(issuer);
        emit IssuerStatusChanged(issuer, true);
    }

    function _registerSettlement(
        address settlementContract
    ) internal returns (uint64 registryVersion) {
        require(settlementContract != address(0), "invalid settlement");
        require(settlementContract.code.length > 0, "settlement has no code");
        require(
            settlementRegistrations[settlementContract].version == 0,
            "settlement already registered"
        );

        registryVersion = nextSettlementRegistryVersion;
        require(registryVersion != type(uint64).max, "registry version exhausted");
        nextSettlementRegistryVersion = registryVersion + 1;
        settlementRegistrations[settlementContract] = SettlementRegistration({
            version: registryVersion,
            enabled: true
        });
        enabledSettlementCount += 1;
        emit SettlementRegistered(settlementContract, registryVersion);
        emit SettlementStatusChanged(settlementContract, registryVersion, true);
    }

    function _validCommonFields(
        PspFields calldata fields
    ) internal view returns (bool) {
        return
            fields.documentDigest != bytes32(0) &&
            keccak256(bytes(fields.networkMode)) == TESTNET_HASH &&
            fields.settlementContract != address(0) &&
            fields.settlementId != bytes32(0) &&
            fields.invoicePayer != address(0) &&
            fields.invoiceRecipient != address(0) &&
            bytes(fields.invoiceToken).length != 0 &&
            bytes(fields.invoiceAmount).length != 0 &&
            bytes(fields.requestId).length != 0 &&
            fields.settlementChainId == block.chainid &&
            fields.settlementTxHash != bytes32(0);
    }

    function _recoverSigner(
        bytes32 digest,
        bytes calldata signature
    ) internal pure returns (address) {
        if (signature.length != 65) {
            return address(0);
        }

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (v < 27) {
            v += 27;
        }
        if (
            (v != 27 && v != 28) ||
            uint256(s) > SECP256K1_HALF_N ||
            r == bytes32(0) ||
            s == bytes32(0)
        ) {
            return address(0);
        }
        return ecrecover(digest, v, r, s);
    }
}
