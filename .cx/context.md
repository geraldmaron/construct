# Session Context

> Project state for the Construct repo. Keep this file aligned with the current state of the construct codebase. Do not paste session-specific or external-project details here — those belong in the local `.cx/handoffs/` (which is gitignored).

Last saved: 2026-05-08

## Embedding Model

- Default: local ONNX via `@huggingface/transformers` (Xenova/all-MiniLM-L6-v2, 384d)
- Configurable via `CONSTRUCT_EMBEDDING_MODEL` env var
- Options: local, openai, ollama, hashing
- Local ONNX failures report an explicit degraded hashing fallback instead of silently masking neural retrieval loss.

## Vector Storage

- Primary: Postgres with pgvector (HNSW index, 384d schema)
- Fallback: local JSON vector index when Postgres is unavailable
- Auto-synced every 5 minutes by the embed daemon

## Current state — 1.0 production roadmap shipped

All eight tracks of the 1.0 roadmap are merged to main.

**Completed:**

- **Distribution** — `.construct/run.mjs` launcher + POSIX/PowerShell bootstrap shims + devcontainer recipe. `construct init --devcontainer`. Hook commands resolve through `node .construct/run.mjs hook <name>` so peers without a global install work correctly.
- **Resource bootstrap** — `lib/bootstrap/resources.mjs` probe registry + `lib/bootstrap/lazy-install.mjs` consent-gated install. `construct setup` wizard with summary panel and `~/.cx/setup-<ts>.log`.
- **Provider system** — `lib/providers/contract.mjs` + `lib/providers/registry.mjs` + five built-in providers (GitHub, Jira, Confluence, Slack, Salesforce) + circuit breaker (`lib/providers/circuit-breaker.mjs`). `construct provider list|info|test|plugins`.
- **Security** — CSRF (`lib/server/csrf.mjs`), CORS allowlist (`lib/server/cors.mjs`), rate limiting (`lib/server/rate-limit.mjs`), structured logger (`lib/logger.mjs`). All wired into the dashboard server.
- **Reliability** — Runtime contract enforcement with chain-hashed JSONL violation log (`lib/agent-contracts-enforce.mjs`). Embed daemon supervision for all platforms (`lib/embed/supervision.mjs`). Full system backup (`lib/storage/backup.mjs`).
- **Plugin retrieval engine** — Six-layer contract (Embedder, Chunker, Indexer, Fuser, Reranker, Compressor). RRF + MMR defaults. Eval harness (Recall@k, MRR, NDCG).
- **AWS hardening** — pgvector via RDS parameter group, ECS ALB stickiness + auto-scaling + CloudWatch alarms, multi-stage Dockerfile, smoke test workflow.
- **CI/Release** — Matrix CI (ubuntu/macos × Node 20/22 + real Postgres + gitleaks; Windows excluded from unit tests, validated at release time via SEA binary). Release pipeline: Node SEA binaries, Docker push + Trivy, `npm publish --provenance`.
- **Documentation** — Full doc set: getting-started, installation guides, provider guides, operations, security, deploy/aws, reference (CLI/config/hooks/MCP tools). Deprecation infrastructure + semver policy.

## What was in progress

- Repo cleanup pass: untracking `plan.md` as gitignored local working state, sanitizing `.cx/context.md` to construct-only content, removing orphan `construct-test-data/` fixtures, and aligning the README + auto-docs core-docs table with the new policy.
- CI hardening: cross-platform test runner, dropped Node 18, gitleaks allowlist for the secret-scanner's own detection regexes, removed redundant deploy test job, dropped Windows from the unit-test matrix (release pipeline still validates the Windows binary).

## Open issues

- GraphRAG — intentionally gated, not in 1.0 scope
- Azure + GCP Terraform modules — 1.1 target
- OAuth provider login + role-based auth — 1.1 target
- Live AWS deploy validation — requires real AWS credentials
- Cross-platform test fixtures — Windows test compatibility for the unit suite (Unix path / chmod assumptions in fixtures)
