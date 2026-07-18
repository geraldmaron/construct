#!/usr/bin/env bash
# merge-and-test.sh — create a scratch integration worktree, merge the three
# spike-C worker branches into it in sequence, then run the full suite
# (npm test) against the merged tree for whole-system validation.
#
# Usage: merge-and-test.sh <scratch-dir>
set -euo pipefail

SCRATCH="${1:?usage: merge-and-test.sh <scratch-dir>}"

cd "$SCRATCH/base-repo"
git worktree add "$SCRATCH/integration" -b spike-c/integration HEAD

cd "$SCRATCH/integration"
git merge --no-edit spike-c/worker-a-artifact-type-tests
git merge --no-edit spike-c/worker-b-model-tiers-tests
git merge --no-edit spike-c/worker-c-vscode-paths-tests

git log --oneline --graph -8
git diff --stat HEAD~3 HEAD || true

npm install --no-audit --no-fund
npm test
