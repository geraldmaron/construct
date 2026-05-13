#!/usr/bin/env bash
# .construct/bootstrap.sh — POSIX bootstrap shim.
#
# Usage:
#   ./.construct/bootstrap.sh                  # probe environment, print plan
#   ./.construct/bootstrap.sh --install        # ensure a working Construct is reachable
#   ./.construct/bootstrap.sh -- <args…>       # invoke construct directly with args
#
# Forwards everything after `--` to construct via the same resolution order
# as `.construct/run.mjs`. Useful for non-Node environments where settings.json
# hooks aren't enough — e.g. CI scripts, Makefiles, pre-commit hooks in
# language-agnostic projects.
#
# Exit codes:
#   0   command succeeded
#   1   construct exited non-zero
#   127 no Construct install reachable

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION_FILE="${SCRIPT_DIR}/version"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CACHE_BIN_DIR="${SCRIPT_DIR}/cache/bin"

VERSION=""
if [ -r "${VERSION_FILE}" ]; then
  VERSION="$(tr -d '[:space:]' < "${VERSION_FILE}")"
fi

INSTALL_MODE=""
if [ "$#" -gt 0 ] && [ "$1" = "--install" ]; then
  INSTALL_MODE="1"
  shift
fi

if [ "$#" -gt 0 ] && [ "$1" = "--" ]; then
  shift
fi

probe_node() {
  command -v node >/dev/null 2>&1 || return 1
  node --version | sed 's/^v//' | awk -F. '{ exit ($1 < 18) }'
}

probe_npx()    { command -v npx >/dev/null 2>&1; }
probe_docker() { command -v docker >/dev/null 2>&1; }
probe_curl()   { command -v curl >/dev/null 2>&1; }

resolve_arch() {
  case "$(uname -m)" in
    arm64|aarch64) echo "arm64" ;;
    x86_64|amd64)  echo "x64" ;;
    *) echo "" ;;
  esac
}

resolve_os() {
  case "$(uname -s)" in
    Darwin) echo "darwin" ;;
    Linux)  echo "linux" ;;
    *) echo "" ;;
  esac
}

local_construct_in_node_modules() {
  echo "${PROJECT_ROOT}/node_modules/@geraldmaron/construct/bin/construct"
}

invoke_via_node_modules() {
  local bin
  bin="$(local_construct_in_node_modules)"
  [ -x "${bin}" ] || return 1
  exec node "${bin}" "$@"
}

invoke_via_npx() {
  probe_node || return 1
  probe_npx  || return 1
  if [ -n "${VERSION}" ]; then
    exec npx -p "@geraldmaron/construct@${VERSION}" -- construct "$@"
  else
    exec npx -p "@geraldmaron/construct" -- construct "$@"
  fi
}

invoke_via_global() {
  command -v construct >/dev/null 2>&1 || return 1
  exec construct "$@"
}

invoke_via_cached_binary() {
  local os arch ext binary
  os="$(resolve_os)"
  arch="$(resolve_arch)"
  [ -n "${os}" ] && [ -n "${arch}" ] || return 1
  binary="${CACHE_BIN_DIR}/construct-${os}-${arch}"
  [ -x "${binary}" ] || return 1
  exec "${binary}" "$@"
}

invoke_via_docker() {
  probe_docker || return 1
  local image="ghcr.io/geraldmaron/construct"
  if [ -n "${VERSION}" ]; then image="${image}:${VERSION}"; else image="${image}:latest"; fi
  exec docker run --rm \
    -v "${PROJECT_ROOT}:/work" -w /work \
    -v "${HOME}/.construct:/data/.construct" \
    -e CONSTRUCT_PROJECT_ROOT=/work \
    "${image}" "$@"
}

# Compute the SHA-256 of a file using whichever tool is available, and compare
# to the expected digest. Accepts the digest as either a bare hex string or a
# `sha256sum -c`-style line ("<sha>  <filename>"); we only consume the first
# 64 hex chars. Returns 0 on match, non-zero otherwise.
verify_sha256() {
  local file="$1"
  local expected_raw="$2"
  local expected
  local actual
  expected="$(echo "${expected_raw}" | tr -d '[:space:]' | cut -c1-64)"
  if [ -z "${expected}" ] || [ "${#expected}" -ne 64 ]; then
    return 1
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "${file}" | cut -c1-64)"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "${file}" | cut -c1-64)"
  else
    return 2
  fi
  [ "${actual}" = "${expected}" ]
}

if [ "${INSTALL_MODE}" = "1" ]; then
  if invoke_via_node_modules --version >/dev/null 2>&1; then
    echo "[construct] node_modules install ready: $(local_construct_in_node_modules)"
    exit 0
  fi
  if probe_node && probe_npx; then
    echo "[construct] npx will resolve construct on first invocation."
    exit 0
  fi
  if probe_docker; then
    echo "[construct] docker available — bootstrap will use the container image on next run."
    exit 0
  fi
  os="$(resolve_os)"
  arch="$(resolve_arch)"
  if probe_curl && [ -n "${os}" ] && [ -n "${arch}" ] && [ -n "${VERSION}" ]; then
    binary_url="https://github.com/geraldmaron/construct/releases/download/v${VERSION}/construct-${os}-${arch}"
    sha_url="${binary_url}.sha256"
    mkdir -p "${CACHE_BIN_DIR}"
    target="${CACHE_BIN_DIR}/construct-${os}-${arch}"
    target_sha="${target}.sha256"
    echo "[construct] downloading binary to ${target}…"
    if ! curl -fL "${binary_url}" -o "${target}"; then
      echo "[construct] binary download failed; falling through." >&2
      rm -f "${target}"
    elif ! curl -fL "${sha_url}" -o "${target_sha}"; then
      echo "[construct] SHA-256 download failed at ${sha_url}; refusing to install an unverified binary." >&2
      rm -f "${target}" "${target_sha}"
    elif ! verify_sha256 "${target}" "$(cat "${target_sha}")"; then
      echo "[construct] SHA-256 mismatch; refusing to install. Re-run to retry." >&2
      rm -f "${target}" "${target_sha}"
    else
      chmod +x "${target}"
      rm -f "${target_sha}"
      echo "[construct] binary cached and SHA-verified. Subsequent invocations use it."
      exit 0
    fi
  fi
  echo "[construct] No installable runtime detected." >&2
  echo "  Install one of: Node.js 18+, Docker, or curl + a release binary." >&2
  exit 127
fi

# Default mode — resolve and invoke construct with whatever args were passed.
invoke_via_node_modules "$@" 2>/dev/null || true
invoke_via_npx          "$@" 2>/dev/null || true
invoke_via_global       "$@" 2>/dev/null || true
invoke_via_cached_binary "$@" 2>/dev/null || true
invoke_via_docker        "$@" 2>/dev/null || true

cat >&2 <<EOF
[construct] No Construct install found.

  This project pins Construct${VERSION:+ ${VERSION}} but no runtime resolved.

  Pick one:
    - Install Node.js 18+ from https://nodejs.org and re-run.
    - Run ./.construct/bootstrap.sh --install to download a binary.
    - Install Construct globally: npm install -g @geraldmaron/construct
EOF
exit 127
