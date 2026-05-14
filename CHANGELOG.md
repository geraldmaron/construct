# Changelog

All notable changes to Construct are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## Unreleased

### Changed

- `construct setup` now auto-installs both local Postgres and local Langfuse via Docker, with interactive default-yes prompts that pattern-match Supabase CLI and Hasura's local-first install flows. Previous behavior gated Postgres install on `--yes` and never installed Langfuse from setup at all (it only ran on `construct up`). New behavior: when Docker is detected, setup probes consent for each service (cached as `BOOTSTRAP_POSTGRES` / `BOOTSTRAP_LANGFUSE` in `~/.construct/config.env`), spins up the bundled docker-compose stacks, and writes seeded credentials back to config.env. `--yes` accepts both defaults non-interactively; `--no-docker` skips both cleanly. Re-runs respect cached consent so users aren't re-prompted every time.
- **Removed cloud Langfuse default.** `LANGFUSE_BASEURL` no longer defaults to `https://cloud.langfuse.com`. The new default is `http://localhost:3000` with auto-seeded credentials (`pk-lf-construct-local` / `sk-lf-construct-local`) that match what the bundled `langfuse/docker-compose.yml` writes at first boot. Cloud Langfuse is opt-in: set `LANGFUSE_BASEURL` to a non-localhost URL before running setup and Construct will preserve it without starting the local stack. Construct is a local-first developer tool, not enterprise SaaS — no defaults point at hosted services.
- Langfuse admin login auto-seeded and surfaced. The bundled compose seeds an admin user (`admin@construct.local` / `construct-admin`) via `LANGFUSE_INIT_USER_*`; `construct setup` now writes those values to `~/.construct/config.env` as `LANGFUSE_ADMIN_EMAIL` / `LANGFUSE_ADMIN_PASSWORD` and prints them in a "Local services" summary block at the end of setup, modelled on `supabase start`. Users can log in to `http://localhost:3000` immediately without grepping docker-compose.yml.
- Langfuse and MinIO ports tightened to `127.0.0.1`-only. Previously `langfuse-web:3000` and `minio:9090` bound to `0.0.0.0`; with auto-seeded admin credentials, that was a footgun on untrusted networks. Now both bind to loopback like the rest of the bundled stack.
- Every host-facing port in the Langfuse stack moved into Construct's reserved `54330–54339` block (Postgres already occupies `54329`). Container-internal ports stay on stock defaults; only the host mappings move. Developers running Next.js (`:3000`), Redis (`:6379`), MinIO (`:9090`), ClickHouse (`:8123`/`:9000`), Prometheus (`:9090`), or another Postgres (`:5433`) no longer collide. `LANGFUSE_LOCAL_BASEURL` is now `http://localhost:54330`; `NEXTAUTH_URL` and `LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT` updated to match so OAuth redirects and browser-direct media uploads keep working. Test pins both the contiguous block and the URL constants so silent drift is caught.
- Vector storage surfaced as a first-class line in `construct setup` output. Previously rode silently on the Postgres install; now setup prints which backend is active (`Postgres + pgvector` vs `JSON fallback`), the model in use, the indexed location, and the embedding-cache path. The actual wiring (pgvector schema migration, embedding model, JSON fallback) was already in place — this is purely about discoverability.
- Embedding model pre-warmed during `construct setup` so the first agent query no longer stalls on the one-time ~22 MB ONNX download. New `warmupEmbeddingModel()` in `lib/storage/embeddings-engine.mjs` runs unconditionally after the vector index directory is created and reports `model + dimensions + warm-duration` (or a degraded-fallback note). Mirrors `supabase start` pre-pulling images and `playwright install` pre-fetching browsers — the wait happens once, visibly, under the setup banner.
- pgvector extension now loaded by the bootstrap schema migration (`create extension if not exists vector;` in `db/schema/001_init.sql`). The bundled Postgres image already ships pgvector but the extension was never enabled, so any future use of the `vector` column type would have failed at runtime.
- Platform-aware Docker install hint when Docker isn't on PATH. New `dockerInstallHint(platform)` in `lib/setup.mjs` returns the canonical option per OS (macOS: Docker Desktop / OrbStack / Colima; Windows: Docker Desktop; Linux: Docker Engine via apt/dnf/pacman). Replaces the generic single-line hint.

### Added

