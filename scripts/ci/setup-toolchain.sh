#!/usr/bin/env bash
# scripts/ci/setup-toolchain.sh — single source of truth for the CI test job's
# external tool dependencies. Consumed by .github/workflows/ci.yml AND baked
# into the local Docker replica (scripts/ci-repro/Dockerfile), so the replica
# cannot drift from what CI actually installs.
#
# Installs, idempotently (each tool is skipped when already present at the
# pinned version):
#   - typst   — pinned GitHub release binary, sha256-verified, to ~/.local/bin.
#               Pinned to the same version `cargo install --locked typst-cli`
#               resolves (crates.io max stable) so PDF output does not shift.
#   - bd      — pinned beads release binary, sha256-verified, to ~/.local/bin.
#               Fallback when GitHub release assets are unavailable (requires a
#               Go toolchain; intentionally not automated here):
#                 go install github.com/steveyegge/beads/cmd/bd@v1.1.0
#   - d2      — pinned terrastruct/d2 release binary, sha256-verified, to
#               ~/.local/bin. Required when exports run with figures:true
#               (document-io certify + rendered-artifact visual gate).
#   - doc toolchain — pandoc + poppler + LibreOffice via the platform package
#               manager. Linux installs the writer/impress/calc component
#               packages instead of the huge `libreoffice` metapackage; the
#               export suites (document-export, rendered-artifact,
#               libreoffice-export) only convert text/presentation/spreadsheet
#               documents.
#
# Mermaid-cli (mmdc) needs npm, so it lives in scripts/ci/setup-mermaid-cli.sh
# and runs after `npm ci` (the Docker replica installs Node after this script).
#
# Network bounds: apt uses Acquire::{http,https}::Timeout=30 and Retries=3 so a
# dead Ubuntu mirror fails in minutes instead of hanging; curl uses
# --connect-timeout 15 --max-time 180 for pinned release downloads (typst/bd/d2
# archives are small; 180s is generous headroom without unbounded waits).
#
# Callers must put ~/.local/bin on PATH (ci.yml appends it to $GITHUB_PATH;
# the Docker replica sets ENV PATH).

set -euo pipefail

APT_OPTS=(
  -o Acquire::http::Timeout=30
  -o Acquire::https::Timeout=30
  -o Acquire::Retries=3
)
CURL_OPTS=(--connect-timeout 15 --max-time 180 --retry 3)

TYPST_VERSION="0.15.0"
TYPST_SHA256_LINUX_X86_64="59b207df01be2dab9f13e80f73d04d7ff8273ffd46b3dd1b9eef5c60f3eeabea"
TYPST_SHA256_LINUX_AARCH64="cdf50ffc7b8ba759ed02200632eda3d78eb8b99aacb6611f4f75684990647620"
TYPST_SHA256_DARWIN_ARM64="fe53838737abf93a774495952a1a797b4686e9c4a21c2d99b9fdf77f46cc3572"

BD_VERSION="1.1.0"
BD_SHA256_LINUX_AMD64="b0f3dd607c3fb989ee08d0a6854fba80d0402971eb108f9af6170bc14d491a34"
BD_SHA256_LINUX_ARM64="e64eb6f5f998c9eae3ef9ec786f5f1c907ab3ed04fe220ebf265ca9952e21b2f"
BD_SHA256_DARWIN_ARM64="c42e24d83b258f7ba9f52a6d2d5f6b055869dfe7807165055988b12e7ea8c564"

D2_VERSION="0.7.1"
D2_SHA256_LINUX_AMD64="eb172adf59f38d1e5a70ab177591356754ffaf9bebb84e0ca8b767dfb421dad7"
D2_SHA256_LINUX_ARM64="ce3a0b985a8f91335a826c254b3a88736fd81afcdd08b58f6c749d2add6864b0"
D2_SHA256_DARWIN_ARM64="80de85f3b0ac7d9569acac0780ed65dd994ea78969b6b230c58bbb2c6113465b"

BIN_DIR="$HOME/.local/bin"
OS="$(uname -s)"
ARCH="$(uname -m)"

sha256_check() {
  local file="$1" expected="$2" actual
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$file" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  fi
  if [ "$actual" != "$expected" ]; then
    echo "sha256 mismatch for $file: expected $expected, got $actual" >&2
    return 1
  fi
}

install_typst() {
  if [ -x "$BIN_DIR/typst" ] && "$BIN_DIR/typst" --version 2>/dev/null | grep -q "^typst $TYPST_VERSION"; then
    echo "typst $TYPST_VERSION already installed, skipping"
    return
  fi
  local target sha
  case "$OS/$ARCH" in
    Linux/x86_64)  target="x86_64-unknown-linux-musl";  sha="$TYPST_SHA256_LINUX_X86_64" ;;
    Linux/aarch64) target="aarch64-unknown-linux-musl"; sha="$TYPST_SHA256_LINUX_AARCH64" ;;
    Darwin/arm64)  target="aarch64-apple-darwin";       sha="$TYPST_SHA256_DARWIN_ARM64" ;;
    *) echo "no pinned typst asset for $OS/$ARCH" >&2; exit 1 ;;
  esac
  local tmp
  tmp="$(mktemp -d)"
  curl -fsSL "${CURL_OPTS[@]}" -o "$tmp/typst.tar.xz" \
    "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${target}.tar.xz"
  sha256_check "$tmp/typst.tar.xz" "$sha"
  tar -xJf "$tmp/typst.tar.xz" -C "$tmp" "typst-${target}/typst"
  install -m 0755 "$tmp/typst-${target}/typst" "$BIN_DIR/typst"
  rm -rf "$tmp"
  echo "installed typst $TYPST_VERSION -> $BIN_DIR/typst"
}

