// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Minimal subset of Pyth's IPyth we actually use. Full interface lives at
 * https://github.com/pyth-network/pyth-sdk-solidity. We only need read paths
 * — Hermes-pushed updates go through Pyth's UpdatePriceFeeds elsewhere.
 */
interface IPyth {
    struct Price {
        int64 price;       // price * 10^expo = real value
        uint64 conf;       // confidence interval (same units as price)
        int32 expo;        // exponent, typically negative (e.g. -8 for BTC)
        uint256 publishTime;
    }

    /// Reverts if no price has ever been published for this feed.
    function getPriceUnsafe(bytes32 id) external view returns (Price memory);

    /// Reverts if the most recent price is older than `age` seconds, or if
    /// it has never been published.
    function getPriceNoOlderThan(bytes32 id, uint256 age) external view returns (Price memory);
}

/**
 * PythPriceAdapter — read cirBTC/USD price from Pyth, with three guards:
 *
 *   1. Staleness: revert if last publish is older than `maxAgeSeconds`. On
 *      Arc Testnet today, BTC/USD updates roughly every 5–30s, so a default
 *      of 600s gives ample headroom while still catching a stuck feed.
 *
 *   2. Haircut: Pyth has no cirBTC-specific feed; we use BTC/USD as a proxy
 *      because cirBTC is meant to be 1:1 redeemable for BTC. `haircutBps`
 *      is governance's safety margin against cirBTC depegging — if cirBTC
 *      ever trades at 0.95 BTC, ops bump haircutBps to 500 (5%) without a
 *      contract upgrade. Default 0.
 *
 *   3. Positive-price assertion: Pyth `int64 price` could theoretically be
 *      zero or negative on a bad publish; we reject those rather than
 *      letting downstream math underflow.
 *
 * Output is normalized to 1e18-scale USD per 1 unit of the underlying asset.
 * For cirBTC (8 decimals), the LendingPool then converts to per-token-unit
 * by dividing by 1e8 when computing USD value of a balance.
 */
contract PythPriceAdapter {
    // ───── Immutable refs ─────
    IPyth public immutable pyth;
    bytes32 public immutable priceFeedId;
    /// Documentation only — the asset this adapter prices. Not enforced.
    address public immutable asset;

    // ───── Governance state ─────
    address public owner;
    uint256 public haircutBps;       // 0..10000
    uint256 public maxAgeSeconds;    // staleness threshold

    // ───── Events ─────
    event OwnerTransferred(address indexed prevOwner, address indexed nextOwner);
    event HaircutSet(uint256 prevBps, uint256 nextBps);
    event MaxAgeSet(uint256 prevSeconds, uint256 nextSeconds);

    constructor(
        address _pyth,
        bytes32 _priceFeedId,
        address _asset,
        uint256 _initialHaircutBps,
        uint256 _initialMaxAgeSeconds
    ) {
        require(_pyth != address(0), "Adapter: zero pyth");
        require(_priceFeedId != bytes32(0), "Adapter: zero feed");
        require(_initialHaircutBps <= 10_000, "Adapter: haircut > 100%");
        require(
            _initialMaxAgeSeconds >= 60 && _initialMaxAgeSeconds <= 86_400,
            "Adapter: maxAge out of range"
        );

        pyth = IPyth(_pyth);
        priceFeedId = _priceFeedId;
        asset = _asset;

        owner = msg.sender;
        haircutBps = _initialHaircutBps;
        maxAgeSeconds = _initialMaxAgeSeconds;

        emit OwnerTransferred(address(0), msg.sender);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Adapter: not owner");
        _;
    }

    // ───── Governance ─────

    function transferOwnership(address next) external onlyOwner {
        require(next != address(0), "Adapter: zero next owner");
        emit OwnerTransferred(owner, next);
        owner = next;
    }

    function setHaircutBps(uint256 next) external onlyOwner {
        require(next <= 10_000, "Adapter: haircut > 100%");
        emit HaircutSet(haircutBps, next);
        haircutBps = next;
    }

    function setMaxAgeSeconds(uint256 next) external onlyOwner {
        require(next >= 60 && next <= 86_400, "Adapter: maxAge out of range");
        emit MaxAgeSet(maxAgeSeconds, next);
        maxAgeSeconds = next;
    }

    // ───── Price read ─────

    /**
     * USD price per 1 unit of `asset`, scaled to 1e18.
     *
     * Example: BTC at $45,000 returns 45_000 × 1e18 = 4.5e22.
     *
     * Reverts on stale feed, non-positive price, or absurd exponent. The
     * exponent guard catches Pyth shipping a misconfigured feed; legitimate
     * crypto feeds use expo in roughly [-12, 0].
     */
    function getPrice() external view returns (uint256) {
        IPyth.Price memory p = pyth.getPriceNoOlderThan(priceFeedId, maxAgeSeconds);
        require(p.price > 0, "Adapter: non-positive price");

        // p.price is int64 but already checked > 0, safe to cast through uint64.
        uint256 rawPrice = uint256(uint64(p.price));

        // 1e18-scaled = rawPrice × 10^(18 + expo). expo is typically negative
        // (BTC uses -8), so we add it to 18 and require the result is non-
        // negative. A non-negative result means we multiply; if expo were so
        // negative that 18 + expo < 0 we'd lose precision, which we refuse.
        int256 shift = int256(18) + int256(p.expo);
        require(shift >= 0 && shift <= 36, "Adapter: expo out of range");

        uint256 scaled = rawPrice * (10 ** uint256(shift));

        // Apply governance haircut (multiplicative, last).
        if (haircutBps > 0) {
            scaled = (scaled * (10_000 - haircutBps)) / 10_000;
        }

        return scaled;
    }

    /// Same as getPrice() but also returns the publishTime, useful for
    /// off-chain monitoring without doing a second Pyth read.
    function getPriceWithMeta() external view returns (uint256 scaledPrice, uint256 publishTime) {
        IPyth.Price memory p = pyth.getPriceNoOlderThan(priceFeedId, maxAgeSeconds);
        require(p.price > 0, "Adapter: non-positive price");
        uint256 rawPrice = uint256(uint64(p.price));
        int256 shift = int256(18) + int256(p.expo);
        require(shift >= 0 && shift <= 36, "Adapter: expo out of range");
        scaledPrice = rawPrice * (10 ** uint256(shift));
        if (haircutBps > 0) {
            scaledPrice = (scaledPrice * (10_000 - haircutBps)) / 10_000;
        }
        publishTime = p.publishTime;
    }
}
