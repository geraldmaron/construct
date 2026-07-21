#!/usr/bin/env bash
# scripts/ci/setup-mermaid-cli.sh — install pinned mermaid-cli (mmdc) for CI
# figure rendering. Runs AFTER `npm ci` because the Docker replica
# (scripts/ci-repro/Dockerfile) installs Node after setup-toolchain.sh.
#
# Installs into ~/.local/mermaid-cli and symlinks mmdc into ~/.local/bin so the
# same PATH append used for typst/bd/d2 also covers mermaid. Puppeteer downloads
# Chromium into the npm prefix on first install; mermaid-puppeteer.json supplies
# --no-sandbox for Ubuntu runners.

set -euo pipefail

MMDC_VERSION="11.4.2"
BIN_DIR="$HOME/.local/bin"
PREFIX="$HOME/.local/mermaid-cli"

mkdir -p "$BIN_DIR" "$PREFIX"

if [ -x "$BIN_DIR/mmdc" ] && "$BIN_DIR/mmdc" --version 2>/dev/null | grep -q .; then
  echo "mmdc already on PATH at $BIN_DIR/mmdc, skipping"
  exit 0
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to install @mermaid-js/mermaid-cli@$MMDC_VERSION" >&2
  exit 1
fi

npm install --prefix "$PREFIX" --no-fund --no-audit "@mermaid-js/mermaid-cli@${MMDC_VERSION}"
ln -sfn "$PREFIX/node_modules/.bin/mmdc" "$BIN_DIR/mmdc"

if ! "$BIN_DIR/mmdc" --version >/dev/null 2>&1; then
  echo "mmdc install failed: $BIN_DIR/mmdc is not runnable" >&2
  exit 1
fi

echo "installed mermaid-cli $MMDC_VERSION -> $BIN_DIR/mmdc"
