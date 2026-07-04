#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}${CONSTRUCT_DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL or CONSTRUCT_DATABASE_URL is required for the team harness." >&2
  exit 2
fi

export CONSTRUCT_DEPLOYMENT_MODE="${CONSTRUCT_DEPLOYMENT_MODE:-team}"
export CONSTRUCT_WORKER_ID="${CONSTRUCT_WORKER_ID:-team-harness-worker}"

node ./bin/construct db migrate
node ./bin/construct workers list --json
node --test \
  tests/pg-queue.test.mjs \
  tests/pg-queue-reliability.test.mjs \
  tests/team-health.test.mjs \
  tests/worker-runtime.test.mjs \
  tests/intake-queue-factory.test.mjs \
  tests/functional/mode-honesty.functional.test.mjs