install_bd() {
  if [ -x "$BIN_DIR/bd" ] && "$BIN_DIR/bd" version 2>/dev/null | grep -qF "version $BD_VERSION"; then
    echo "bd $BD_VERSION already installed, skipping"
    return
  fi
  local target sha
  case "$OS/$ARCH" in
    Linux/x86_64)  target="linux_amd64";  sha="$BD_SHA256_LINUX_AMD64" ;;
    Linux/aarch64) target="linux_arm64";  sha="$BD_SHA256_LINUX_ARM64" ;;
    Darwin/arm64)  target="darwin_arm64"; sha="$BD_SHA256_DARWIN_ARM64" ;;
    *) echo "no pinned bd asset for $OS/$ARCH" >&2; exit 1 ;;
  esac
  local tmp
  tmp="$(mktemp -d)"
  curl -fsSL "${CURL_OPTS[@]}" -o "$tmp/bd.tar.gz" \
    "https://github.com/steveyegge/beads/releases/download/v${BD_VERSION}/beads_${BD_VERSION}_${target}.tar.gz"
  sha256_check "$tmp/bd.tar.gz" "$sha"
  tar -xzf "$tmp/bd.tar.gz" -C "$tmp" bd
  install -m 0755 "$tmp/bd" "$BIN_DIR/bd"
  rm -rf "$tmp"
  echo "installed bd $BD_VERSION -> $BIN_DIR/bd"
}

install_d2() {
  if [ -x "$BIN_DIR/d2" ] && "$BIN_DIR/d2" --version 2>/dev/null | grep -qF "v${D2_VERSION}"; then
    echo "d2 $D2_VERSION already installed, skipping"
    return
  fi
  local asset sha
  case "$OS/$ARCH" in
    Linux/x86_64)  asset="d2-v${D2_VERSION}-linux-amd64.tar.gz";  sha="$D2_SHA256_LINUX_AMD64" ;;
    Linux/aarch64) asset="d2-v${D2_VERSION}-linux-arm64.tar.gz";  sha="$D2_SHA256_LINUX_ARM64" ;;
    Darwin/arm64)  asset="d2-v${D2_VERSION}-macos-arm64.tar.gz";  sha="$D2_SHA256_DARWIN_ARM64" ;;
    *) echo "no pinned d2 asset for $OS/$ARCH" >&2; exit 1 ;;
  esac
  local tmp
  tmp="$(mktemp -d)"
  curl -fsSL "${CURL_OPTS[@]}" -o "$tmp/d2.tar.gz" \
    "https://github.com/terrastruct/d2/releases/download/v${D2_VERSION}/${asset}"
  sha256_check "$tmp/d2.tar.gz" "$sha"
  tar -xzf "$tmp/d2.tar.gz" -C "$tmp" "d2-v${D2_VERSION}/bin/d2"
  install -m 0755 "$tmp/d2-v${D2_VERSION}/bin/d2" "$BIN_DIR/d2"
  rm -rf "$tmp"
  echo "installed d2 $D2_VERSION -> $BIN_DIR/d2"
}

install_doc_toolchain_linux() {
  local pkg missing=""
  for pkg in pandoc poppler-utils libreoffice-writer libreoffice-impress libreoffice-calc; do
    dpkg -s "$pkg" >/dev/null 2>&1 || missing="$missing $pkg"
  done
  if [ -z "$missing" ]; then
    echo "doc toolchain already installed, skipping"
    return
  fi
  sudo apt-get "${APT_OPTS[@]}" update
  # shellcheck disable=SC2086
  sudo DEBIAN_FRONTEND=noninteractive apt-get "${APT_OPTS[@]}" install -y --no-install-recommends $missing
}

install_doc_toolchain_darwin() {
  command -v pandoc >/dev/null 2>&1 || brew install pandoc
  command -v pdftoppm >/dev/null 2>&1 || brew install poppler
  if [ ! -x "/Applications/LibreOffice.app/Contents/MacOS/soffice" ] && ! command -v soffice >/dev/null 2>&1; then
    brew install --cask libreoffice
  fi
}

mkdir -p "$BIN_DIR"
install_typst
install_bd
install_d2
case "$OS" in
  Linux)  install_doc_toolchain_linux ;;
  Darwin) install_doc_toolchain_darwin ;;
  *) echo "unsupported platform: $OS" >&2; exit 1 ;;
esac

echo "toolchain ready: typst $TYPST_VERSION, bd $BD_VERSION, d2 $D2_VERSION, pandoc/poppler/libreoffice via $([ "$OS" = Linux ] && echo apt || echo brew)"
