// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IOutcomeToken {
    function tokenIdFor(address market, uint8 outcome) external pure returns (uint256);
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
}

interface IMarketLike {
    function resolved() external view returns (bool);
    function closesAt() external view returns (uint64);
}

/**
 * Exchange — atomic settlement for off-chain-signed CLOB orders.
 *
 * Design (Polymarket-style minimal):
 *   - Makers sign Order structs off-chain (EIP-712) and post to the Disburse
 *     backend orderbook.
 *   - Takers (anyone) call fillOrder(order, sig, fillSize). The Exchange
 *     verifies the signature and atomically transfers USDC + 1155 shares
 *     between maker and taker per the order side.
 *   - No third-party matcher is required for v1: the taker IS the matcher.
 *     The off-chain book only does price-discovery.
 *
 * Approvals required from each user (one-time):
 *   USDC.approve(Exchange, max)
 *   OutcomeToken.setApprovalForAll(Exchange, true)
 *
 * Side semantics:
 *   BUY  (side=0): maker pays USDC, receives shares (taker gives shares)
 *   SELL (side=1): maker pays shares, receives USDC (taker gives USDC)
 *
 * Prices and sizes are in 1e6 fixed-point. price must satisfy 0 < p < 1e6
 * (so probability is strictly between 0 and 1).
 *
 * Total USDC for a fill = price * fillSize / 1e6.
 */
