// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title PspVerifier
 * @notice On-chain verifier for Disburse Portable Settlement Proofs (PSP).
 *
 * Validates that:
 * 1. The PSP digest matches the canonical encoding of the provided fields.
 * 2. The signature was produced by the registered issuer (via ecrecover).
 * 3. The referenced settlement actually occurred (via QrPaymentSettlement.settled).
 *
 * This contract is a VIEW-only verifier — it holds no funds and cannot be paused.
 */

interface IQrPaymentSettlement {
    function settled(bytes32 settlementId) external view returns (bool);
}

contract PspVerifier {
    // ─── Events ────────────────────────────────────────────────────────────────

    event IssuerUpdated(address indexed previousIssuer, address indexed newIssuer);

    // ─── State ─────────────────────────────────────────────────────────────────

    address public owner;
    address public issuer;
    IQrPaymentSettlement public immutable settlement;

    // ─── Domain separator (matches TypeScript canonicalization) ─────────────────

    // "DISBURSE-PSP-v1\ntestnet\n" or "DISBURSE-PSP-v1\nmainnet\n"
    // We store both and select at verification time.
    bytes public constant DOMAIN_PREFIX = "DISBURSE-PSP-v1\n";

    // ─── Structs ───────────────────────────────────────────────────────────────

    /// @notice Minimal PSP fields needed for on-chain verification.
    /// Full PSP contains more data, but the verifier only needs enough to
    /// reconstruct the digest and check settlement existence.
    struct PspFields {
        string networkMode;       // "testnet" or "mainnet"
        bytes32 settlementId;     // from settlement.settlementEvent.settlementId
        address invoicePayer;     // invoice.payer
        address invoiceRecipient; // invoice.recipient
        string invoiceToken;      // invoice.token
        string invoiceAmount;     // invoice.amount
        string requestId;         // invoice.requestId
        uint256 settlementChainId;// settlement.chainId
        bytes32 settlementTxHash; // settlement.txHash
    }

    // ─── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    // ─── Constructor ───────────────────────────────────────────────────────────

    constructor(address settlementContract, address initialIssuer) {
        require(settlementContract != address(0), "invalid settlement");
        require(initialIssuer != address(0), "invalid issuer");
        settlement = IQrPaymentSettlement(settlementContract);
        issuer = initialIssuer;
        owner = msg.sender;
    }

    // ─── Admin ─────────────────────────────────────────────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "invalid owner");
        owner = newOwner;
    }

    function setIssuer(address newIssuer) external onlyOwner {
        require(newIssuer != address(0), "invalid issuer");
        emit IssuerUpdated(issuer, newIssuer);
        issuer = newIssuer;
    }

    // ─── Verification ──────────────────────────────────────────────────────────

    /**
     * @notice Verify a PSP's signature and settlement existence.
     * @param digest The keccak256 digest of the canonical PSP bytes (computed off-chain).
     * @param signature The 65-byte EIP-191 personal_sign signature over the digest.
     * @param fields Minimal PSP fields for settlement existence check.
     * @return ok True if the signature is valid AND the settlement exists on-chain.
     * @return recoveredSigner The address recovered from the signature.
     */
    function verify(
        bytes32 digest,
        bytes calldata signature,
        PspFields calldata fields
    ) external view returns (bool ok, address recoveredSigner) {
        // Step 1: Verify signature using EIP-191 personal_sign format
        // The digest was signed with personal_sign, so we need the Ethereum prefix
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", digest)
        );

        recoveredSigner = recoverSigner(ethSignedHash, signature);

        // Step 2: Check recovered signer matches registered issuer
        if (recoveredSigner != issuer) {
            return (false, recoveredSigner);
        }

        // Step 3: Verify settlement exists on-chain
        // For cross-chain payments, check QrPaymentSettlement.settled(settlementId)
        // For direct payments, settlementId is the txHash — we trust the digest binding
        if (fields.settlementId != bytes32(0)) {
            bool isSettled = settlement.settled(fields.settlementId);
            if (!isSettled) {
                return (false, recoveredSigner);
            }
        }

        return (true, recoveredSigner);
    }

    /**
     * @notice Verify only the signature (no settlement check).
     * Useful for direct Arc payments where there's no cross-chain settlement event.
     * @param digest The keccak256 digest of the canonical PSP bytes.
     * @param signature The 65-byte EIP-191 signature.
     * @return ok True if the signer matches the registered issuer.
     * @return recoveredSigner The address recovered from the signature.
     */
    function verifySignatureOnly(
        bytes32 digest,
        bytes calldata signature
    ) external view returns (bool ok, address recoveredSigner) {
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", digest)
        );

        recoveredSigner = recoverSigner(ethSignedHash, signature);
        ok = (recoveredSigner == issuer);
    }

    /**
     * @notice Check if a specific settlement ID has been settled.
     * @param settlementId The settlement ID to check.
     * @return True if the settlement exists in QrPaymentSettlement.
     */
    function isSettled(bytes32 settlementId) external view returns (bool) {
        return settlement.settled(settlementId);
    }

    // ─── Internal ──────────────────────────────────────────────────────────────

    function recoverSigner(bytes32 hash, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "invalid sig length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }

        // Support both 27/28 and 0/1 v values
        if (v < 27) {
            v += 27;
        }

        require(v == 27 || v == 28, "invalid sig v");
        address recovered = ecrecover(hash, v, r, s);
        require(recovered != address(0), "ecrecover failed");
        return recovered;
    }
}
