# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Continuous integration (`lint → typecheck → test → build`) on Node 20 and 22.
- CodeQL static analysis and Dependabot dependency/action updates.
- ESLint (flat config) and Prettier with `lint`, `lint:fix`, `format`, and
  `format:check` scripts; `engines.node >= 20`. Unused imports are an
  auto-fixable lint error (via `eslint-plugin-unused-imports`) that gates CI.
- Project governance: `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  pull-request and issue templates, and `CODEOWNERS`.
- Markets list: skeleton loading state, sort control (trending / closing soon /
  newest), result count, and a clearer empty state.
- Redesigned market cards — probability headline, split YES/NO bar, Yes/No
  price chips, and a subtle hover lift — for a premium, at-a-glance read.
- Animated count-up on headline metrics (markets hero stats and the dashboard
  balance), with `prefers-reduced-motion` respected.
- Ledger rows surface a verifiable-receipt indicator.

### Removed

- Unused `mockData` fixtures (277 lines) and seven dead UI components/helpers
  (`StatusDigestCard`, `DigestCell`, `RiskCheckPanel`, `FAQSection`,
  `SiteFooter`, `WalletPill`, `formatPayLifecycle`).
- ~70 unused imports and assorted dead locals across the app, server, and API.

### Fixed

- Irregular-whitespace separator in the QR share card (now a proper ellipsis).
