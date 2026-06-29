---
intake: none
---

# Subagent Evidence Report: Learning loops audit

> Agent I · model: Haiku · type: Explore (read-only) · Wave 1 · supervised by Opus.
> Structured output rendered by Opus; findings are the subagent's, not yet adjudicated.

## 1. Summary

The learning loops comprise four auto-capture pipelines (A1–A4) and supporting infrastructure. A1 (session auto-reflect) is fully wired: a 500ms Stop hook reads transcripts deterministically, stamps confidence with salience scores, and persists observations to searchable `.cx/observations/`. A2 (research persistence) and A3 (specialist outcomes) are documented and partially wired (outcome recording exists; outcome aggregation confirmed). A3's intake classifier reads outcome summaries as soft tie-breakers. A4 (prompt improvement) is documented as offline-only: patches are generated but never auto-applied. Tool-miss capture via `recordToolNameMiss` to `.cx/observations/tool-name-misses.jsonl` is wired in the MCP dispatcher but has no tests; failure capture is not observed anywhere. Oracle recommendation flow (read-model → synthesis → gaps → actions) exists but is primarily infrastructure (consolidation, contradiction detection) rather than learning closure — A1 output feeds session start context injection but no evidence that low-salience observations age out under real-world churn, or that contradictions resolve correctly in practice.

## 2. Evidence table

