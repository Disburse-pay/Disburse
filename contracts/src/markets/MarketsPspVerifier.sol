// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * MarketsPspVerifier - on-chain verifier for market-claim PSPs.
 *
 * Payment PSPs bind to QrPaymentSettlement.settled(settlementId). Market
 * claims emit MarketClaimed from each Market contract, so this verifier keeps
 * a compact owner-recorded fact table keyed by settlementId.
 */
contract MarketsPspVerifier {
    event IssuerUpdated(address indexed previousIssuer, address indexed newIssuer);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ClaimFactRecorded(
        bytes32 indexed settlementId,
        address indexed market,
        address indexed claimant,
        uint256 amount,
        uint8 outcome
    );

    struct ClaimFact {
        address market;
        address claimant;
        uint256 amount;
        uint8 outcome;
        bool exists;
    }

    struct MarketClaimFields {
        string networkMode;
        bytes32 settlementId;
        address market;
        address claimant;
        uint256 amount;
        uint8 outcome;
        string marketId;
        uint256 settlementChainId;
        bytes32 settlementTxHash;
    }

    address public owner;
    address public issuer;
    mapping(bytes32 => ClaimFact) public claimFacts;

    modifier onlyOwner() {
        require(msg.sender == owner, "MarketsPspVerifier: not owner");
        _;
    }

    constructor(address initialIssuer) {
        require(initialIssuer != address(0), "MarketsPspVerifier: invalid issuer");
        owner = msg.sender;
        issuer = initialIssuer;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "MarketsPspVerifier: invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setIssuer(address newIssuer) external onlyOwner {
        require(newIssuer != address(0), "MarketsPspVerifier: invalid issuer");
        emit IssuerUpdated(issuer, newIssuer);
        issuer = newIssuer;
    }

    function recordClaimFact(
        bytes32 settlementId,
        address market,
        address claimant,
        uint256 amount,
        uint8 outcome
    ) public onlyOwner {
        require(settlementId != bytes32(0), "MarketsPspVerifier: zero settlement");
        require(market != address(0), "MarketsPspVerifier: zero market");
        require(claimant != address(0), "MarketsPspVerifier: zero claimant");
        require(amount > 0, "MarketsPspVerifier: zero amount");
        require(outcome <= 1, "MarketsPspVerifier: bad outcome");
        require(!claimFacts[settlementId].exists, "MarketsPspVerifier: already recorded");

        claimFacts[settlementId] = ClaimFact({
            market: market,
            claimant: claimant,
            amount: amount,
            outcome: outcome,
            exists: true
        });

        emit ClaimFactRecorded(settlementId, market, claimant, amount, outcome);
    }

    function recordClaimFacts(
        bytes32[] calldata settlementIds,
        address[] calldata markets,
        address[] calldata claimants,
        uint256[] calldata amounts,
        uint8[] calldata outcomes
    ) external onlyOwner {
        require(
            settlementIds.length == markets.length &&
                settlementIds.length == claimants.length &&
                settlementIds.length == amounts.length &&
                settlementIds.length == outcomes.length,
            "MarketsPspVerifier: length mismatch"
        );

        for (uint256 i = 0; i < settlementIds.length; i++) {
            recordClaimFact(settlementIds[i], markets[i], claimants[i], amounts[i], outcomes[i]);
        }
    }

    function verifyMarketClaim(
        bytes32 digest,
        bytes calldata signature,
        MarketClaimFields calldata fields
    ) external view returns (bool ok, address recoveredSigner) {
        recoveredSigner = recoverPersonalSigner(digest, signature);
        if (recoveredSigner != issuer) {
            return (false, recoveredSigner);
        }

        ClaimFact memory fact = claimFacts[fields.settlementId];
        if (
            !fact.exists ||
            fact.market != fields.market ||
            fact.claimant != fields.claimant ||
            fact.amount != fields.amount ||
            fact.outcome != fields.outcome
        ) {
            return (false, recoveredSigner);
        }

        return (true, recoveredSigner);
    }

    function verifySignatureOnly(
        bytes32 digest,
        bytes calldata signature
    ) external view returns (bool ok, address recoveredSigner) {
        recoveredSigner = recoverPersonalSigner(digest, signature);
        ok = recoveredSigner == issuer;
    }

    function hasClaimFact(bytes32 settlementId) external view returns (bool) {
        return claimFacts[settlementId].exists;
    }

    function recoverPersonalSigner(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", digest)
        );
        return recoverSigner(ethSignedHash, signature);
    }

    function recoverSigner(bytes32 hash, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "MarketsPspVerifier: invalid sig length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }

        if (v < 27) {
            v += 27;
        }

        require(v == 27 || v == 28, "MarketsPspVerifier: invalid sig v");
        address recovered = ecrecover(hash, v, r, s);
        require(recovered != address(0), "MarketsPspVerifier: ecrecover failed");
        return recovered;
    }
}

