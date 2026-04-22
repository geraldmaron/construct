<!--
CHANGELOG.md — repository-level baseline summary for the current initial history.

Describes the major capabilities present at the start of this clean commit
history. Keep entries concise, capability-oriented, and suitable for someone
reading the project for the first time.
-->
# Changelog


## Follow-up: source-checkout update command

### `construct update` for post-pull maintenance

- Added `construct update` as the one-shot maintenance command to run after pulling the Construct repo itself.
- The command validates that you are inside a real Construct source checkout, reinstalls that checkout globally with `npm install -g .`, then runs host-only sync and `construct doctor` from the checkout code.
- This closes the gap between updating the repo and remembering the separate device-level refresh steps needed for Claude Code, Copilot, Codex, and other synced host surfaces.

## Follow-up: hard cap + functional skill scope + doctor checks

### Prompt-cap is now hard-fail

`sync-agents.mjs` exits non-zero when a specialist prompt exceeds its cap.
Escape hatches: `wordCapOverride` on the registry entry (with a written
reason), `--force` flag, or `CONSTRUCT_SYNC_FORCE=1` env. A silent warning
was the reason `data-engineer` sat over cap for an unknown period; now
drift is caught at sync time.

### Skill-scope enforcement is now functional (not aspirational)

- `lib/skills-apply.mjs` stopped writing a `disabledPlugins` key to
  `.claude/settings.json` that Claude Code doesn't honor. Instead writes
  a sidecar at `.claude/construct-skills.json` marked as advisory.
- `lib/hooks/session-start.mjs` now reads `.cx/skills-profile.json` at
  session start and injects a `## Project skill scope` section listing
  the out-of-scope skills explicitly. The host doesn't need to support
  per-project plugin filtering — the LLM is told directly.

### New doctor checks

- `Agent contracts loaded` — verifies `agents/contracts.json` parses and
  has contracts.
- `Agent contract schema intact` — structural integrity of contract entries.
- `Skills profile matches current project stack` — flags drift when
  `.cx/skills-profile.json` was generated under different tech-stack signals
  than the current repo (optional; warns rather than fails).

Doctor now runs 26 checks (was 23).

## Harden Construct — agent contracts, context hygiene, project scoping

### Agent-to-agent service contracts

- `agents/contracts.json` — 15 explicit producer→consumer contracts covering
  the full R&D flow (intake, research→architecture, PRD→ADR, architect→
  engineer, engineer→reviewer/QA, reviewer→security, QA→release, SRE→release,
  docs-keeper fanout, incident response). Each contract declares
  `input.mustContain`, `preconditions`, `output` shape/schema, and
  `postconditions`.
- `lib/agent-contracts.mjs` — loader, query, validator. `getContract(producer,
  consumer)`, `resolveContractChain(routingCtx)`, `validatePacket(contractId,
  packet, direction)`.
- `routeRequest` now returns `contractChain` alongside specialists and gates.
- New MCP tool `agent_contract` — specialists introspect their own contracts
  at handoff time.

### Principal-team gates

- `rules/common/framing.md` — tickets/transcripts/prior docs are execution
  artifacts, not sources of truth. Problem must be stated independent of how
  it was reported.
- `rules/common/doc-ownership.md` — PRDs → cx-product-manager, ADRs/RFCs →
  cx-architect, research briefs → cx-researcher, runbooks → cx-sre, threat
  models → cx-security. The orchestrator routes, never drafts.
- `rules/common/skill-composition.md` — on-demand vs preload guidance for
  role skills.
- `routeRequest` auto-prepends cx-devil-advocate, cx-researcher, and the
  owning specialist when framing/research/doc-ownership gates fire.
- `templates/docs/adr.md` — Problem section must not reference tickets;
  Rejected alternatives with ≥2 alternatives required.
- `templates/docs/prd.md` — Problem traces to user evidence, not roadmap
  items.

### Context hygiene (enforce, don't advise)

