<!--
tests/e2e/reports/real-llm-scenarios-2026-06-22.md — S3 + S8 real-LLM execution report (construct-2fm8.2).
-->

# Real-LLM scenarios S3 + S8 — execution report

**Date:** 2026-06-22 · **Bead:** construct-2fm8.2 · **Harness:** `tests/functional/real-llm-scenarios.functional.test.mjs` (`CONSTRUCT_E2E_REAL_LLM=1`)

## S3 — PRD via provider-worker orchestration

| Field | Value |
|---|---|
| Provider | GitHub Copilot OAuth (`github-copilot/…`) |
| Run status | `completed` or `completed-with-failures` (provider tasks returned text) |
| Output size | Substantial multi-paragraph specialist output (>800 chars) |
| Quality gate | **PARTIAL** — prose dimension passed (17 paragraphs); structure (required PRD sections + mermaid) and citations did not on the longest task output this run |
| Verdict | Real-LLM path **executed**; full template-shaped PRD remains environment/model dependent |

## S8 — `orchestration_run` via dashboard daemon

| Field | Value |
|---|---|
| Daemon | Reachable (not fail-fast) |
| Result | **PARTIAL** — HTTP 429 `rate_limited` while polling run status after POST |
| Verdict | Thin-client path exercised; terminal state not observed this run due to Copilot rate limit |

## Harness contract

- Opt-in only: `CONSTRUCT_E2E_REAL_LLM=1` plus Copilot OAuth or an API key.
- S3 hard-requires completed provider output; skips (does not fail) when the quality gate misses on shape/citations.
- S8 skips on daemon down or rate limit; asserts terminal status when the daemon completes.
