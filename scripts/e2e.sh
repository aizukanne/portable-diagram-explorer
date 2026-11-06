#!/usr/bin/env bash
# Run the browser tests inside the pinned Playwright container (no host installs).
# Dependencies install into ./node_modules (gitignored) from package-lock.json.
# Usage: scripts/e2e.sh [playwright test args...]
set -euo pipefail
cd "$(dirname "$0")/.."
PW_VERSION="1.64.1"
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"
name="pde-e2e-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
install='npm ci --no-audit --no-fund >/dev/null'
[ -f package-lock.json ] || install='npm install --no-audit --no-fund >/dev/null'
docker run --rm --name "$name" --init --ipc=host \
  -u "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
  -v "$PWD":/work -w /work "$IMAGE" \
  bash -c "$install && npx playwright test -c playwright.config.mjs $*"
