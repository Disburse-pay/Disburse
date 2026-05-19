// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMarket {
    function resolve(uint8 winningOutcome) external;
}

/**
 * AdminResolver — single-owner resolver for v1.
 *
 * Owner (admin) is the only address allowed to resolve markets bound to
 * this resolver. Implements IResolver. v2 swaps this out for an optimistic
 * oracle without changing Market.sol.
 */
contract AdminResolver {
    event OwnershipTransferred(address indexed previous, address indexed next);
    event MarketAuthorized(address indexed market, bool authorized);
    event Resolved(address indexed market, uint8 winningOutcome);

    address public owner;
    mapping(address => bool) public authorizedMarkets;

    modifier onlyOwner() {
        require(msg.sender == owner, "AdminResolver: not owner");
        _;
    }

    constructor(address _owner) {
        require(_owner != address(0), "AdminResolver: zero owner");
        owner = _owner;
        emit OwnershipTransferred(address(0), _owner);
    }

    function transferOwnership(address next) external onlyOwner {
        require(next != address(0), "AdminResolver: zero owner");
        emit OwnershipTransferred(owner, next);
        owner = next;
    }

    /// Authorize a market for resolution by this resolver. Called by the
    /// MarketFactory at deploy time (or directly by the owner).
    function setMarketAuthorized(address market, bool authorized) external {
        require(msg.sender == owner, "AdminResolver: not owner");
        authorizedMarkets[market] = authorized;
        emit MarketAuthorized(market, authorized);
    }

    function canResolve(address market) external view returns (bool) {
        return authorizedMarkets[market];
    }

    /// Resolve a market. Owner-only.
    function resolve(address market, uint8 winningOutcome) external onlyOwner {
        require(authorizedMarkets[market], "AdminResolver: not authorized");
        IMarket(market).resolve(winningOutcome);
        emit Resolved(market, winningOutcome);
    }
}
