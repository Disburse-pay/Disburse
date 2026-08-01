# Disburse Bridge architecture

Disburse Bridge is a separate, wallet-only surface for native USDC transfers.
It does not use Disburse IDs, the payment ledger, Circle Gateway balances,
wrapped assets, liquidity pools, swaps, or arbitrary destination calls.

## Supported route

The first release supports only Ethereum Sepolia ↔ Arc Testnet through Circle
CCTP V2 Standard Transfer. The browser creates Circle's official Bridge Kit
viem adapter from the connected EIP-1193 wallet provider. Bridge Kit performs
approval, burn, Circle attestation retrieval, and destination mint. USDC is
minted directly to the same connected wallet on the destination chain.

Chain IDs and CCTP domains are different namespaces. Ethereum Sepolia and Arc
Testnet are selected by Bridge Kit chain identifiers; Circle's contracts use
their independently defined CCTP domains. Disburse never derives one from the
other.

## State and recovery

Transfer progress is memory-only. It is never written to localStorage,
sessionStorage, IndexedDB, Redis, or a browser cache. The result preserves each
Bridge Kit step and transaction explorer link while the tab is open. A partial
result can be retried through Bridge Kit in the same tab. If the tab is lost
after a source burn, the source transaction remains the recovery anchor and
must be reconciled against Circle's attestation service and the destination
MessageTransmitter before another burn is attempted.

Redis remains limited to short-lived hashed API abuse counters for the payment
gateway. It is not involved in bridge execution or recovery. Supabase remains
the authoritative account-scoped ledger for gateway payments only.

## Fees and mainnet gate

Testnet platform fee is exactly 0 USDC and CCTP `maxFee` is capped at 0 for the
Standard route. A production fee may later use Bridge Kit's official
`customFee` mechanism, which is an additional source-chain debit and must be
shown before signature. No custom fee is configured in this build.

Arc mainnet is not represented by a route manifest and cannot be selected or
enabled by an environment flag. Enabling mainnet requires all of the following:

1. Circle-published Arc mainnet chain, domain, USDC, TokenMessengerV2, and
   MessageTransmitterV2 parameters independently verified from current primary
   sources.
2. A versioned production route manifest and test vectors.
3. Explicit fee amount, cap, recipient, accounting, refund, and disclosure
   policy.
4. Independent smart-contract/integration security review and incident runbook.
5. Staging rehearsal covering source success/destination failure recovery.

Until every gate is satisfied, production is a NO-GO.