| Finding | Evidence (file · observation) | Confidence |
|---|---|---|
| A1 session-end auto-reflect is fully wired end-to-end | `lib/hooks/session-reflect.mjs:1-76, lib/reflect.mjs:155` — Stop hook in lib/hooks/session-reflect.mjs spawns runReflectAuto, which calls extractSessionObservation from lib/reflect/extractor.mjs, runs deterministic salience score from lib/reflect/salience.mjs, and calls addObservation to .cx/observations/. Hard 500ms budget with unref deadline. Exits 0 on all errors (best-effort). Entry point: lib/reflect.mjs:155. | confirmed |
| A1 deterministic salience score: mutations weighted highest (0.45 boost), bash (0.15), reads (implicit), turns (0.1 for >=5), files (0.05 for >=3), bounded [0.05, 0.95] | `lib/reflect/salience.mjs:1-66` — lib/reflect/salience.mjs:35–53 defines scoreSalience; MUTATING_TOOLS=[Write,Edit,MultiEdit,NotebookEdit] at line 21; shouldStore returns false for no-durable-signal sessions (line 59–65). Scores used as confidence in extractor (lib/reflect/extractor.mjs:78). | confirmed |
| A1 observation extraction skips trivial sessions: no tool calls AND <120 chars final text | `lib/reflect.mjs:167-170` — lib/reflect.mjs:167–170 defines trivial gate: `observation.extras?.toolCallCount === 0 && (observation.content?.length \|\| 0) < 120`. Suppresses one-line acknowledgements from store. | confirmed |
| Session start injects 1–2 top observations into next session context | `lib/hooks/session-start.mjs:121-149` — lib/hooks/session-start.mjs:126–149 queries observations with searchObservations, filters out placeholders, injects top 2 inline (rest via memory_search hint). Gated by CONSTRUCT_MEMORY != 'off'. | confirmed |
| Tool-miss capture wired in MCP dispatcher but untested and not consumed | `lib/mcp/tool-recovery.mjs:35-44, lib/mcp/server.mjs line ~1200 (grep confirm: recordToolNameMiss import)` — lib/mcp/server.mjs imports recordToolNameMiss; at tool dispatch fallback calls recordToolNameMiss(ROOT_DIR, { name, recovered }) to append .cx/observations/tool-name-misses.jsonl. No grep hits for reading or processing tool-name-misses.jsonl. No tests. | confirmed |
| A3 specialist outcome capture fully wired: recordOutcome appends to .cx/outcomes/<role>.jsonl | `lib/outcomes/record.mjs:66-96, lib/outcomes/aggregate.mjs:68-79` — lib/outcomes/record.mjs:66–96 records role, success, escalated, durationMs, notes to active + rotated files. aggregateOutcomes (lib/outcomes/aggregate.mjs:68–79) rebuilds _summary.json with per-role success rates. Intake classifier reads summary as soft tiebreaker (±0.05 cap in lib/intake/classify.mjs). | confirmed |
| A2 research persistence documented; no evidence of auto-capture from agent runs | `docs/guides/concepts/learning-loops.mdx:61-63, lib/mcp/tools/scope.mjs (knowledgeAdd)` — docs/guides/concepts/learning-loops.mdx:61–63 describes research persistence schema and MCP exposure (knowledge_add tool requires confirm=true). But no grep for research auto-capture; tool only callable via agent intent + MCP, not auto-triggered at session end. | confirmed |
| A4 prompt improvement documented but off by design: patches generated offline, never auto-applied | `docs/guides/concepts/learning-loops.mdx:69-71` — docs/guides/concepts/learning-loops.mdx:69–71 states patches land in ~/.cx/performance-reviews/patches/<agent>-<ts>.diff; `optimize_apply` and `optimize_rollback` stay CLI-only (operator decisions, not agent decisions). Rate-limited to one patch/agent/week. | confirmed |
| Consolidation pipeline: supersede (drop low-salience duplicates), contradiction detection (resolve flipped claims), archive cold storage all exist | `lib/engine/consolidate.mjs:1-66` — lib/engine/consolidate.mjs:1–66 describes full loop. supersedeThreshold=0.97 for tight clustering (line 52). contradictionMinSimilarity=0.75 (line 59). detectContradiction via lib/engine/contradiction.mjs. Consolidation idempotent and safe for cron/daemon (line 26). | confirmed |
| Contradiction detection: negation-polarity heuristic + optional offline Ollama judge | `tests/engine-contradiction.test.mjs, lib/engine/contradiction.mjs` — lib/engine/contradiction.mjs and tests/engine-contradiction.test.mjs confirm heuristic detects 'not supported' vs 'is supported' (opposite negation cues); Jaccard ≥0.6 on claim words. Optional judge consulted only when heuristic abstains (e.g., RS256 vs HS256 with no negation). Judge absent → heuristic-only. | confirmed |
| Oracle synthesizeVerdict produces gaps + recommendedActions from read-model (violations, doctor escalations, degraded outcomes) | `lib/oracle/synthesize.mjs:31-100` — lib/oracle/synthesize.mjs:31–100 builds gaps (contract-violations, doctor-escalation, outcomes-degradation) and actions (specialist-review, doctor-followup, trace-review). Gaps have severity + signal. No evidence that gaps trigger observations or learning flow. | confirmed |
| Test coverage: A1 (session-reflect) has functional test; salience test; no A2/A3/A4 integration tests | `tests/functional/a1-session-reflect.functional.test.mjs, tests/reflect-salience.test.mjs` — tests/functional/a1-session-reflect.functional.test.mjs: end-to-end hook → observation write → search. tests/reflect-salience.test.mjs: salience scoring and shouldStore. No tests for research capture, outcome → oracle flow, or prompt optimization. | confirmed |
| Learning status dashboard (scripts/learning-status.mjs) reads A1 index.json, A2 research dir, A3 _summary.json; mirrors learning_status MCP tool | `scripts/learning-status.mjs:1-88` — scripts/learning-status.mjs:25–69 queries observations (total + last 24h), research findings (file count), outcomes (per-role stats). Output tab-aligned. No LLM, no network. Exposed as MCP tool in lib/mcp/tools/scope.mjs. | confirmed |
| Tool-miss capture writes to `.cx/observations/tool-name-misses.jsonl` but is never read or analyzed | `lib/mcp/tool-recovery.mjs:35-44` — lib/mcp/tool-recovery.mjs:35–44 appends { at, kind: 'tool-name-miss', name, recovered } JSONL. Grep shows no consumer reading this file. No oracle action or alert triggered. Best-effort write only. | confirmed |
| Failure capture (exception, timeout, contract violation) exists for telemetry (cxScore records anti-patterns) but not for tool/command failures | `lib/mcp/tools/telemetry.mjs:202-281` — lib/mcp/tools/telemetry.mjs:225–234 and 235–244 record low (<0.5) and high (>=0.85) quality scores as 'anti-pattern' and 'pattern' observations. But tool execution failures (MCP timeout, Bash exit code, gate denial) do not auto-generate failure observations. | confirmed |
| No evidence that low-salience observations are actually archived under consolidation; `archiveBelowConfidence=0.5` documented but not verified in real data | `lib/engine/consolidate.mjs:44-66` — lib/engine/consolidate.mjs:46–47 defines archiveBelowConfidence=0.5 and consolidation archives observations both older than archiveAfterDays AND below that threshold. But no test verifies that a low-salience read-only session is actually pruned from live store. Consolidation is safe/idempotent but no audit trail of what was archived. | likely |

## 3. Confirmed gaps

- Tool-miss capture writes JSONL but is never read, analyzed, or surfaced as an alert or observation. Discoverability gap is documented as unseen by `construct doctor`.
- Failure capture (command timeouts, tool errors, gate denials) does not auto-generate anti-pattern observations. Only quality scores from explicit scoring trigger pattern/anti-pattern recording.
- A2 (research persistence) documented but no auto-capture from specialist runs; only manual via knowledge_add MCP tool or construct reflect CLI. Research findings do not flow from session outcomes.
- A4 (prompt improvement) documented but explicitly offline: patches generated weekly but never auto-applied. No feedback loop from prompt quality scores back to specialist prompts.
- No integration test verifying end-to-end loop: session → observation → archive/supersede → next session picks better pattern. Tests exist for individual components (A1, salience, contradiction) but not the full chain.
- Oracle recommendation flow produces gaps and suggested actions but no evidence these trigger new observations or feed back into the learning system. Gaps exist but are not captured as learnable facts.

