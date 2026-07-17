# Security Policy

Disburse handles stablecoin settlement, signs portable settlement proofs (PSPs),
and operates smart contracts that custody liquidity. We take vulnerabilities
seriously and appreciate coordinated disclosure.

## Supported Versions

The `main` branch and the currently deployed app/contracts are in scope.
Testnet deployments (Arc, Base Sepolia, Monad) are in scope for severity
assessment but do not custody real funds.

## Reporting a Vulnerability

**Do not open a public issue for security reports.**

- Email **security@disburse.online** with a description, reproduction steps,
  and impact assessment.
- Alternatively, use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
  ("Report a vulnerability" under the repository's Security tab).
- PGP key available on request for sensitive details.

We aim to acknowledge reports within **2 business days** and to provide a
remediation timeline within **7 business days**.

## Scope — areas of particular interest

- **Smart contracts** (`contracts/`): settlement double-spend, proof
  forgery, access control on `onlyOwner` functions, liquidity-pool drain,
  market resolution manipulation.
- **PSP signing & verification** (`server/psp/`, `packages/psp-verify/`):
  signature forgery, canonicalization mismatches, domain-separator bypass.
- **Cross-chain relay** (`server/crosschain.ts`): replay across chains,
  Polymer proof validation gaps.
- **API & webhooks** (`api/`, `api-handlers/`, `server/`): authz bypass,
  HMAC signature bypass, SSRF, injection.
- **Secret handling**: any path that could leak `*_PRIVATE_KEY`,
  `*_SERVICE_ROLE_KEY`, or signing material into logs, responses, or the client bundle.

## Out of scope

- Vulnerabilities in third-party dependencies already tracked upstream
  (report those to the upstream project).
- Testnet faucet abuse, spam, or rate-limiting on non-fund-bearing endpoints.
- Reports generated solely by automated scanners without a demonstrated impact.

## Safe Harbor

We will not pursue legal action against researchers who act in good faith,
avoid privacy violations and service disruption, and give us reasonable time
to remediate before public disclosure.
