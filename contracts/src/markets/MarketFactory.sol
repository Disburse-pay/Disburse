// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Market} from "./Market.sol";

interface IOutcomeTokenAdmin {
    function setMinter(address minter, bool authorized) external;
}

interface IAdminResolverAdmin {
    function setMarketAuthorized(address market, bool authorized) external;
    function resolve(address market, uint8 winningOutcome) external;
}

/**
 * MarketFactory — admin-only deployer of binary YES/NO markets.
 *
 * The factory does the wiring that would otherwise require multiple
 * separate calls:
 *   1. Deploy Market(marketId, USDC, OutcomeToken, closesAt, resolver, factory)
 *   2. Authorize the new Market as a minter on OutcomeToken
 *   3. Authorize the new Market on the AdminResolver
 *
 * This means after createMarket the market is fully operational with
 * one transaction. The factory must therefore be set as:
 *   - owner of OutcomeToken (or at minimum a minter-authorizer; v1 = owner)
 *   - owner of AdminResolver (so it can authorize the new market)
 *
 * The deploy script transfers ownership of both to the factory after deploy.
 * The factory keeps the deployer (msg.sender at constructor time) as `owner`
 * for upgrade/rotation purposes.
 */
contract MarketFactory {
    event MarketCreated(
        bytes32 indexed marketId,
        address indexed market,
        uint64 closesAt,
        address resolver,
        string metadataUri
    );
    event OwnershipTransferred(address indexed previous, address indexed next);

    address public owner;
    address public immutable collateral;        // USDC
    address public immutable outcomeToken;
    address public immutable resolver;          // default resolver for new markets

    /// marketId (off-chain uuid hashed) -> Market address. Reads as zero for unknown ids.
    mapping(bytes32 => address) public marketOf;
    address[] public allMarkets;

    modifier onlyOwner() {
        require(msg.sender == owner, "Factory: not owner");
        _;
    }

    constructor(address _collateral, address _outcomeToken, address _resolver) {
        require(_collateral != address(0), "Factory: zero collateral");
        require(_outcomeToken != address(0), "Factory: zero token");
        require(_resolver != address(0), "Factory: zero resolver");
        owner = msg.sender;
        collateral = _collateral;
        outcomeToken = _outcomeToken;
        resolver = _resolver;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address next) external onlyOwner {
        require(next != address(0), "Factory: zero owner");
        emit OwnershipTransferred(owner, next);
        owner = next;
    }

    function marketCount() external view returns (uint256) {
        return allMarkets.length;
    }

    /**
     * Deploy and wire up a new market.
     *
     * marketId: off-chain UUID hashed to bytes32 (any 32-byte identifier;
     *           must be unique per factory).
     * closesAt: when trading freezes (unix seconds, > now).
     * metadataUri: optional off-chain pointer. Ignored on-chain; emitted
     *              for indexers.
     */
    function createMarket(
        bytes32 marketId,
        uint64 closesAt,
        string calldata metadataUri
    ) external onlyOwner returns (address market) {
        require(marketOf[marketId] == address(0), "Factory: duplicate id");

        Market m = new Market(
            marketId,
            collateral,
            outcomeToken,
            closesAt,
            resolver,
            address(this)
        );
        market = address(m);

        marketOf[marketId] = market;
        allMarkets.push(market);

        // Authorize the new Market on the OutcomeToken so it can mint/burn shares.
        IOutcomeTokenAdmin(outcomeToken).setMinter(market, true);

        // Authorize the new Market on the AdminResolver so resolver.resolve()
        // succeeds. (The factory must own the resolver for this to work.)
        IAdminResolverAdmin(resolver).setMarketAuthorized(market, true);

        emit MarketCreated(marketId, market, closesAt, resolver, metadataUri);
    }

    /**
     * Proxy AdminResolver.resolve through the factory.
     *
     * The deploy script transfers AdminResolver ownership to this factory so
     * that createMarket can call setMarketAuthorized atomically. That same
     * ownership means resolve() — also onlyOwner on AdminResolver — is no
     * longer callable from an EOA. This proxy preserves the v1 flow:
     *
     *   admin (EOA, factory.owner) -> factory.resolveMarket
     *     -> AdminResolver.resolve  (factory == AdminResolver.owner)
     *     -> Market.resolve         (resolver == AdminResolver)
     */
    function resolveMarket(bytes32 marketId, uint8 winningOutcome) external onlyOwner {
        address market = marketOf[marketId];
        require(market != address(0), "Factory: unknown market");
        IAdminResolverAdmin(resolver).resolve(market, winningOutcome);
    }
}