## 4. Unconfirmed concerns

- Baseline facts '96 observations dropped in 7d; 63 contract violations in 24h' are not found in repo. May be external metrics or from a production deployment.
- Consolidation supersede/contradiction resolution is wired but untested on large real-world observation sets. The O(n²) scan bounded at 1500 records may silently skip contradictions if store grows larger.
- Tool-miss recovery (stripHostPrefix, isGatewayName) tolerates common misnamings but success rate unknown. No telemetry on how often recovery succeeds vs. outright fails.
- Memory injection stats (lib/hooks/session-start.mjs:154–163) write to session-memory-stats.json but no consumer reads or aggregates them. Ablation study infrastructure may not be connected.
- Outcome boost capping (±0.05) in classifier may be too conservative; soft tiebreaker influence on taxonomy precision unclear.

## 5. Registry / config / schema opportunities

- Tool-miss recovery patterns (construct-mcp_ prefix, construct_call alias) are hardcoded in lib/mcp/tool-recovery.mjs. Could be externalized to a registry of known aliases or auto-discovered from schema.
- Consolidation thresholds (similarityThreshold=0.95, supersedeThreshold=0.97, contradictionMinSimilarity=0.75) are hardcoded DEFAULTS in lib/engine/consolidate.mjs. Could be config-driven per project.
- Salience signals (MUTATING_TOOLS, READ_TOOLS, weight boosts) hardcoded in lib/reflect/salience.mjs. Could be a tunable registry so operators can adjust retention bias.
- Outcome boost cap (0.05) in lib/outcomes/aggregate.mjs:96–104 is hardcoded. Could be a configurable parameter per profile.
- Anti-pattern and pattern recording thresholds (SCORE_POOR_THRESHOLD=0.5, SCORE_GOOD_THRESHOLD=0.85) hardcoded in lib/mcp/tools/telemetry.mjs:199–200. Could be schema-driven.

## 6. Tests needed

_none reported_

## 7. Docs needed

- Consolidation runbook: when/how to invoke consolidate (daemon? cron? CLI?), what thresholds apply, how to interpret archived observations and supersededBy pointers.
- Tool-miss handling guide: how to read tool-name-misses.jsonl, interpret recovered vs. unrecoverable misses, and add custom aliases for host-specific tool naming.
- Outcome flow diagram: how recordOutcome → aggregateOutcomes → outcomeBoost feeds the classifier and intake triage.
- A/B ablation setup: how to configure CONSTRUCT_MEMORY=off, what memory-stats.jsonl records, how to analyze hit rate and retrieval latency.
- Contradiction resolution case study: example of conflicting observations, how contradiction detection finds them, which observation wins and why.

## 8. Migration concerns

- Observations store format (JSONL + index.json + vectors.json) is stable but if vector model changes (e.g., from hashing-bow to dense embeddings), old vectors are incompatible. No migration path documented.
- Outcome JSONL schema is stable but rotation at 10k lines per role assumes file system handles large directories. No tested upper bound on .cx/outcomes/ size.
- Consolidation archive directory (.cx/observations/archive/) can grow unbounded if archiveRetainDays=365 and maxFiles=1000 not enforced. Old Construct projects may have stale archives.
- Tool-name-misses.jsonl has no rotation or size cap. Long-running instances may accumulate large files.

## 9. Questions for Opus

- Are the '96 observations dropped in 7d' and '63 contract violations in 24h' baseline facts from production telemetry, or test fixtures? Repo shows no hardcoded these numbers.
- Is consolidation scheduled via daemon or cron, or does it run only on demand via CLI? No grep for consolidate being called from oracle or daemon ticks.
- What is the operator's expectation for A4 (prompt improvement patches)? If patches are never auto-applied, is the feedback loop expected to be manual review + CLI apply?
- Should tool-miss recording (tool-name-misses.jsonl) trigger an alert if a specific tool is repeatedly misnamed? Currently it is silent telemetry.
- Is the 7-day freshness window for context injection (lib/hooks/session-start.mjs:56) tunable, or should it vary by project profile?

## 10. Suggested bead updates (proposals only — Opus owns Beads)

- Add consumer for tool-name-misses.jsonl: doctor watcher or oracle action that counts misses per tool and surfaces top discoverability gaps as beads.
- Add integration test: full session → observe → search → consolidate → next session injection loop. Verify low-salience sessions are archived and high-salience ones surface.
- Wire A2 research auto-capture: add CLI option or MCP tool to record specialist findings as research without manual knowledge_add.
- Expose consolidation decisions (superseded, contradictions resolved, archived) as beads when archiveMaxFiles or archiveRetainDays thresholds are approached.
- Add oracle action to audit tool-name-miss patterns and raise beads for tools consistently misnamed by hosts.

