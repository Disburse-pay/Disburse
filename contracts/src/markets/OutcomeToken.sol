// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * OutcomeToken — minimal ERC-1155 for prediction-market shares.
 *
 * One token contract serves every market. A token id is derived from
 * (marketAddr, outcome) so YES/NO shares for different markets do not
 * collide. Only addresses whitelisted by the MarketFactory may mint
 * or burn — Market contracts call mint() when minting complete sets
 * and burn() on redeem/claim.
 *
 * Implements just the parts of ERC-1155 needed for v1:
 *   - balanceOf, balanceOfBatch
 *   - setApprovalForAll, isApprovedForAll
 *   - safeTransferFrom (single + batch)
 *   - Receiver-hook callouts (so spec-compliant when the receiver is a contract)
 *
 * URI is fixed/empty in v1 — UI metadata comes from the off-chain `markets`
 * row, not on-chain.
 */
contract OutcomeToken {
    // ───── Events (ERC-1155) ─────
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);
    event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values);
    event ApprovalForAll(address indexed account, address indexed operator, bool approved);
    event URI(string value, uint256 indexed id);

    // ───── Events (markets-specific) ─────
    event MinterAuthorized(address indexed minter, bool authorized);

    // ───── State ─────
    address public owner;
    mapping(address => bool) public isMinter;
    mapping(uint256 => mapping(address => uint256)) public balances;
    mapping(address => mapping(address => bool)) public approvedOperators;

    modifier onlyOwner() {
        require(msg.sender == owner, "OutcomeToken: not owner");
        _;
    }

    modifier onlyMinter() {
        require(isMinter[msg.sender], "OutcomeToken: not minter");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ───── Admin ─────

    function transferOwnership(address next) external onlyOwner {
        require(next != address(0), "OutcomeToken: zero owner");
        owner = next;
    }

    function setMinter(address minter, bool authorized) external onlyOwner {
        isMinter[minter] = authorized;
        emit MinterAuthorized(minter, authorized);
    }

    // ───── Token-id derivation ─────

    /**
     * Token id for (market, outcome). Stable across deployments so the
     * off-chain indexer can re-derive ids without state lookups.
     * outcome is 0 (NO) or 1 (YES); the contract does not enforce that here
     * — Market.sol is the gate.
     */
    function tokenIdFor(address market, uint8 outcome) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(market, outcome)));
    }

    // ───── ERC-1155 reads ─────

    function balanceOf(address account, uint256 id) public view returns (uint256) {
        return balances[id][account];
    }

    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids) external view returns (uint256[] memory) {
        require(accounts.length == ids.length, "OutcomeToken: length mismatch");
        uint256[] memory out = new uint256[](accounts.length);
        for (uint256 i = 0; i < accounts.length; i++) {
            out[i] = balances[ids[i]][accounts[i]];
        }
        return out;
    }

    function isApprovedForAll(address account, address operator) external view returns (bool) {
        return approvedOperators[account][operator];
    }

    // ───── ERC-1155 writes ─────

    function setApprovalForAll(address operator, bool approved) external {
        require(operator != msg.sender, "OutcomeToken: self approval");
        approvedOperators[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes calldata data
    ) external {
        require(to != address(0), "OutcomeToken: to zero");
        require(from == msg.sender || approvedOperators[from][msg.sender], "OutcomeToken: not approved");

        uint256 fromBal = balances[id][from];
        require(fromBal >= amount, "OutcomeToken: insufficient");
        unchecked {
            balances[id][from] = fromBal - amount;
        }
        balances[id][to] += amount;

        emit TransferSingle(msg.sender, from, to, id, amount);
        _doSafeTransferAcceptanceCheck(msg.sender, from, to, id, amount, data);
    }

    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes calldata data
    ) external {
        require(to != address(0), "OutcomeToken: to zero");
        require(ids.length == amounts.length, "OutcomeToken: length mismatch");
        require(from == msg.sender || approvedOperators[from][msg.sender], "OutcomeToken: not approved");

        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            uint256 amount = amounts[i];
            uint256 fromBal = balances[id][from];
            require(fromBal >= amount, "OutcomeToken: insufficient");
            unchecked {
                balances[id][from] = fromBal - amount;
            }
            balances[id][to] += amount;
        }

        emit TransferBatch(msg.sender, from, to, ids, amounts);
        _doSafeBatchTransferAcceptanceCheck(msg.sender, from, to, ids, amounts, data);
    }

    // ───── Mint / Burn (Market-only) ─────

    function mint(address to, uint256 id, uint256 amount) external onlyMinter {
        require(to != address(0), "OutcomeToken: mint to zero");
        balances[id][to] += amount;
        emit TransferSingle(msg.sender, address(0), to, id, amount);
    }

    function burn(address from, uint256 id, uint256 amount) external onlyMinter {
        uint256 fromBal = balances[id][from];
        require(fromBal >= amount, "OutcomeToken: burn exceeds balance");
        unchecked {
            balances[id][from] = fromBal - amount;
        }
        emit TransferSingle(msg.sender, from, address(0), id, amount);
    }

    // ───── ERC-1155 receiver hooks ─────

    function _doSafeTransferAcceptanceCheck(
        address operator,
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes calldata data
    ) private {
        if (to.code.length == 0) return;
        try IERC1155Receiver(to).onERC1155Received(operator, from, id, amount, data) returns (bytes4 sel) {
            require(sel == IERC1155Receiver.onERC1155Received.selector, "OutcomeToken: receiver rejected");
        } catch {
            revert("OutcomeToken: non-1155 receiver");
        }
    }

    function _doSafeBatchTransferAcceptanceCheck(
        address operator,
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes calldata data
    ) private {
        if (to.code.length == 0) return;
        try IERC1155Receiver(to).onERC1155BatchReceived(operator, from, ids, amounts, data) returns (bytes4 sel) {
            require(sel == IERC1155Receiver.onERC1155BatchReceived.selector, "OutcomeToken: receiver rejected");
        } catch {
            revert("OutcomeToken: non-1155 receiver");
        }
    }

    // ERC-165 support hint for ERC-1155 detection
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // ERC-165
            interfaceId == 0xd9b67a26;   // ERC-1155
    }
}

interface IERC1155Receiver {
    function onERC1155Received(address operator, address from, uint256 id, uint256 amount, bytes calldata data) external returns (bytes4);
    function onERC1155BatchReceived(address operator, address from, uint256[] calldata ids, uint256[] calldata amounts, bytes calldata data) external returns (bytes4);
}