- Proactive intake review pipeline. Three coordinated changes turn `.cx/inbox/` from a passive ingest target into a real review-loop surface:
  - **Reactive watcher** (`lib/embed/inbox-live-watcher.mjs`) — fs.watch-based debounced trigger that fires `InboxWatcher.poll()` within seconds of a file landing, instead of waiting for the scheduler's next interval. Wired into the embed daemon with the scheduler poll kept as the correctness backstop for platforms where fs.watch silently misses events (network mounts, certain Docker volume drivers). Opt out with `CX_INBOX_LIVE_WATCH=off`.
  - **Review queue** (`lib/review/queue.mjs`, `lib/review/prepare.mjs`) — after each successful ingest, the daemon writes a preparation packet to `.cx/review-queue/pending/<id>.json` containing the new content's excerpt, a suggested docs lane (via `docs-routing.suggestDocsLaneForFile`), and the top-K related existing docs from `buildHybridSearchResultsAsync`. The daemon never calls an LLM; the agent in the user's editor reads the packet, performs the actual comparison work (does this overlap with an existing PRD? contradict an ADR?), and marks the entry processed.
  - **session-start nudge** — the hook injects a "Pending intake reviews (N)" block listing the most recent packets so the agent knows there's queued work without polling. Process with: review the intake against the related docs the daemon retrieved, propose doc updates or new lanes.
- Initial project corpus indexing in `construct setup` and `construct init`. When setup runs from inside a downstream project (cwd has `docs/`, `AGENTS.md`, or `package.json`), the embedding index seeds from the project's existing docs so the review pipeline above has corpus to search against from day one. `init` does the same as part of its scaffolding. Best-effort: silently skipped when Postgres or the embedding model isn't ready.
- Comment linter extended to scan JSDoc block-comment bodies (lines starting with `*`), not just `//` line comments. Adds two new banned patterns: "replaces the old/previous/prior" comparative framing, and "the new path uses" historical-narrative phrasing. Four pre-existing JSDoc violations swept along with this change.
- `construct_guide.md` at the project root, written once by `construct init` (and `npx construct init`). A friendly orientation that explains the per-project files Construct creates, where to drop information for the agent to use (`.cx/inbox/`, `docs/intake/`, `AGENTS.md`), how to talk to `@construct` and direct specialists, how to change Construct settings (per-project `.claude/settings.json` vs per-machine `~/.construct/config.env`), the local services with their URLs + admin login, common commands, and a link to the docs site. Skipped on re-runs so user edits stick.
- Docs site `start/install.mdx` rewritten to match the new dep-install model: shows `npm install -D @geraldmaron/construct` as primary, documents the auto-spin Postgres + Langfuse behavior of `construct setup`, shows the local-services credentials summary that setup prints, mentions Homebrew + the local-bind security guarantee, and ends with a pointer to `construct uninstall`. README quickstart aligned to the same flow.
- First-invocation resource probe (`lib/install/first-invocation.mjs`). When a user runs any `construct <cmd>` (except `setup`, `uninstall`, `hook`, `doctor`, `version`, `help`, `completions`, or after `BOOTSTRAP_CHECKED=1` is cached) and `~/.construct/` shows missing resources, Construct prints a one-shot status table and offers to run `construct setup`. Silent on success; silent on non-TTY (CI); silent on hook invocations. Matches the husky/prisma post-install pattern: keep `npm install` quiet and idempotent, do interactive setup at first real CLI use.

### Internal

- Extracted Langfuse spin-up logic from `lib/service-manager.mjs` into `lib/services/langfuse.mjs` so `construct setup` and `construct up` share one code path. `verifyLangfuseKeys` and `pruneStashDir` re-exported under their existing `_*` names for test backwards-compat.
- New `lib/setup-prompts.mjs` exposes `consentToInstall({ name, isYes, alreadyConfigured, envPath, ... })` for any future service that wants the same interactive default-yes flow.

## 0.1.0 — 2026-05-13

Version line reset to the 0.x series. The previously published 1.0.0 was a premature publish and has been deprecated on npm in favour of 0.1.x; breaking changes are expected during the 0.x series and may ride in on minor bumps. The dep-install path (`npm install -D @geraldmaron/construct`) is the primary distribution model — peers who clone a project that pins Construct get the full setup automatically through the postinstall hook, the same way any other dev dependency would land.

### Added

