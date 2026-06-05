// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
}

interface ICrossL2ProverV2 {
    function validateEvent(bytes calldata proof)
        external
        view
        returns (uint32 chainId, address emittingContract, bytes memory topics, bytes memory unindexedData);
}

contract QrPaymentSettlement {
    event SourceAuthorizationUpdated(uint32 indexed sourceChainId, address indexed sourceContract, bool allowed);
    event TokenRouteUpdated(uint32 indexed sourceChainId, address indexed sourceToken, address indexed destinationToken);
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

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PausedSet(bool paused);
    event TokensRescued(address indexed token, address indexed to, uint256 amount);

    bytes32 public constant QR_PAYMENT_INITIATED_SELECTOR =
        keccak256("QrPaymentInitiated(bytes32,address,address,address,uint256,uint256,uint256)");

    address public owner;
    address public pendingOwner;
    bool public paused;
    ICrossL2ProverV2 public immutable prover;
    mapping(uint32 => mapping(address => bool)) public allowedSources;
    mapping(uint32 => mapping(address => address)) public destinationTokens;
    mapping(bytes32 => bool) public settled;
    mapping(bytes32 => bool) public settledRequests;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "paused");
        _;
    }

    constructor(address proverAddress) {
        require(proverAddress != address(0), "invalid prover");
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        prover = ICrossL2ProverV2(proverAddress);
    }

    /**
     * Two-step ownership transfer: the current owner nominates `nextOwner`,
     * which must then call acceptOwnership(). This prevents handing the
     * fund-holding contract to a mistyped or uncontrolled address — important
     * when transferring control to a multisig.
     */
    function transferOwnership(address nextOwner) external onlyOwner {
        require(nextOwner != address(0), "invalid owner");
        pendingOwner = nextOwner;
        emit OwnershipTransferStarted(owner, nextOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending owner");
        address previousOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, owner);
    }

    /// Pause settlement as a circuit breaker (e.g. if the prover or a route is
    /// found compromised). Owner-only. Source escrows are unaffected; payers
    /// can still be made whole once unpaused or via off-chain remediation.
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedSet(_paused);
    }

    /// Recover tokens held by this contract (prefunded settlement liquidity or
    /// tokens sent here by mistake). Owner-only. Combined with a multisig owner
    /// this is the intended path to rebalance or decommission the pool — without
    /// it, prefunded liquidity can only ever leave via settle().
    function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
        require(token != address(0), "invalid token");
        require(to != address(0), "invalid recipient");
        require(IERC20(token).transfer(to, amount), "rescue failed");
        emit TokensRescued(token, to, amount);
    }

    function setAllowedSource(uint32 sourceChainId, address sourceContract, bool allowed) external onlyOwner {
        require(sourceContract != address(0), "invalid source");
        allowedSources[sourceChainId][sourceContract] = allowed;
        emit SourceAuthorizationUpdated(sourceChainId, sourceContract, allowed);
    }

    function setTokenRoute(uint32 sourceChainId, address sourceToken, address destinationToken) external onlyOwner {
        require(sourceToken != address(0), "invalid source token");
        require(destinationToken != address(0), "invalid destination token");
        destinationTokens[sourceChainId][sourceToken] = destinationToken;
        emit TokenRouteUpdated(sourceChainId, sourceToken, destinationToken);
    }

    function settle(bytes calldata proof) external whenNotPaused returns (bytes32 settlementId) {
        (
            uint32 sourceChainId,
            address sourceContract,
            bytes memory topics,
            bytes memory unindexedData
        ) = prover.validateEvent(proof);

        require(allowedSources[sourceChainId][sourceContract], "unauthorized source");
        require(topics.length == 4 * 32, "invalid topics");

        bytes32 eventSelector;
        bytes32 requestId;
        bytes32 payerTopic;
        bytes32 recipientTopic;
        assembly {
            let topicsPtr := add(topics, 32)
            eventSelector := mload(topicsPtr)
            requestId := mload(add(topicsPtr, 32))
            payerTopic := mload(add(topicsPtr, 64))
            recipientTopic := mload(add(topicsPtr, 96))
        }

        require(eventSelector == QR_PAYMENT_INITIATED_SELECTOR, "invalid event");

        address payer = address(uint160(uint256(payerTopic)));
        address recipient = address(uint160(uint256(recipientTopic)));
        (address sourceToken, uint256 amount, uint256 destinationChainId, uint256 nonce) =
            abi.decode(unindexedData, (address, uint256, uint256, uint256));

        require(destinationChainId == block.chainid, "wrong destination");
        require(!settledRequests[requestId], "request already settled");
        address destinationToken = destinationTokens[sourceChainId][sourceToken];
        require(destinationToken != address(0), "unsupported token route");

        settlementId = keccak256(
            abi.encode(
                sourceChainId,
                sourceContract,
                requestId,
                payer,
                recipient,
                sourceToken,
                destinationToken,
                amount,
                nonce
            )
        );
        require(!settled[settlementId], "already settled");
        settled[settlementId] = true;
        settledRequests[requestId] = true;

        require(IERC20(destinationToken).transfer(recipient, amount), "settlement transfer failed");

        emit QrPaymentSettled(
            settlementId,
            requestId,
            recipient,
            sourceChainId,
            payer,
            sourceToken,
            destinationToken,
            amount,
            nonce
        );
    }
}
