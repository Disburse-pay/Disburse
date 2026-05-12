# Portable Settlement Proof (PSP) — v1 Specification

**Status:** v1.0 (Arc Testnet)
**Issuer:** Disburse (https://disburse.app)
**Chain:** Arc Testnet (5042002)
**License:** MIT

---

## Abstract

A Portable Settlement Proof (PSP) is a signed, content-addressed, independently
verifiable JSON document proving that a specific stablecoin invoice was settled
by a specific on-chain transfer. PSPs verify three ways:

1. **Offline** — from a single JSON blob, using only the issuer's public key
2. **CLI** — `npx @disburse/psp-verify proof.json --issuer 0x…`
3. **On-chain** — by calling `PspVerifier.verify()` on Arc

No trust in Disburse infrastructure is required for verification.

---

## 1. Document Structure

A PSP v1 document is a JSON object with the following top-level fields:

| Field | Type | Description |
|-------|------|-------------|
| `version` | `1` | Schema version |
| `networkMode` | `"testnet" \| "mainnet"` | Target network |
| `issuer` | object | Issuer identity |
| `invoice` | object | Invoice/payment details |
| `settlement` | object | Arc settlement details |
| `source` | object? | Source chain details (cross-chain only) |
| `linkedDocuments` | array? | Linked UBL/PDF digests |
| `digest` | hex string | keccak256 of canonical bytes |
| `signature` | object | Issuer signature |
| `uid` | string | `psp:<first-16-hex-of-digest>` |
| `createdAt` | ISO-8601 | Issuance timestamp |

### 1.1 Issuer

```json
{
  "name": "Disburse",
  "url": "https://disburse.app",
  "publicKey": "0x..."  // EVM address (secp256k1)
}
```

### 1.2 Invoice

```json
{
  "requestId": "uuid",
  "label": "Service payment",
  "invoiceDate": "2025-06-01",
  "note": "optional",
  "payer": "0x...",
  "recipient": "0x...",
  "token": "USDC",
  "amount": "100.00"
}
```

### 1.3 Settlement

```json
{
  "chainId": 5042002,
  "txHash": "0x...",
  "blockNumber": "12345",
  "settledAt": "2025-06-01T12:00:00.000Z",
  "settlementEvent": {
    "contract": "0x...",
    "settlementId": "0x...",
    "eventTopic": "0x...",
    "logIndex": 3
  }
}
```

### 1.4 Source (optional, cross-chain only)

```json
{
  "chainId": 84532,
  "txHash": "0x...",
  "blockNumber": "98765",
  "payer": "0x...",
  "token": "0x...",
  "amount": "100000000",
  "polymerProofDigest": "0x..."
}
```

### 1.5 Signature

```json
{
  "alg": "secp256k1-keccak256",
  "value": "0x..."  // 65-byte compact recoverable signature
}
```

---

## 2. Canonicalization

The **canonical bytes** are the input to both digest and signature:

```
canonical_bytes = domain_separator || deterministic_json(core)
```

### 2.1 Domain Separator

```
"DISBURSE-PSP-v1\n" + networkMode + "\n"
```

For testnet: `DISBURSE-PSP-v1\ntestnet\n` (24 bytes)

### 2.2 Core Fields

The **core** is the PSP without `digest`, `signature`, `uid`, and `createdAt`.
Only fields that are defined and non-null are included.

### 2.3 Deterministic JSON

- Keys sorted lexicographically at every object depth
- Arrays preserve order
- No whitespace (no spaces, no newlines)
- Hex values (matching `^0x[0-9a-fA-F]+$`) are lowercased
- Undefined/null fields are omitted entirely
- Numbers and booleans use JSON default encoding

### 2.4 Digest

```
digest = keccak256(canonical_bytes)
```

### 2.5 UID

```
uid = "psp:" + digest[2:18]  // first 16 hex characters after "0x"
```

---

## 3. Signing

The issuer signs using **EIP-191 personal_sign**:

```
message = digest  (raw 32 bytes)
signature = personal_sign(message, issuer_private_key)
```

This produces a 65-byte compact recoverable signature. The signed hash is:

```
keccak256("\x19Ethereum Signed Message:\n32" || digest)
```

Verification recovers the signer address and compares to `issuer.publicKey`.

---

## 4. Verification

### 4.1 Offline Verification

1. Parse JSON → extract core (remove `digest`, `signature`, `uid`, `createdAt`)
2. Compute `expected_digest = keccak256(canonical_bytes(core))`
3. Assert `expected_digest == psp.digest`
4. Assert `psp.uid == "psp:" + expected_digest[2:18]`
5. Recover signer from EIP-191 signature over `expected_digest`
6. Assert recovered signer == `psp.issuer.publicKey`

### 4.2 On-chain Verification (PspVerifier.sol)

```solidity
function verify(
    bytes32 digest,
    bytes calldata signature,
    PspFields calldata fields
) external view returns (bool ok, address recoveredSigner);
```

The contract:
1. Recovers the signer from the EIP-191 signed digest
2. Checks the recovered signer matches the registered issuer
3. Checks `QrPaymentSettlement.settled(fields.settlementId)` returns true

### 4.3 Signature-Only Verification

For direct Arc payments where no cross-chain settlement event exists:

```solidity
function verifySignatureOnly(
    bytes32 digest,
    bytes calldata signature
) external view returns (bool ok, address recoveredSigner);
```

---

## 5. Security Considerations

- **Issuer key** is secp256k1 (EVM). Key rotation is handled by updating the
  on-chain `PspVerifier.issuer`. Old PSPs remain valid against the address
  that signed them at issuance time.
- **Digest binding** — tampering any field changes the digest, invalidating
  the signature. There is no known second-preimage for keccak256.
- **Settlement binding** — the on-chain verifier confirms the settlement
  actually occurred. A PSP cannot be fabricated for a payment that didn't happen.
- **Replay** — PSPs are idempotent proofs. "Replaying" a valid PSP is harmless;
  it simply re-proves the same settlement.

---

## 6. Reference Implementation

- TypeScript: `packages/psp-verify/` in the Disburse repository
- Solidity: `contracts/src/PspVerifier.sol`
- CLI: `npx @disburse/psp-verify`

---

## 7. Example PSP Document

```json
{
  "version": 1,
  "networkMode": "testnet",
  "issuer": {
    "name": "Disburse",
    "url": "https://disburse.app",
    "publicKey": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD75"
  },
  "invoice": {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "label": "API usage — May 2025",
    "invoiceDate": "2025-06-01",
    "payer": "0x1234567890123456789012345678901234567890",
    "recipient": "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    "token": "USDC",
    "amount": "150.00"
  },
  "settlement": {
    "chainId": 5042002,
    "txHash": "0xaabb...ccdd",
    "blockNumber": "12345",
    "settledAt": "2025-06-01T12:00:00.000Z",
    "settlementEvent": {
      "contract": "0x8c535227ed2b2963a3c1176510bc59e7a7fef07d",
      "settlementId": "0x1111...1111",
      "eventTopic": "0x2222...2222",
      "logIndex": 3
    }
  },
  "digest": "0xabcdef...",
  "signature": {
    "alg": "secp256k1-keccak256",
    "value": "0x..."
  },
  "uid": "psp:abcdef1234567890",
  "createdAt": "2025-06-01T12:01:00.000Z"
}
```

---

## 8. Changelog

- **v1.0** — Initial release. Arc Testnet. secp256k1 + keccak256. EIP-191 signing.
