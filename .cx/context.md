# Session Context

> Project state for the Construct repo. Keep this file aligned with the current state of the construct codebase. Do not paste session-specific or external-project details here — those belong in the local `.cx/handoffs/` (which is gitignored).

Last saved: 2026-05-13

## Most recent session (2026-05-13)

Bundled backlog cleanup PR landing on a single branch:

- Touch-free local install — dropped the unconditional cloud Langfuse default; pgvector + migrations now run on every `construct setup` regardless of `--yes`; `construct doctor` now warns on missing Docker daemon / cm; opt-in Docker daemon auto-start on macOS via `CONSTRUCT_AUTO_START_DOCKER=1`; Langfuse magic-link bridge wired at `/api/services/langfuse/login`.
- Agent contracts hardened — 5 specialist contracts (cx-reviewer, cx-security, cx-debugger, cx-docs-keeper, cx-designer) gained binary postconditions enforced by an extended `validatePacket` (one-of grouping + enum constraints).
- Routing observability — `classifyEngineerFlavor` added so cx-engineer routes to its three overlays; `CONSTRUCT_VERBOSE=1` prints a one-line overlay trace from `routeRequest`.
- Gate hygiene — pre-commit comment-lint and docs-verify now run on the full diff (no `--staged`) to match CI; new local-only-by-design section in `docs/concepts/gates-and-enforcement.md`; new cookbook page `slash-command-index.md`.
- CI — `dorny/paths-filter` added so doc-only PRs skip the test matrix, evals, audit, and postgres-integration.
- Housekeeping — `scripts/test-embed-boundary.mjs` → `scripts/embed-boundary-manual.mjs` (manual probe, not a unit test); `lib/hooks/probe-before-read.js` → `.mjs`.
- Proactive activation framework — `requestSignals` + `proactiveTriggers` in `lib/orchestration-policy.mjs` plus a structured `dispatchSummary` on the `routeRequest` output. Replaces keyword-only pre-dispatch routing for cx-security (auth + non-narrow blast), cx-product-manager (high-ambiguity deep work), cx-designer (visual deliverable / UI risk), cx-devil-advocate (architecture change without success metric), and cx-sre (wide blast radius).

Distribution P0s (heo + gi7) verified already implemented: `templates/distribution/run.mjs|bootstrap.sh|bootstrap.ps1` exist, `bin/construct-postinstall.mjs` stages them under `.construct/` on consumer installs, and `scripts/sync-agents.mjs` rewrites `$HOME/.construct/lib/hooks/...` → `node .construct/run.mjs hook X` via `makeHooksPortable` so the project-mode settings.json is portable.

Phase D hygiene re-evaluated: D1 (rules consolidation) is already structurally in place — language rule files already extend `rules/common/*.md`. D2 (single-source CLAUDE.md generation) is incoherent on closer reading — the root and `platforms/claude/` files serve different audiences and shouldn't share a source. D3 (persona compressor at sync time) already exists as an opt-in `--compress-personas` flag; making it default-on is a behavior change deferred for a separate decision. D5 (probe-before-read .js → .mjs) is done in this PR.

Still deferred (each needs its own PR): dashboard rebuild epic (slice 1 sits in worktree zen-dirac-790880), persona-as-role epic, GraphRAG Phase C9, live AWS / runtime-integration validations.

## Embedding Model

- Default: local ONNX via `@huggingface/transformers` (Xenova/all-MiniLM-L6-v2, 384d)
- Configurable via `CONSTRUCT_EMBEDDING_MODEL` env var
- Options: local, openai, ollama, hashing
- Local ONNX failures report an explicit degraded hashing fallback instead of silently masking neural retrieval loss.
- **CI (retrieval evals) pins `hashing`** so the ONNX runtime postinstall is skipped (`npm ci --ignore-scripts`). Eliminates the CDN-timeout failure mode that killed the evals job pre-PR-#23.

## Enforcement architecture (defense in depth)

Three layers ensure policy violations don't fall through the cracks:

1. **Real-time (write/edit time):**
   - `comment-lint.mjs` PostToolUse blocks edits with banned patterns / missing headers (was advisory).
   - `doc-coupling-check.mjs` PostToolUse emits stderr advisories at 3/5/10 code-file edits without doc updates.
   - `ci-status-check.mjs` UserPromptSubmit injects last red CI run into agent context (60s cache).

2. **Gate (commit/push time):**
   - `.beads/hooks/pre-commit` chains `lint:comments --staged` and `docs:verify --staged`.
   - `pre-push-gate.mjs` refuses `claude/*` pushes, refuses push on red remote CI, runs evals + docs locally.

3. **Safety net (CI + session end):**
   - `policy-engine.mjs` Stop (consolidated): red-CI block, open-beads block, drive-mode criteria, drive-session advisory.
   - `construct doctor` validates that every hook in `settings.template.json` actually exists on disk (catches phantom-hook drift).
   - The P2 consolidation that was stalled mid-flight is now finished and wired up — see `docs/hooks-deprecated.md` for the honest ledger.

All blocking gates have explicit env-var bypasses (CONSTRUCT_SKIP_COMMENT_LINT, CONSTRUCT_SKIP_DOCS, CONSTRUCT_SKIP_GATES, CONSTRUCT_SKIP_PREPUSH, CONSTRUCT_ALLOW_CLAUDE_PUSH, CONSTRUCT_STOP_OK_RED_CI, CONSTRUCT_STOP_OK_OPEN_BD) so exceptions leave an audit trail.

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