contract Exchange {
    // ───── Constants ─────
    uint256 public constant PRICE_SCALE = 1_000_000;
    uint8 public constant SIDE_BUY = 0;
    uint8 public constant SIDE_SELL = 1;
    uint8 public constant OUTCOME_NO = 0;
    uint8 public constant OUTCOME_YES = 1;

    // ───── EIP-712 ─────
    string public constant NAME = "Disburse Markets";
    string public constant VERSION = "1";
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address maker,address market,uint8 outcome,uint8 side,uint256 price,uint256 size,uint64 expiry,uint256 salt)"
    );

    // ───── Immutable refs ─────
    IERC20 public immutable collateral; // USDC
    IOutcomeToken public immutable outcomeToken;

    // ───── State ─────
    mapping(bytes32 => uint256) public filled;     // orderHash -> filled size
    mapping(bytes32 => bool) public cancelled;     // orderHash -> cancelled by maker

    struct Order {
        address maker;
        address market;
        uint8 outcome;
        uint8 side;
        uint256 price;
        uint256 size;
        uint64 expiry;
        uint256 salt;
    }

    // ───── Events ─────
    event Filled(
        bytes32 indexed orderHash,
        address indexed maker,
        address indexed taker,
        address market,
        uint8 outcome,
        uint8 side,
        uint256 price,
        uint256 fillSize,
        uint256 totalUsdc
    );
    event Cancelled(bytes32 indexed orderHash, address indexed maker);

    constructor(address _collateral, address _outcomeToken) {
        require(_collateral != address(0), "Exchange: zero collateral");
        require(_outcomeToken != address(0), "Exchange: zero token");
        collateral = IERC20(_collateral);
        outcomeToken = IOutcomeToken(_outcomeToken);

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(NAME)),
                keccak256(bytes(VERSION)),
                block.chainid,
                address(this)
            )
        );
    }

    // ───── Hashing ─────

    function hashOrder(Order memory order) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                ORDER_TYPEHASH,
                order.maker,
                order.market,
                order.outcome,
                order.side,
                order.price,
                order.size,
                order.expiry,
                order.salt
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    // ───── Cancel ─────

    function cancelOrder(Order calldata order) external {
        require(msg.sender == order.maker, "Exchange: not maker");
        bytes32 h = hashOrder(order);
        cancelled[h] = true;
        emit Cancelled(h, order.maker);
    }

    // ───── Fill ─────

    /**
     * Fill `fillSize` shares against an off-chain-signed maker `order`.
     * Caller (msg.sender) is the taker. Atomic: either the full fillSize
     * settles in this tx or the call reverts.
     */
    function fillOrder(Order calldata order, bytes calldata signature, uint256 fillSize) external {
        _fillOrder(order, signature, fillSize, msg.sender);
    }

    /**
     * Batch-fill multiple signed orders atomically. Every fill emits its own
     * Filled event, so the existing off-chain indexer can consume batched and
     * single fills with the same receipt scanner.
     */
    function fillOrders(
        Order[] calldata orders,
        bytes[] calldata signatures,
        uint256[] calldata fillSizes
    ) external {
        require(
            orders.length == signatures.length && orders.length == fillSizes.length,
            "Exchange: length mismatch"
        );
        require(orders.length > 0, "Exchange: empty batch");

        for (uint256 i = 0; i < orders.length; i++) {
            _fillOrder(orders[i], signatures[i], fillSizes[i], msg.sender);
        }
    }

    /**
     * Best-effort batch fill. Unlike fillOrders, if an individual order
     * reverts (expired, over-fill, cancelled, bad sig, etc.) it is skipped
     * and the remaining orders still process. Returns the count of
     * successfully filled orders. Reverts only if ALL orders fail — so the
     * taker doesn't waste gas on a completely stale book.
     *
     * Uses a self-call pattern: each order is attempted via
     * `this.fillSingle(...)` wrapped in try/catch. `fillSingle` is
     * restricted to `address(this)` so it cannot be called externally.
     */
    function tryFillOrders(
        Order[] calldata orders,
        bytes[] calldata signatures,
        uint256[] calldata fillSizes
    ) external returns (uint256 filledCount) {
        require(
            orders.length == signatures.length && orders.length == fillSizes.length,
            "Exchange: length mismatch"
        );
        require(orders.length > 0, "Exchange: empty batch");

        for (uint256 i = 0; i < orders.length; i++) {
            try this.fillSingle(orders[i], signatures[i], fillSizes[i], msg.sender) {
                filledCount++;
            } catch {
                // Order was stale/expired/cancelled/over-filled — skip it
            }
        }
        require(filledCount > 0, "Exchange: all orders failed");
    }

    /**
     * Single-order fill callable only by this contract (for tryFillOrders).
     * External visibility is required for try/catch to work in Solidity.
     */
    function fillSingle(
        Order calldata order,
        bytes calldata signature,
        uint256 fillSize,
        address taker
    ) external {
        require(msg.sender == address(this), "Exchange: self-call only");
        _fillOrder(order, signature, fillSize, taker);
    }

    function _fillOrder(
        Order calldata order,
        bytes calldata signature,
        uint256 fillSize,
        address taker
    ) private {
        bytes32 orderHash = hashOrder(order);

        // ── Validate order ──
        require(order.price > 0 && order.price < PRICE_SCALE, "Exchange: bad price");
        require(order.size > 0, "Exchange: zero size");
        require(order.outcome <= OUTCOME_YES, "Exchange: bad outcome");
        require(order.side <= SIDE_SELL, "Exchange: bad side");
        require(order.expiry > block.timestamp, "Exchange: expired");
        require(order.maker != address(0), "Exchange: zero maker");
        require(order.maker != taker, "Exchange: self trade");
        require(!cancelled[orderHash], "Exchange: cancelled");

        // ── Validate fill ──
        require(fillSize > 0, "Exchange: zero fill");
        uint256 newFilled = filled[orderHash] + fillSize;
        require(newFilled <= order.size, "Exchange: over-fill");

        // ── Signature ──
        require(_verifySignature(orderHash, order.maker, signature), "Exchange: bad sig");

        // ── Market state ──
        // The market must still be open (trading freezes at closesAt and
        // again after resolution). Avoid trading post-resolution.
        IMarketLike m = IMarketLike(order.market);
        require(!m.resolved(), "Exchange: resolved");
        require(block.timestamp < m.closesAt(), "Exchange: market closed");

        // ── State change first (re-entrancy: filled is updated before transfers) ──
        filled[orderHash] = newFilled;

        // ── Settle ──
        uint256 totalUsdc = (order.price * fillSize) / PRICE_SCALE;
        _settle(order, taker, fillSize, totalUsdc);
        _emitFilled(orderHash, order, taker, fillSize, totalUsdc);
    }

    function _settle(
        Order calldata order,
        address taker,
        uint256 fillSize,
        uint256 totalUsdc
    ) private {
        uint256 tokenId = outcomeToken.tokenIdFor(order.market, order.outcome);
        if (order.side == SIDE_BUY) {
            // Maker buys shares -> maker pays USDC, taker pays shares
            require(collateral.transferFrom(order.maker, taker, totalUsdc), "Exchange: usdc xfer");
            outcomeToken.safeTransferFrom(taker, order.maker, tokenId, fillSize, "");
        } else {
            // Maker sells shares -> taker pays USDC, maker pays shares
            require(collateral.transferFrom(taker, order.maker, totalUsdc), "Exchange: usdc xfer");
            outcomeToken.safeTransferFrom(order.maker, taker, tokenId, fillSize, "");
        }
    }

    function _emitFilled(
        bytes32 orderHash,
        Order calldata order,
        address taker,
        uint256 fillSize,
        uint256 totalUsdc
    ) private {
        emit Filled(
            orderHash,
            order.maker,
            taker,
            order.market,
            order.outcome,
            order.side,
            order.price,
            fillSize,
            totalUsdc
        );
    }

    // ───── Signature (ECDSA over EIP-712 hash) ─────

    function _verifySignature(bytes32 digest, address signer, bytes calldata signature) private pure returns (bool) {
        if (signature.length != 65) return false;
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        // EIP-2 protection: enforce low-s
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return false;
        if (v != 27 && v != 28) return false;
        address recovered = ecrecover(digest, v, r, s);
        return recovered != address(0) && recovered == signer;
    }
}