- `lib/hooks/bash-output-logger.mjs` (PostToolUse:Bash) — writes outputs
  >4KB to `~/.cx/bash-logs/`, nudges model to grep the log rather than
  re-run.
- `lib/hooks/repeated-read-guard.mjs` (PreToolUse:Read) — blocks broad
  re-reads of files already read twice this session; narrow follow-ups
  still allowed.
- `lib/hooks/context-watch.mjs` (UserPromptSubmit) — injects compaction
  guidance at 120k / 160k token thresholds; env-overridable via
  `CONSTRUCT_CONTEXT_WARN` / `CONSTRUCT_CONTEXT_URGENT`.
- `sharedGuidance` slimmed from 30 items → 10 essentials; 22 moved to
  `skills/operating/orchestration-reference.md` for on-demand loading.
- On-demand role guidance is now the default (was preloaded). Specialists
  keep the `get_skill("roles/NAME")` directive in the prompt and call it
  at runtime. All 28 specialists sync under the 3600-word cap.

### Audit trail

- `lib/hooks/audit-trail.mjs` (PostToolUse) — every Edit/Write/MultiEdit/
  NotebookEdit and mutating Bash appended to `~/.cx/audit-trail.jsonl`
  with timestamp, session id, agent, task key, target, content hash,
  and a `prev_line_hash` chain for tamper-evidence.
- `lib/audit-trail.mjs` + `construct audit trail` CLI — reader/filter/
  verifier with `--verify`, `--agent`, `--tool`, `--since`, `--json`,
  `--limit`.

### Project profile + per-host skill scoping (agnostic)

- `lib/project-profile.mjs` — host-agnostic tech-stack detection from
  filesystem signals (package.json deps, pyproject.toml, go.mod,
  Cargo.toml, pom.xml, build.gradle, Gemfile, composer.json, Package.swift,
  Docker, CI, etc.). Subdir docker scan for monorepos.
- `NEVER_FILTER_PREFIXES` safeguards: construct personas, cx-* specialists,
  cross-cutting skills, role-domain namespaces (engineering:, product-
  management:, operations:, legal:, data:), Claude dev infrastructure,
  and Anthropic-native skills are always protected.
- `construct skills scope` — classifies installed skills as relevant /
  irrelevant / unmapped / protected. Writes `.cx/project-profile.json`.
- `construct skills apply --host <claude|opencode|codex|all>` — writes
  per-host scoping configs. Always writes the construct-native manifest
  `.cx/skills-profile.json` as the source of truth.

### Auto-regenerated docs + doctor enforcement

- `construct sync` now calls `regenerateDocs` to refresh AUTO-managed
  regions in `README.md`, `docs/architecture.md`, `docs/README.md`.
- `construct doctor` gained an "AUTO docs up to date" check (24 total
  checks).
- `construct setup` profiles the project at the end and writes
  `.cx/project-profile.json` automatically.

### Session-start + CASS integration

- `lib/hooks/session-start.mjs` queries CASS at session start (cm_context
  and memory_search in parallel, 3s timeout each) and embeds results as
  `## Memory (CASS)` in the injected context. Replaces the passive
  memory-search directive.
- `construct setup` installs the `cass` binary (session search) in addition
  to `cm` (memory MCP) via Homebrew or cargo.

### MCP server fixes

- Resolved two silent-fail bugs that prevented `construct-mcp` from
  starting on fresh installs: `__CX_TOOLKIT_DIR__` placeholder unresolved
  at sync time; `import.meta.url` vs `process.argv[1]` mismatch on
  symlinked installs.
- Committed previously untracked files that the MCP server imported
  (`lib/observation-store.mjs`, `lib/entity-store.mjs`,
  `lib/artifact-capture.mjs`) plus their tests.

### License

- Switched from MIT to Elastic License 2.0. Free to use, self-host, and
  modify. Prohibits offering Construct as a hosted or managed service to
  third parties. Protects the option to build a commercial hosted tier
  later.

## Learning loop — observation store, entity tracking, artifact capture

### Observation store

