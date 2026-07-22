#!/usr/bin/env bash
# graph-independence-check.sh — the construct-graph commands used to prove
# the three spike-C target files share no dependents, run from the real
# feat/workspace-control-plane worktree (read-only query, no mutation).
set -euo pipefail

cd "$(dirname "$0")/../../../../../.." # repo root of the worktree this script ships in

for id in \
  "file:lib/artifact-type-from-path.mjs" \
  "file:lib/model-tiers.mjs" \
  "file:lib/vscode-paths.mjs"
do
  echo "=== $id ==="
  node bin/construct graph query "$id"
  echo
done
