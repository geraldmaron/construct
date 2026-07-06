#!/usr/bin/env bash
#
# scripts/install.sh — curl installer for the compiled Construct binary.
#
# Detects OS/arch, downloads the matching Bun-compiled binary from a GitHub
# Release, verifies its sha256 sidecar, and installs it to a directory on
# PATH. No Node, no npm, no Docker required. Mirrors the shape of rustup.rs
# and Bun's own install.sh: fetch, checksum, chmod, place, print next steps.
#
# ${REPO} and ${VERSION} are the only two moving parts; both are overridable
# so this same script serves the "latest" curl-pipe flow and pinned installs:
#
#   curl -fsSL https://raw.githubusercontent.com/${REPO}/main/scripts/install.sh | bash
#   curl -fsSL .../install.sh | CONSTRUCT_VERSION=v1.4.2 bash
#
# The download URL pattern below (github.com/${REPO}/releases/download/${VERSION}/...)
# matches the asset names release.yml already publishes for the Node-SEA binaries
# (construct-<os>-<arch>); the Bun build path lands on the same naming convention so
# this installer works unchanged once Bun binaries are attached to a release.
set -euo pipefail

REPO="${CONSTRUCT_REPO:-geraldmaron/construct}"
VERSION="${CONSTRUCT_VERSION:-latest}"
INSTALL_DIR="${CONSTRUCT_INSTALL_DIR:-}"
TMP_DIR=""

log() { printf '[construct-install] %s\n' "$1"; }
die() { printf '[construct-install] error: %s\n' "$1" >&2; exit 1; }

detect_platform() {
  local os arch
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *) die "unsupported OS: $(uname -s). Supported: macOS, Linux." ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64) arch="x64" ;;
    *) die "unsupported architecture: $(uname -m). Supported: arm64, x64." ;;
  esac
  echo "${os}-${arch}"
}

pick_install_dir() {
  if [ -n "$INSTALL_DIR" ]; then
    echo "$INSTALL_DIR"
    return
  fi
  if [ -w "/usr/local/bin" ] 2>/dev/null; then
    echo "/usr/local/bin"
  else
    echo "${HOME}/.local/bin"
  fi
}

download() {
  local url="$1" out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$out"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$out"
  else
    die "neither curl nor wget found — install one and retry"
  fi
}

verify_checksum() {
  local binary="$1" sha_file="$2"
  local expected actual
  expected="$(awk '{print $1}' "$sha_file")"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$binary" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$binary" | awk '{print $1}')"
  else
    die "neither sha256sum nor shasum found — cannot verify checksum"
  fi
  [ "$expected" = "$actual" ] || die "checksum mismatch for ${binary} (expected ${expected}, got ${actual})"
}

main() {
  # TMP_DIR is process-global (not `local`) because the EXIT trap below runs
  # after main() returns, once any function-local variable has gone out of
  # scope — a `local` var here reads as unset under `set -u` at that point.
  local platform asset base_url binary_path sha_path install_dir
  platform="$(detect_platform)"
  asset="construct-${platform}"
  install_dir="$(pick_install_dir)"

  if [ "$VERSION" = "latest" ]; then
    base_url="https://github.com/${REPO}/releases/latest/download"
  else
    base_url="https://github.com/${REPO}/releases/download/${VERSION}"
  fi

  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT

  log "platform: ${platform}"
  log "downloading ${asset} from ${base_url}"
  binary_path="${TMP_DIR}/${asset}"
  sha_path="${binary_path}.sha256"
  download "${base_url}/${asset}" "$binary_path"
  download "${base_url}/${asset}.sha256" "$sha_path"

  log "verifying checksum"
  verify_checksum "$binary_path" "$sha_path"

  mkdir -p "$install_dir"
  if [ ! -w "$install_dir" ]; then
    die "no write permission for ${install_dir} — re-run with sudo, or set CONSTRUCT_INSTALL_DIR to a writable directory"
  fi

  chmod +x "$binary_path"
  mv "$binary_path" "${install_dir}/construct"
  log "installed to ${install_dir}/construct"

  case ":$PATH:" in
    *":${install_dir}:"*) ;;
    *) log "note: ${install_dir} is not on your PATH — add it to your shell profile" ;;
  esac

  log "run 'construct init' in a project, or 'construct doctor' to check the install"
}

main "$@"
