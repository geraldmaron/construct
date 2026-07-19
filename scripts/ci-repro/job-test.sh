#!/usr/bin/env bash
# scripts/ci-repro/job-test.sh — the command sequence of ci.yml's `test` job,
# run inside the replica container. tests/scripts/ci-repro-drift.test.mjs
# asserts these commands stay aligned (same core invocations, same order) with
# the workflow's run: steps.
#
# The repo is CLONED from the read-only /src mount, not copied: a clone of
# HEAD sheds gitignored state (node_modules, .construct derived stores, dist) that a
# cp would drag in, which is the whole point of a fresh-checkout replica. The
# clone lands in /opt — NOT /tmp — because the suite's own cleanup sweeps /tmp.
# SHARD (i/n), when set by run.sh, forwards to the runner's --shard flag.

set -euo pipefail

# The bind-mounted repo is owned by the host uid, not `runner`; without this,
# git refuses the clone with "detected dubious ownership". The container is
# ephemeral, so the blanket allowlist is safe.

git config --global --add safe.directory '*'

sudo install -d -o "$(id -u)" -g "$(id -g)" /opt/construct
git clone /src /opt/construct
cd /opt/construct

npm ci --ignore-scripts
bash scripts/ci/build-test-fixtures.sh
npm test ${SHARD:+-- --shard="$SHARD"}
npm run doctor
npm run docs:verify
