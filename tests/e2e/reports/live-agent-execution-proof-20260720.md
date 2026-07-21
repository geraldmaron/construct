<!--
tests/e2e/reports/live-agent-execution-proof-20260720.md — live provider orchestration evidence (construct-b9n56).
-->

# Live LLM agent execution proof — 2026-07-20

**Bead:** construct-b9n56 · **Manual run id:** run-04aa7dcf9331 · **Project cwd:** /tmp/cx-prd-vis-20260720

## What this proves

Full provider-backed specialist execution: orchestration runtime plans tasks, assigns Worker Profiles, and calls a real model per task (`workerBackend: provider`). This is distinct from inline prepare-only runs and from host-backend prompt materialization without provider spend.

## Manual live run (run-04aa7dcf9331)

| Field | Value |
|---|---|
| Provider / model | `provider:openrouter:openrouter/openai/gpt-4o-mini` |
| Specialists executed | researcher, product-manager, architect, reviewer, designer, operations, debugger, data-analyst |
| Artifact | typed `prd-platform` source passed `construct validate` with advisory missing reviewer-log warnings |
| Publish | native HTML to `/Users/geralddagher/Downloads/construct-prd-control-plane-2.0.html`; Mermaid unresolved (source fallback preserved) |
| Pre-gate gap (2026-07-20) | researcher output had six URL-shaped citations with empty `webEvidence` (not treated as verified) |

Follow-up gates shipped in construct-1iljn.4 (closed): `research-evidence-gate` / `output-quality-gate` require governed `webEvidence` for external researcher URLs; `construct publish --figures` reports `figures:unresolved` and soft-degrades when `--no-strict`.

## Gated repeat harness (CI-safe default: skip)

| Path | Proves |
|---|---|
| `lib/certification/real-llm-scenarios.mjs` (`runRealLlmS3`) | `runOrchestration` with `workerBackend: provider` reaches terminal status with non-empty task output (real model call) |
| `lib/certification/real-llm-scenarios.mjs` (`runRealLlmS8`) | MCP `orchestration_run` with `worker_backend: provider` reaches terminal daemon state when dashboard is up |
| `tests/functional/real-llm-scenarios.functional.test.mjs` | Node test wrapper; skips unless opted in |
| `construct certify run real-llm.s3` / `real-llm.s8` | Certification catalog ids (`tests/certification/scenarios/catalog.json`) |

**Opt-in:** `CONSTRUCT_CERTIFY_LIVE=1` or legacy `CONSTRUCT_E2E_REAL_LLM=1`, plus `OPENROUTER_API_KEY` (default) or another configured provider key. Override provider/model with `CONSTRUCT_E2E_REAL_LLM_PROVIDER` / `CONSTRUCT_E2E_REAL_LLM_MODEL`.

**Manual rerun:**

```bash
CONSTRUCT_CERTIFY_LIVE=1 OPENROUTER_API_KEY=... node --test tests/functional/real-llm-scenarios.functional.test.mjs
```

Or:

```bash
CONSTRUCT_CERTIFY_LIVE=1 OPENROUTER_API_KEY=... node bin/construct certify run real-llm.s3
```

Skipped provider calls and missing opt-in record as inconclusive, not pass.

## Hermetic chain (no live keys)

`tests/functional/prd-request-full-chain-audit-trail.functional.test.mjs` drives the same PRD request shape through `runOrchestration` with an injected `fetchImpl` (no network). It proves orchestration planning, worker assignment, and task output persistence without claiming a live model call.

## Related gates

| Gate | File |
|---|---|
| Research webEvidence | `lib/orchestration/research-evidence-gate.mjs`, `tests/orchestration-research-evidence-gate.test.mjs` |
| Output quality (researcher URLs) | `lib/orchestration/output-quality-gate.mjs` |
| Publish figures unresolved | `lib/publish.mjs` (`figures:unresolved`) |
| Surface smoke (inline, non-degraded orchestration) | `tests/functional/surface-smoke-matrix.functional.test.mjs`, runbook `docs/operations/runbooks/surface-smoke-matrix.md` |
