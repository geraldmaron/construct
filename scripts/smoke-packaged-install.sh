#!/usr/bin/env bash
# smoke-packaged-install.sh — the consumer's experience, tested before any
# consumer exists. v2's history is full of packaging defects (missing files
# in the tarball, broken postinstall) found only after users hit them.
# `npm pack` -> install the tarball into a scratch project -> run doctor.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

echo "== building =="
cd "$repo_root"
npm run build --silent

echo "== packing =="
tarball="$(npm pack --silent --pack-destination "$scratch")"
tarball_path="$scratch/$tarball"

echo "== installing into scratch project =="
project="$scratch/project"
mkdir -p "$project"
cd "$project"
npm init -y --silent >/dev/null
npm install --silent "$tarball_path"

echo "== running construct doctor from the packaged install =="
npx --no-install construct doctor

echo "== running construct version =="
npx --no-install construct version

echo "smoke-packaged-install: pass"
