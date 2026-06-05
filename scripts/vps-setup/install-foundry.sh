#!/usr/bin/env bash
#
# One-time Foundry setup for the VPS, plus a run of the contract test suite.
# Run from anywhere inside the repo checkout:
#
#   bash scripts/vps-setup/install-foundry.sh
#
set -euo pipefail

# Install foundryup + the forge/cast/anvil binaries into ~/.foundry/bin.
if ! command -v forge >/dev/null 2>&1 && [ ! -x "$HOME/.foundry/bin/forge" ]; then
  echo "Installing Foundry..."
  curl -L https://foundry.paradigm.xyz | bash
fi
export PATH="$HOME/.foundry/bin:$PATH"
foundryup

# forge-std lives in a git submodule; make sure it's present.
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
git submodule update --init --recursive

echo "Running contract test suite..."
forge test --root contracts -vvv
