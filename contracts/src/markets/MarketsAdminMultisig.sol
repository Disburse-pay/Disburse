// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * MarketsAdminMultisig - minimal threshold executor for markets admin powers.
 *
 * Intended owner for MarketFactory and other markets-admin contracts. It keeps
 * the surface intentionally small: owners submit, confirm, and execute calls.
 */
contract MarketsAdminMultisig {
    event TransactionSubmitted(uint256 indexed txId, address indexed proposer, address indexed to, uint256 value, bytes data);
    event TransactionConfirmed(uint256 indexed txId, address indexed owner);
    event TransactionExecuted(uint256 indexed txId, address indexed executor);

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint256 confirmations;
    }

    mapping(address => bool) public isOwner;
    address[] public owners;
    uint256 public immutable threshold;
    Transaction[] public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmedBy;

    modifier onlyOwner() {
        require(isOwner[msg.sender], "MarketsAdminMultisig: not owner");
        _;
    }

    constructor(address[] memory _owners, uint256 _threshold) {
        require(_owners.length > 0, "MarketsAdminMultisig: no owners");
        require(_threshold > 0 && _threshold <= _owners.length, "MarketsAdminMultisig: bad threshold");

        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];
            require(owner != address(0), "MarketsAdminMultisig: zero owner");
            require(!isOwner[owner], "MarketsAdminMultisig: duplicate owner");
            isOwner[owner] = true;
            owners.push(owner);
        }

        threshold = _threshold;
    }

    receive() external payable {}

    function ownerCount() external view returns (uint256) {
        return owners.length;
    }

    function transactionCount() external view returns (uint256) {
        return transactions.length;
    }

    function submitTransaction(
        address to,
        uint256 value,
        bytes calldata data
    ) external onlyOwner returns (uint256 txId) {
        require(to != address(0), "MarketsAdminMultisig: zero target");

        txId = transactions.length;
        transactions.push(
            Transaction({
                to: to,
                value: value,
                data: data,
                executed: false,
                confirmations: 0
            })
        );

        emit TransactionSubmitted(txId, msg.sender, to, value, data);
        confirmTransaction(txId);
    }

    function confirmTransaction(uint256 txId) public onlyOwner {
        require(txId < transactions.length, "MarketsAdminMultisig: unknown tx");
        Transaction storage txn = transactions[txId];
        require(!txn.executed, "MarketsAdminMultisig: executed");
        require(!confirmedBy[txId][msg.sender], "MarketsAdminMultisig: already confirmed");

        confirmedBy[txId][msg.sender] = true;
        txn.confirmations += 1;
        emit TransactionConfirmed(txId, msg.sender);
    }

    function executeTransaction(uint256 txId) external onlyOwner {
        require(txId < transactions.length, "MarketsAdminMultisig: unknown tx");
        Transaction storage txn = transactions[txId];
        require(!txn.executed, "MarketsAdminMultisig: executed");
        require(txn.confirmations >= threshold, "MarketsAdminMultisig: below threshold");

        txn.executed = true;
        (bool ok, ) = txn.to.call{value: txn.value}(txn.data);
        require(ok, "MarketsAdminMultisig: call failed");

        emit TransactionExecuted(txId, msg.sender);
    }
}

