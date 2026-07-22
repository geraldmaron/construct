#!/usr/bin/env bash
# scripts/ci/build-test-fixtures.sh — derived-state fixtures the test suite
# reads from the real checkout. Consumed by .github/workflows/ci.yml AND the
# local Docker replica (scripts/ci-repro/job-test.sh); run it from the repo
# root after `npm ci`.
#
# Living graph: .construct/graph is derived, gitignored state — the lint job's
# graph-drift-gate step rebuilds it independently, but the test job never did,
# so tests/graph/embed-nodes.test.mjs, tests/graph/explain.test.mjs, and
# tests/security/owasp-coverage.test.mjs (all of which read the real repo's
# built graph, not a fixture) had nothing to read on a fresh checkout.
#
# Vector index: tests/acceptance/modes/solo.acceptance.test.mjs's
# embedded-lancedb check calls storage_status against this checkout's real
# (machine-scoped, ADR-0066) LanceDB store, expecting 'healthy'.
# construct-rf26.17 made index provisioning lazy/opt-in (no more free eager
# seeding from `construct init`), so a fresh checkout's store is genuinely
# empty — call the same seeding function `construct init --seed-index` uses
# directly, rather than running full `construct init`: init also
# scaffolds/rewrites tracked files (AGENTS.md, CLAUDE.md,
# construct.config.json), which would pollute the checkout for the doctor and
# docs:verify steps that run right after the suite.

set -euo pipefail

node ./bin/construct graph build

node -e "import('./lib/storage/sync.mjs').then((m) => m.syncFileStateToSql(process.cwd(), { env: process.env, project: 'construct' }))"

node scripts/alignment/census.mjs --ratchet

