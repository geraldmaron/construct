#!/usr/bin/env bash
# scripts/ci/setup-mermaid-cli.sh — install pinned mermaid-cli (mmdc) for CI
# figure rendering. Runs AFTER `npm ci` because the Docker replica
# (scripts/ci-repro/Dockerfile) installs Node after setup-toolchain.sh.
#
# Installs into ~/.local/mermaid-cli and symlinks mmdc into ~/.local/bin so the
# same PATH append used for typst/bd/d2 also covers mermaid. Also installs the
# puppeteer peer + Chrome for Testing under a prefix-local cache: without a
# resolvable browser, mmdc tries a retired Playwright CDN (404) and DOCX/PDF
# figure gates fail. Templates/distribution/mermaid-puppeteer.json supplies
# --no-sandbox for Ubuntu runners; lib/diagram-export.mjs merges executablePath.

set -euo pipefail

MMDC_VERSION="11.4.2"
PUPPETEER_VERSION="23.11.1"
BIN_DIR="$HOME/.local/bin"
PREFIX="$HOME/.local/mermaid-cli"
export PUPPETEER_CACHE_DIR="${PUPPETEER_CACHE_DIR:-$PREFIX/puppeteer-cache}"

mkdir -p "$BIN_DIR" "$PREFIX" "$PUPPETEER_CACHE_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to install @mermaid-js/mermaid-cli@$MMDC_VERSION" >&2
  exit 1
fi

npm install --prefix "$PREFIX" --no-fund --no-audit \
  "@mermaid-js/mermaid-cli@${MMDC_VERSION}" \
  "puppeteer@${PUPPETEER_VERSION}"
ln -sfn "$PREFIX/node_modules/.bin/mmdc" "$BIN_DIR/mmdc"

if ! "$BIN_DIR/mmdc" --version >/dev/null 2>&1; then
  echo "mmdc install failed: $BIN_DIR/mmdc is not runnable" >&2
  exit 1
fi

npx --prefix "$PREFIX" puppeteer browsers install chrome

# Shared libraries Chrome needs on Ubuntu (libnss, libgbm, …). Prefer the
# repo-local playwright CLI after npm ci so release.yml never calls npx directly
# (tests/audit/f07-cicd/release-tooling-pin.test.mjs).

if [ -x "node_modules/.bin/playwright" ]; then
  if command -v sudo >/dev/null 2>&1; then
    sudo node_modules/.bin/playwright install-deps chromium || node_modules/.bin/playwright install-deps chromium || true
  else
    node_modules/.bin/playwright install-deps chromium || true
  fi
fi

CHROME=""
while IFS= read -r -d '' candidate; do
  case "$candidate" in
    */chrome-linux64/chrome|*/chrome-linux/chrome|*/MacOS/Google\ Chrome\ for\ Testing)
      CHROME="$candidate"
      break
      ;;
  esac
done < <(find "$PUPPETEER_CACHE_DIR" -type f \( -name chrome -o -name 'Google Chrome for Testing' \) -print0 2>/dev/null)

if [ -z "${CHROME:-}" ]; then
  echo "puppeteer chrome install produced no chrome binary under $PUPPETEER_CACHE_DIR" >&2
  exit 1
fi

if [ -n "${GITHUB_ENV:-}" ]; then
  echo "PUPPETEER_EXECUTABLE_PATH=$CHROME" >> "$GITHUB_ENV"
  echo "PUPPETEER_CACHE_DIR=$PUPPETEER_CACHE_DIR" >> "$GITHUB_ENV"
fi

echo "installed mermaid-cli $MMDC_VERSION -> $BIN_DIR/mmdc"
echo "puppeteer chrome -> $CHROME"
