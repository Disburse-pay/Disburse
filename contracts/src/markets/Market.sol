// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IOutcomeToken {
    function tokenIdFor(address market, uint8 outcome) external pure returns (uint256);
    function mint(address to, uint256 id, uint256 amount) external;
    function burn(address from, uint256 id, uint256 amount) external;
    function balanceOf(address account, uint256 id) external view returns (uint256);
}

interface IResolver {
    function canResolve(address market) external view returns (bool);
}

/**
 * Market — binary YES/NO prediction market.
 *
 * Lifecycle:
 *   open      — trading allowed (Exchange settlements move shares around)
 *   closed    — after closesAt; trading disabled; awaiting resolution
 *   resolved  — winningOutcome set; winners may claim 1 USDC per share
 *
 * Collateral model (Polymarket / Gnosis CTF style):
 *   mintComplete(N): pull N USDC from user, mint N YES + N NO to user
 *   burnComplete(N): burn N YES + N NO from user, send N USDC back to user
 *   claim(amount, outcome): post-resolve only; burn `amount` of winning shares, send `amount` USDC
 *
 * 1 share = 1e6 = $1 redemption value. Prices in the off-chain orderbook
 * are in 1e6 scale (0 < price < 1e6), so total cost = price * size / 1e6.
 *
 * The MarketClaimed event mirrors QrPaymentSettled's settlementId shape so
 * the existing PSP issuance pipeline (server/psp/issue.ts) can reuse its
 * log-fetching pattern with minimal change.
 */
contract Market {
    // ───── Constants ─────
    uint8 public constant OUTCOME_NO = 0;
    uint8 public constant OUTCOME_YES = 1;

    // ───── Events ─────
    event MarketResolved(uint8 winningOutcome, uint64 resolvedAt);
    event CompleteSetMinted(address indexed who, uint256 amount);
    event CompleteSetBurned(address indexed who, uint256 amount);
    event MarketClaimed(
        bytes32 indexed settlementId,
        bytes32 indexed marketId,
        address indexed claimant,
        uint256 amount,
        uint8 outcome
    );

    // ───── Immutable config ─────
    IERC20 public immutable collateral;        // USDC on Arc
    IOutcomeToken public immutable outcomeToken;
    bytes32 public immutable marketId;          // off-chain uuid (hashed)
    uint64 public immutable closesAt;           // unix seconds
    IResolver public immutable resolver;
    address public immutable factory;

    // ───── Resolution state ─────
    bool public resolved;
    uint8 public winningOutcome;                // valid only when resolved
    uint64 public resolvedAt;

    // ───── Reentrancy guard ─────
    uint256 private _locked = 1;
    modifier nonReentrant() {
        require(_locked == 1, "Market: reentrant");
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(
        bytes32 _marketId,
        address _collateral,
        address _outcomeToken,
        uint64 _closesAt,
        address _resolver,
        address _factory
    ) {
        require(_collateral != address(0), "Market: zero collateral");
        require(_outcomeToken != address(0), "Market: zero token");
        require(_resolver != address(0), "Market: zero resolver");
        require(_closesAt > block.timestamp, "Market: closesAt past");
        marketId = _marketId;
        collateral = IERC20(_collateral);
        outcomeToken = IOutcomeToken(_outcomeToken);
        closesAt = _closesAt;
        resolver = IResolver(_resolver);
        factory = _factory;
    }

    // ───── Views ─────

    function tokenIdYes() public view returns (uint256) {
        return outcomeToken.tokenIdFor(address(this), OUTCOME_YES);
    }

    function tokenIdNo() public view returns (uint256) {
        return outcomeToken.tokenIdFor(address(this), OUTCOME_NO);
    }

    function status() external view returns (uint8) {
        if (resolved) return 2; // resolved
        if (block.timestamp >= closesAt) return 1; // closed
        return 0; // open
    }

    // ───── Mint / burn complete sets ─────

    function mintComplete(uint256 amount) external nonReentrant {
        require(!resolved, "Market: resolved");
        require(block.timestamp < closesAt, "Market: closed");
        require(amount > 0, "Market: zero amount");

        // Pull collateral from user
        require(collateral.transferFrom(msg.sender, address(this), amount), "Market: collateral pull failed");

        // Mint YES + NO
        outcomeToken.mint(msg.sender, tokenIdYes(), amount);
        outcomeToken.mint(msg.sender, tokenIdNo(), amount);

        emit CompleteSetMinted(msg.sender, amount);
    }

    function burnComplete(uint256 amount) external nonReentrant {
        require(amount > 0, "Market: zero amount");
        // Allowed even after close as long as not resolved — lets users exit
        // complete sets they no longer want, before resolution.
        require(!resolved, "Market: resolved");

        // Burn YES + NO (will revert if user doesn't have enough)
        outcomeToken.burn(msg.sender, tokenIdYes(), amount);
        outcomeToken.burn(msg.sender, tokenIdNo(), amount);

        require(collateral.transfer(msg.sender, amount), "Market: collateral return failed");

        emit CompleteSetBurned(msg.sender, amount);
    }

    // ───── Resolution ─────

    /**
     * Called by the bound resolver only. Sets the winning outcome and
     * freezes the market; from this point claim() is the only state change.
     */
    function resolve(uint8 _winningOutcome) external {
        require(msg.sender == address(resolver), "Market: not resolver");
        require(!resolved, "Market: already resolved");
        require(block.timestamp >= closesAt, "Market: not closed");
        require(_winningOutcome == OUTCOME_YES || _winningOutcome == OUTCOME_NO, "Market: bad outcome");

        resolved = true;
        winningOutcome = _winningOutcome;
        resolvedAt = uint64(block.timestamp);

        emit MarketResolved(_winningOutcome, resolvedAt);
    }

    // ───── Claim ─────

    /**
     * Burn `amount` shares of the WINNING outcome and receive `amount`
     * collateral (1:1 micros). Emits MarketClaimed with a deterministic
     * settlementId derived from (market, claimant, blockNumber, logIndex-ish).
     *
     * settlementId is computed without logIndex (log indices are emitted
     * by the EVM, not knowable to the contract). Instead we mix in a
     * per-claim counter to keep ids unique even when one address claims
     * multiple times in the same block.
     */
    uint256 public claimCounter;

    function claim(uint256 amount) external nonReentrant returns (bytes32 settlementId) {
        require(resolved, "Market: not resolved");
        require(amount > 0, "Market: zero amount");

        // Burn the winning shares from the claimer
        uint256 winId = outcomeToken.tokenIdFor(address(this), winningOutcome);
        outcomeToken.burn(msg.sender, winId, amount);

        // Pay out 1:1 in collateral
        require(collateral.transfer(msg.sender, amount), "Market: payout failed");

        // Build a settlementId structurally similar to QrPaymentSettlement's,
        // so server/psp/fetchLogs.ts can reuse its decoding pattern.
        unchecked {
            claimCounter++;
        }
        settlementId = keccak256(
            abi.encode(
                address(this),
                msg.sender,
                block.number,
                claimCounter
            )
        );

        emit MarketClaimed(settlementId, marketId, msg.sender, amount, winningOutcome);
    }
}
