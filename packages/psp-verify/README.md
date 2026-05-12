# @disburse/psp-verify

Verify [Disburse](https://disburse.app) **Portable Settlement Proofs (PSP)** — independently, with zero Disburse infrastructure dependency.

A PSP is a signed, content-addressed proof that a specific stablecoin invoice was settled onchain (on Arc, optionally via cross-chain Polymer proof). This package lets anyone verify a PSP:

- **Offline** — from a single JSON blob + issuer address
- **In CI** — via the CLI
- **Onchain** — via `verifyOnline()` calling `PspVerifier.sol` on Arc

## Install

```bash
npm install @disburse/psp-verify
```

## Library usage

```typescript
import { verify, verifyJson } from "@disburse/psp-verify";

// From a parsed object
const result = await verify(pspDocument);
// result.ok === true means valid

// From a JSON string
const result2 = await verifyJson(jsonString, {
  expectedIssuer: "0x..." // optional: restrict to a known issuer
});

if (result2.ok) {
  console.log(result2.fields.requestId);
  console.log(result2.fields.amount);
}
```

## CLI usage

```bash
# Verify a PSP file
npx psp-verify proof.json

# Verify with a specific expected issuer
npx psp-verify proof.json --issuer 0xYourIssuerAddress

# Pipe from stdin
cat proof.json | npx psp-verify --stdin
```

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Valid PSP |
| 1 | Invalid or error |

## What is verified

1. **Structure** — version, required fields, format checks
2. **Digest** — recomputes canonical bytes → keccak256 matches the claimed digest
3. **UID** — derived from digest, must match
4. **Signature** — `ecrecover` on the EIP-191 signed digest matches the claimed issuer

## Canonicalization

The canonical form is:

```
"DISBURSE-PSP-v1\n" + networkMode + "\n" + deterministicJSON(core)
```

- Keys sorted lexicographically at every depth
- Hex values lowercased
- Undefined/null fields omitted
- Arrays preserve order

The digest is `keccak256(canonicalBytes)`.

## License

MIT
