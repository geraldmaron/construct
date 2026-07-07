#!/usr/bin/env bash
# scripts/ci-repro/run.sh — build and run the local Docker replica of ci.yml's
# `test` job (`npm run ci:local`). Usage:
#
#   npm run ci:local                       # node 22, full suite
#   npm run ci:local -- --node 20          # node 20 leg
#   npm run ci:local -- --shard 1/3        # one CI shard
#
# The build context is scripts/ (not the repo root) so the image can COPY both
# scripts/ci/setup-toolchain.sh and scripts/ci-repro/job-test.sh without
# shipping the whole worktree to the docker daemon. The container clones the
# repo's committed HEAD from the read-only /src mount — uncommitted changes are
# NOT exercised, hence the dirty-tree warning. Linked git worktrees keep their
# object store in the primary repo's .git, so that directory is bind-mounted
# read-only at its identical host path for the clone to resolve.

set -euo pipefail

NODE_VERSION=22
SHARD=""
while [ $# -gt 0 ]; do
  case "$1" in
    --node) NODE_VERSION="${2:?--node requires a value}"; shift 2 ;;
    --node=*) NODE_VERSION="${1#--node=}"; shift ;;
    --shard) SHARD="${2:?--shard requires a value}"; shift 2 ;;
    --shard=*) SHARD="${1#--shard=}"; shift ;;
    *) echo "unknown argument: $1" >&2; echo "usage: run.sh [--node 20|22] [--shard i/n]" >&2; exit 1 ;;
  esac
done

case "$NODE_VERSION" in
  20|22) ;;
  *) echo "unsupported --node ${NODE_VERSION}: ci.yml tests node 20 and 22" >&2; exit 1 ;;
esac

REPO_ROOT="$(git rev-parse --show-toplevel)"

if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
  echo "" >&2
  echo "!!! WARNING: working tree is dirty. The replica clones committed HEAD —" >&2
  echo "!!! uncommitted changes will NOT be exercised. Commit first for a true run." >&2
  echo "" >&2
fi

docker build \
  -t "construct-ci:node${NODE_VERSION}" \
  --build-arg "NODE_VERSION=${NODE_VERSION}" \
  -f "$REPO_ROOT/scripts/ci-repro/Dockerfile" \
  "$REPO_ROOT/scripts"

RUN_ARGS=(--rm -e CI=true -e CONSTRUCT_EMBEDDING_MODEL=hashing -v "$REPO_ROOT":/src:ro)
if [ -n "$SHARD" ]; then
  RUN_ARGS+=(-e "SHARD=${SHARD}")
fi

GIT_COMMON_DIR="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)"
if [ "$GIT_COMMON_DIR" != "$REPO_ROOT/.git" ]; then
  RUN_ARGS+=(-v "$GIT_COMMON_DIR":"$GIT_COMMON_DIR":ro)
fi

docker run "${RUN_ARGS[@]}" "construct-ci:node${NODE_VERSION}" bash /repro/job-test.sh
