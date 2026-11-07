#!/usr/bin/env bash
# Re-render the sample diagram PNGs and project.json from
# samples/customer-platform/layout.mjs, inside the pinned Playwright container.
set -euo pipefail
cd "$(dirname "$0")/.."
PW_VERSION="1.64.1"
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"
name="pde-render-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
docker run --rm --name "$name" --init --ipc=host \
  -u "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
  -v "$PWD":/work -w /work "$IMAGE" \
  bash -c "npm ci --no-audit --no-fund >/dev/null && node scripts/render-sample-images.mjs"
