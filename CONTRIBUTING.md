# Contributing to Disburse

Thanks for helping build Disburse. This guide covers local setup, the checks
we expect to pass before review, and our branch/commit conventions.

## Prerequisites

- **Node 22** (see [`.nvmrc`](.nvmrc); `nvm use` picks it up). Node 20 LTS also works.
- npm 10+ (ships with Node).

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the values you need
npm run dev
```

Most of the frontend runs against the deployed testnet API, so you can build UI
without every key set. Contract, relay, and PSP work need the relevant secrets
from `.env.example` — never commit `.env.local`.

## Checks before you open a PR

CI runs these on every push; run them locally first so review is fast:

```bash
npm run lint        # ESLint — code style and correctness
npm run typecheck   # tsc -b, strict
npm test            # Vitest unit + API suites
npm run build       # production build must succeed
```

`npm run format` (Prettier) auto-fixes formatting; `npm run lint:fix` applies
safe lint fixes.

## Branches

Short, prefixed, kebab-case branches off `main`:

- `feat/<slug>` — new functionality
- `fix/<slug>` — bug fixes
- `chore/<slug>` — tooling, deps, config
- `docs/<slug>` — documentation only

## Commits

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(markets): add closing-soon sort to the markets list
fix(psp): canonicalize hex before digest
chore(ci): cache npm in the verify job
```

Keep commits focused and self-describing. Prefer several small commits over one
large mixed one.

## Pull requests

- Fill in the PR template (what changed, why, how it was verified).
- Keep PRs scoped to one concern; split unrelated changes.
- Add or update tests when behavior changes.
- Touching `contracts/`, PSP signing, secrets, or auth? Call it out explicitly
  so a maintainer can review the security implications. See [SECURITY.md](SECURITY.md).

## Reporting security issues

Do **not** open a public issue. Follow [SECURITY.md](SECURITY.md).