- `construct uninstall` command — interactive teardown of Construct state. Removes `.construct/`, Construct-owned `.claude/agents/` + `.claude/commands/` entries (read from `.construct-manifest`), and Construct keys from `.claude/settings.json` (un-merge preserves user-added mcpServers and other top-level keys); ask-risk items like the local Postgres container, `~/.construct/cache/embeddings` (~22 MB ONNX model), `~/.construct/config.env` (API keys), `.cx/`, and `AGENTS.md`/`plan.md` are skipped unless explicitly opted in. Never touches Docker, Homebrew, the pgvector image, or anything not Construct-owned — those appear in the final report as follow-ups. Flags: `--dry-run`, `--yes [--all]`, `--keep-state`, `--scope=project|machine|all`. Replaces the previous README snippet that did `rm -rf ~/.construct ~/.cx` with no awareness of the Postgres container, merged settings keys, or per-project state.
- Homebrew distribution path. New `templates/homebrew/construct.rb` formula template ships as the seed for the `geraldmaron/homebrew-construct` tap repo. `.github/workflows/release.yml` gains a `homebrew` job that auto-bumps the formula's per-platform `url` and `sha256` on every `v*` tag push via `dawidd6/action-homebrew-bump-formula`; gated on a `HOMEBREW_TAP_ENABLED` repository variable so the step stays inert until the tap and `HOMEBREW_TAP_TOKEN` secret exist. End-user install becomes `brew install geraldmaron/construct/construct` for users without Node. Setup runbook documented in `docs/maintenance/homebrew-tap.md`.
- SHA-256 verification in `bootstrap.sh --install`. The non-Node binary download path now fetches the matching `.sha256` sidecar from the GitHub Release and verifies the digest before chmodding the binary. Tampered or missing-sidecar downloads fail closed with a clear message; the partial download is cleaned up so a retry starts fresh. Closes a previous gap where the bootstrap shim installed whatever bytes the URL returned.

- Modern documentation site at `/v2/` with full-text search, structured navigation, a 5-minute getting-started path, task-oriented cookbook recipes (including walkthroughs for adding custom specialists, fixing policy violations, swapping LLM and retrieval components, and connecting Slack/GitHub/Jira+Confluence/Salesforce), and concept pages explaining the persona+specialists model, enforcement architecture, durable state, and local-first design. README rewritten as a landing page with links into the site.
- New `construct gates:audit` command surfaces gaps where a policy gate exists in CI but not locally, or where required-status-checks drift from the actual CI workflow. Runs in CI on every PR.
- Three-layer policy enforcement now activates automatically after `construct setup`: real-time comment lint at write time, commit-time policy gates via local hooks, and CI as the safety net. Each blocking gate has an explicit env-var bypass so legitimate exceptions leave an audit trail.
- Specialist persona framework — all 28 specialists now operate as their organizational counterparts (SRE owns reliability, QA owns test health, Security audits dependencies, etc.) with typed event handoffs, rate-limited invocations, and an approval queue for high-stakes decisions.
- L0 doctor daemon — autonomous health monitoring with auto-restart for managed services and structured escalation to specialist personas when deterministic rules can't resolve the problem.
- Cost tracking and budget enforcement — per-persona and global daily spend caps. Advisory by default; set `CONSTRUCT_BUDGET_ENFORCE=on` for hard-stop behavior. Doctor reports per-persona burn and pricing-source visibility.
- Dashboard Doctor page — live daemon state, cost burn with per-persona breakdown, approval queue, pending role invocations, recent audit trail. Auto-refreshes every 30 seconds.
- Dashboard provider configuration — editable settings for GitHub, Jira, Confluence, Slack, and Salesforce with inline credential management and three-state health classification (healthy / not-configured / unhealthy).
- Automatic routing for legal-compliance, business-strategist, operations, R&D-lead, and explorer specialists. These were defined but unreachable without an explicit user invocation — now keyword-matched requests (e.g., "review GDPR compliance", "set up the GTM strategy", "work out the critical path", "frame the hypothesis", "do a scoping pass") route to them automatically. Compliance, business-framing, and R&D-validation concerns surface pre-architecture on orchestrated work.
- Intent-aware routing layer. Keyword classifiers used to suffer false positives ("the AI is slow" routes to AI-systems architect; "coverage" substring-matches "rag" inside it). The new `routeRequestVerified` API and `orchestration_policy` MCP tool overlay an optional fast-tier LLM verifier on top of the keyword match, dropping flavors below a confidence threshold. Falls back to keyword-only when no model key is configured, errored, or `CONSTRUCT_INTENT_VERIFY=off`. A scoring script (`npm run eval:routing -- --verify`) measures precision/recall/F1 of keyword-only vs verified against a labeled corpus.
- `construct init` stages the same `.construct/` launcher and `.claude/` adapters that the npm postinstall hook stages, sharing one code path via `lib/install/stage-project.mjs`. `init` is now self-sufficient for projects that did not yet pin Construct — running it after a clone produces the same project shape as `npm install` of a project that does pin it. Documented `release-policy.md` keeps release cadence deliberate.

### Changed

