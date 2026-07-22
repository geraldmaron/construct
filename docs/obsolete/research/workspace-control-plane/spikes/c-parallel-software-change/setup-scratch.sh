#!/usr/bin/env bash
# setup-scratch.sh — clone the worktree into a scratch dir and create one
# throwaway git worktree per spike-C sub-task, each on its own branch, rooted
# outside this repo's own worktree tree so nothing registers against it.
#
# Usage: setup-scratch.sh <scratch-dir> <path-to-this-worktree>
set -euo pipefail

SCRATCH="${1:?usage: setup-scratch.sh <scratch-dir> <worktree-path>}"
WORKTREE="${2:?usage: setup-scratch.sh <scratch-dir> <worktree-path>}"

mkdir -p "$SCRATCH"
git clone --no-hardlinks "$WORKTREE" "$SCRATCH/base-repo"

cd "$SCRATCH/base-repo"
git worktree add -b spike-c/worker-a-artifact-type-tests "$SCRATCH/worker-a" HEAD
git worktree add -b spike-c/worker-b-model-tiers-tests    "$SCRATCH/worker-b" HEAD
git worktree add -b spike-c/worker-c-vscode-paths-tests   "$SCRATCH/worker-c" HEAD

git worktree list
