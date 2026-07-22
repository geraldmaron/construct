#!/usr/bin/env bash
# teardown.sh — remove every worktree/branch/clone spike C created. The real
# feat/workspace-control-plane worktree is never touched by this script; it
# only operates inside the scratch clone.
#
# Usage: teardown.sh <scratch-dir>
set -euo pipefail

SCRATCH="${1:?usage: teardown.sh <scratch-dir>}"

cd "$SCRATCH/base-repo"
for wt in worker-a worker-b worker-c integration; do
  git worktree remove --force "$SCRATCH/$wt" 2>/dev/null || true
done
git worktree prune

cd /
rm -rf "$SCRATCH"
