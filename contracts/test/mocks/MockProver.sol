// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Stand-in for Polymer's CrossL2ProverV2. The real prover cryptographically
 * validates a cross-chain event proof; for unit tests we let each test craft
 * the exact (chainId, emitter, topics, unindexedData) tuple it wants by
 * abi-encoding it as the `proof` bytes. This isolates QrPaymentSettlement's
 * own logic (authorization, replay, decoding, payout) from proof validation,
 * which is Polymer's responsibility and is out of scope for these tests.
 */
contract MockProver {
    function validateEvent(bytes calldata proof)
        external
        pure
        returns (uint32 chainId, address emittingContract, bytes memory topics, bytes memory unindexedData)
    {
        return abi.decode(proof, (uint32, address, bytes, bytes));
    }
}