- Documentation site moved from MkDocs to Fumadocs, with a redesigned landing page, Geist typography, and a restrained electric-blue accent palette in both light and dark themes. The new site is the canonical docs surface; the MkDocs source (`site/`, `mkdocs.yml`) has been removed. Old per-topic markdown files (`docs/how-to/`, `docs/getting-started.md`, `docs/installation/`, `docs/reference/cli.md`, `docs/reference/hooks.md`) are deleted now that their content lives in the new IA (`docs/start/`, `docs/cookbook/`, `docs/reference/cli/`).
- Canonical architecture, prompt-surface, knowledge-layout, and embedding-boundary docs moved to `docs/concepts/` to match the docs-site information architecture. Tooling that operates on this repo's files (storage indexing, RAG, agent fences, doc-coupling checks, embed seed) updated. `construct init` still creates `docs/architecture.md` at the project root in downstream projects — the per-repo and per-downstream-project conventions are intentionally distinct.
- Beads issue-tracking data (`.beads/issues.jsonl`, `.beads/metadata.json`) is no longer committed — it's local working state. Shared infrastructure (hooks, config, README) remains tracked. Revisit when the project moves to a multi-person setup.
- Project-root cleanup: `sync-agents.mjs`, `test-embed-boundary.mjs`, and `test-instance-isolation.mjs` moved into `scripts/` alongside the existing tooling. Stale `snapshot.md` removed. Reduces the top-level entry count and matches the rest of the repo's directory conventions.
- Schema source files moved from `db/migrations/` to `db/schema/` to reflect what they are. Runner mechanism unchanged.
- Dashboard color contrast improved across all pages (WCAG AA on labels, AAA on body text).

### Fixed

- Documentation menu sub-pages no longer 404. Docs now live at the site root — `/cookbook/`, `/reference/`, `/start/`, `/concepts/` are the canonical URLs (matching standard docs-site convention), and the dedicated marketing landing remains at `/`. The CLI reference auto-generator and the `reference/hooks` slug were also producing or pointing at unreachable paths and have been corrected.
- Retrieval evaluation CI job no longer flakes on transient CDN failures during ONNX runtime download.
- Help-output column alignment fixed for emoji rendering edge cases on macOS Terminal and iTerm2.
- Local pre-commit policy gates now fire automatically after `construct setup` — the hook files were previously tracked in `.beads/hooks/` but `core.hooksPath` was never wired, so every commit ran with zero local enforcement.
- Cost telemetry no longer double-counts on doctor daemon restart; per-day bucketing now respects entry timestamps rather than ingestion time.

## 1.0.0 — 2026-05-08

Initial public release.

Construct ships as a local-first agent orchestration layer for OpenCode, Claude Code, and other coding surfaces, with a single user-facing persona that routes work across specialist agents and keeps shared project state aligned.

### Highlights

- **Distribution** — three install modes: project-pinned npm devDependency, global npm install, and bootstrap shims (`.construct/run.mjs` + `bootstrap.sh` + `bootstrap.ps1`) for non-Node projects. `construct init --devcontainer` for VS Code teams.
- **Provider system** — capability-driven contract with five built-in providers (GitHub, Atlassian Jira, Atlassian Confluence, Slack, Salesforce), per-provider circuit breakers, and a stable plugin contract for custom providers.
- **Plugin retrieval engine** — six-layer plugin contract (Embedder, Chunker, Indexer, Fuser, Reranker, Compressor) with RRF + MMR defaults and an eval harness covering Recall@k, MRR, and NDCG.
- **Security middleware** — CSRF double-submit, CORS allowlist, token-bucket rate limiting, structured JSON-line logger. Multi-token dashboard auth with per-token roles.
- **Reliability** — runtime contract enforcement (`enforcePacket` with chain-hashed JSONL violation log), embed daemon supervision (launchd / systemd / Task Scheduler), full system backup with SHA-256 manifest.
- **Storage** — hybrid file-state + Postgres+pgvector + JSON vector index fallback, configurable embedding models (local ONNX, OpenAI, Ollama, hashing).
- **AWS deploy** — Terraform modules for ECS/Fargate ≥ 2 tasks behind ALB with sticky sessions, RDS with pgvector parameter group, Secrets Manager, CloudWatch alarms, multi-stage hardened Dockerfile.
- **CI/Release** — matrix CI (ubuntu/macos × Node 20/22 + real Postgres + gitleaks), release pipeline producing Node SEA binaries per OS/arch, Docker GHCR push + Trivy scan, npm publish with provenance.
- **Documentation** — full doc set: getting-started, installation guides, provider guides, operations runbooks, security, AWS deploy, CLI/config/hooks/MCP-tools reference. Deprecation infrastructure and semver policy.

### Hard release-gate contracts

Every commit and PR is enforced against the same five local gates and the canonical commit + PR templates:

- `npm test`
- `node bin/construct lint:comments`
- `node bin/construct docs:verify`
- `node bin/construct docs:update --check`
- `npm run lint:templates`

These are encoded in `rules/common/release-gates.md`, summarized in `AGENTS.md`, and reflected in the CI matrix.