- Role-scoped observation store (`lib/observation-store.mjs`) with CRUD, vector indexing, and semantic search.
- Observations are distilled insights (patterns, decisions, anti-patterns) recorded by specialists, capped at 1000 entries.
- 256-dim `hashing-bow-v1` embeddings for local semantic search with no API dependency.

### Entity tracking

- Entity store (`lib/entity-store.mjs`) for tracking components, services, dependencies, and concepts across sessions.
- Bidirectional entity relationships and observation linking, capped at 500 entities.

### Artifact capture

- Automatic artifact capture (`lib/artifact-capture.mjs`) at session end via `stop-notify.mjs`.
- Extracts session-summary observations, decision observations (capped at 5), and file-group entities from changed file patterns.

### MCP tools

- Three new tools that all 28 specialists already reference: `memory_search`, `memory_add_observations`, `memory_create_entities`.
- `memory_search` provides semantic search with role/category/project filters.
- `memory_add_observations` supports batch-add up to 10 observations per call.
- `memory_create_entities` supports batch-create/update up to 10 entities.

### Hook integration

- `session-start.mjs` now surfaces the 5 most recent project observations in resume context.
- `stop-notify.mjs` now runs `captureSessionArtifacts()` after session close.

### Verification

- 278/278 tests pass (51 new: 22 observation-store, 21 entity-store, 8 artifact-capture).

## Session persistence, prompt composition, and compliance skills

### Session persistence

- Distilled session store (`lib/session-store.mjs`) that survives `construct down` and enables resumption with minimal token cost.
- Sessions capture summary, decisions, files changed, open questions, and task snapshots — all with enforced caps.
- Session lifecycle wired into `session-start.mjs` (create/resume) and `stop-notify.mjs` (close with summary).
- Four MCP tools: `session_list`, `session_load`, `session_search`, `session_save`.

### Prompt composition

- Runtime flavor overlay injection via `AGENT_FLAVOR_MAP` in `lib/prompt-composer.mjs`, connecting 27 previously orphaned domain overlays.
- `lib/model-free-selector.mjs` extracted from `lib/model-router.mjs` to keep both modules under 500 lines. Re-export pattern preserves backward compatibility.

### Compliance skills

- Four new skills for `cx-legal-compliance`: `license-audit`, `data-privacy`, `ai-disclosure`, `regulatory-review`.
- Registry updated with skill references.

### Rules cleanup

- Common rules made platform-agnostic by removing tool-specific references.
- Removed duplicate rule sets and fixed broken cross-references in language-specific hooks files.

### Documentation

- Architecture docs updated with session persistence section and MCP tool inventory.
- Docs README updated with skills index and session storage reference.

### Verification

- 227/227 tests pass (19 new session-store tests, 2 new prompt-composer tests).

## Initial Commit

### Document ingest and extraction

- Shared extraction support for PDF, DOC/DOCX, XLS/XLSX, CSV/TSV, PPT/PPTX, ODT/ODS, RTF, Pages, Numbers, Keynote, and plain-text project artifacts.
- `construct ingest` for converting source documents into normalized markdown artifacts.
- MCP tools for `extract_document_text` and `ingest_document`.

### Storage and retrieval

- File-state indexing that includes broader document content from ingested and extracted artifacts.
- Local vector index persistence wired into storage sync.
- SQL-backed storage sync and hybrid retrieval aligned with the local vector path.
- Explicit storage lifecycle surfaces for status, sync, reset, and ingested-artifact deletion across CLI and MCP, with confirmation gates for destructive actions.

### Research and evidence policy

- A repo-level research policy covering source order, verification, confidence, contradiction handling, and reproducibility.
- Research, evidence-ingest, product-intelligence, and product-signal workflows aligned to the same standard.
- Reusable research and evidence templates with stricter structure expectations.
- `construct lint:research` plus research artifact checks surfaced in `construct doctor`.

### Verification

- Baseline verified with docs check, research lint, targeted storage/MCP/ingest tests, and live storage status checks.
