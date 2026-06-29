---
intake: none
---

# Consolidated Findings — Construct Self-Audit (Phase 3 synthesis)

Supervisor: Opus · Branch: `audit/best-practice-alignment` · Date: 2026-06-29
Inputs: 10 Wave-1 subagent reports under `../subagents/` (Haiku, read-only Explore) + Phase-0
[baseline.md](../baseline.md).

## Provenance & adjudication rules

- **Verified-by-Opus** = observed directly in Phase 0 (the `npm test`, `construct doctor`, `sync`,
  `docs:verify` runs). Treated as ground truth.
- **Agent-reported** = a Wave-1 subagent's structured evidence, carried at the confidence the agent
  assigned (`confirmed | likely | unverified`). File:line citations are the agent's; they are
  strong leads but were not independently re-opened by Opus except where noted. No agent-reported
  claim has been promoted to fact without that caveat — per the no-fabrication rule.
- Where an agent claim **contradicts** verified ground truth, Opus marks it **REFUTED** and keeps
  the verified value.

## Cross-agent contradictions & Opus adjudication

| # | Claim | Source | Adjudication |
|---|---|---|---|
| C1 | "3544 tests, 3529 passing, **1 failing**, 14 skipped" | Agent J | **REFUTED.** Verified Phase-0 `npm test` = 3536 pass / **0 fail** / 8 skipped. J's pass/fail/skip counts are wrong (likely inferred, not run — agents were read-only and did not execute the suite). Keep verified numbers. J's *qualitative* coverage gaps (self-hosting 0, learning sparse, no upgrade fixtures) remain valid and are corroborated structurally. |
| C2 | ADRs 0019/0020/0021 are "proposed" | Agent A | **CORROBORATED, not contradicted**, by Agent G, which independently confirmed the orchestration runtime (planned/prepared/provider-executed) is shipped *and test-enforced*. Two agents from different angles agree the orchestration ADRs are shipped-but-mislabeled. High confidence. |
| C3 | "No public web search capability in Construct" | Agent E | Consistent with Agent D (no web-search tool among 75) and Agent J (no e2e search scenario). No contradiction. Confirmed stance below. |

No other material contradictions surfaced; the reports are largely complementary.

## Confirmed findings (agent-confirmed, corroborated where noted)

### ADR truth (Agent A — 26/26 confirmed)
- **Status drift:** ADRs **0018, 0019, 0020, 0021** are implemented + tested but still labeled
  `proposed`. (0019/0020/0021 corroborated by Agent G.) → amend to `accepted`.
- **Surface contradiction:** ADR-0043 (Oracle) is registered `internal: true`
  (`lib/cli-commands.mjs:1148`) yet the ADR-0039 amendment (2026-06-25) lists `construct oracle`
  as a *user-facing* observability surface beside `status`/`doctor`. **Decision needed** (Q for owner).
- ADR-0045 docs-taxonomy enforcement and intake-zone migration status are **unverified** in code.
- ADR-0046 modular-org loader exists (`lib/registry/loader.mjs:55`) but migration of the legacy
  `unified-registry.json` readers is **unverified**.

### Registry / anti-hardcoding (Agent B — 14/14 confirmed)
- MCP **core tool set** (16) and **`ALL_TOOL_DEFS`** (the full catalog) are inline in
  `lib/mcp/server.mjs`; catalog changes need code edits.
- **Platform MCP config paths** duplicated across `parity.mjs`, `features.mjs`, `mcp-manager.mjs`.
- `SELECTABLE_SERVICES` and ports `5173/5174` hardcoded in `service-manager.mjs`.
- **Version-migration boundaries** (`v1.0.10`, `v1.0.13`) embedded in `parity.mjs`.
- Doc-lane definitions duplicated; OpenCode builtin agent names hardcoded in `parity.mjs`.

### Host parity (Agent C — 9 confirmed / 1 likely)
- Parity is judged by **config-file existence, not runtime capability**. No degradation message when
  a host has artifacts but isn't actually installed/reachable. Corroborates the verified baseline
  `.cursor`-adapter-for-uninstalled-host drift. `entry.platforms` is wired but **unpopulated**.
  No host-capability discovery tool exists.

### MCP tools & discovery (Agent D — 14/14 confirmed)
- **75 tools** (16 flat core + 59 long-tail behind a `call` gateway); all have **inputSchemas**,
  **none have outputSchemas**. Error shapes are **ad-hoc** (`{error: string}` vs structured).
  `find_tool` **silently degrades** embedding→BM25 with no `rankingMethod` signal. 73/75 tools lack
  return-value docs. ADR-0048 implementation otherwise matches spec.

### Research / search (Agent E — 11/11 confirmed)
- Five real surfaces: `knowledge_search`, `provider_fetch` (GitHub/Jira/Linear/Slack via env),
  `rovo_search`, `memory_search`, `session_search`. **No public web search** in Construct — it is
  **host-delegated**, and there is **no typed degradation** when the host lacks it. Crucially, no
  surface **conflates** source/repo search with web search (good). This is the anti-fake-capability
  finding: truthful contract work required, not a new feature claim.

### Lifecycle: install/init/sync/upgrade (Agent F — 10 confirmed / 1 likely)
- Foundation is **non-destructive**: marker blocks, skip-if-exists, two-phase staging + atomic
  renames, manifest-tracked per-host writes, version+hash dedup markers, idempotent `.gitignore`.
- Gaps: init **auto-starts services** in non-interactive mode (only `--no-start` opts out);
  dirty-repo detection is **silent** unless `--verbose`; `.cx/context.{md,json}` written once and
  **never re-converged** (drift undetected); **no retention/prune manifest** for `.cx/`.
  HOME/XDG isolation exists in code but lacks an explicit **e2e test**.

### Orchestration truth (Agent G — 17/17 confirmed)
- **Strong contract:** planning vs preparation vs execution are separated and **test-enforced** —
  inline backend ⇒ `status:"prepared"`, `executor:"inline:prepared"`, `output:null`; provider
  backend ⇒ real output, `executor:"provider:<provider>:<model>"`, `status:"done"`; every
  capability response carries a mandatory semantics disclaimer; no credential leakage.
- Gaps are **negative-test** holes: no inverse test catching a regression where inline *sets*
  output; no e2e test of the remote/team HTTP path (`CONSTRUCT_ORCHESTRATION_URL`); chain-of-thought
  `hidden`/`telemetry_only` disclosure not test-verified.

### Document intelligence (Agent H — 10 confirmed / 1 likely / 1 unverified)
- Lane scaffolding + content routing + ADR-0018 quality enforcement exist. Gaps: **no
  explicit-approval gate** before auto-promotion (`maybePromoteToDocs` writes directly); doc-type
  defs duplicated (`doc-lanes.mjs` vs `docs-routing.mjs`); **duplicate-lane risk** on alias
  collisions (e.g. `incidents/` + `postmortems/` → same lane); ADR-0045 Phase-2 intake migration
  status undocumented.

### Learning loops (Agent I — 15 confirmed / 1 likely)
- **A1 session auto-reflect** fully wired (500ms Stop hook → `.cx/observations/`). A2/A3 partial;
  **A4 prompt-improvement is offline-only** (patches generated, never auto-applied). **Tool-miss
  capture writes `tool-name-misses.jsonl` but nothing reads/surfaces it.** **Failure capture is
  absent.** No e2e loop test. Corroborates baseline (96 dropped obs / 7d). Ties to `construct-2q2m`.

### Test coverage & gates (Agent J — 15 confirmed / 2 likely, minus REFUTED C1)
- **Self-hosting: 0 tests.** Learning: sparse. ADR-drift: 1 test. **No upgrade fixtures.** No MCP
  discovery eval harness. **No epic→test/gate mapping** (CI filters by path, not epic).

## Registry-first opportunities (consolidated, deduped)

1. **MCP tools manifest** — extract `CORE_TOOL_NAMES` + `ALL_TOOL_DEFS` → `registry/mcp-tools.json`
   (+ optional `outputSchema`, `errorSchema`, `read_only`, `cost`, `approval_required`, `status`).
2. **Surfaces / host config-paths manifest** — one source for VS Code/Cursor/OpenCode MCP paths.
3. **Services registry** — `SELECTABLE_SERVICES` + ports → `construct.config` schema.
4. **Version-migration table** — replace `v1.0.10/v1.0.13` literals with a declarative upgrade map.
5. **Doc-lanes single schema** — collapse the `doc-lanes.mjs` / `docs-routing.mjs` duplication;
   add alias-conflict detection + per-lane `approvalRequired`.
6. **Registry-driven host-check table** — `{hostId, configPath, kind, expectedKey, degradationReason}`.
7. **Degradation-reason registry** — typed reasons for host/search/orchestration degradation.
8. **Epic→test registry + release-gates schema** — declarative `gates.json`, per-epic mapping.

## ADRs needing amendment / supersession

| ADR | Action | Type |
|---|---|---|
| 0018, 0019, 0020, 0021 | `proposed → accepted` (ground truth is shipped+tested) | Housekeeping bead |
| 0043 vs 0039 | Resolve Oracle CLI surface (`internal:true` vs user-facing) | **Owner decision** |
| 0045 | Document taxonomy-enforcement + intake-zone migration status | Decision/doc |
| 0046 | Confirm/document `unified-registry.json` reader migration | Decision/doc |

## Capability stances (truthful contracts)

- **Host capability matrix** — parity must report capability, not file existence: per host
  `{discoverability, callability, degradation, degradationReason, expectedBehavior}`, registry-driven,
  plus a capability-discovery tool. (Agent C)
- **Search/research** — Construct exposes 5 local/configured/source search surfaces and **no public
  web search**; web search is host-delegated. Construct must (a) never claim web search as its own
  capability, (b) return a **typed degradation** when the host lacks it, (c) document `toolRouting`
  as descriptive. (Agent E)
- **Orchestration truth** — the prepared/executed distinction is real and enforced; harden with
  negative/HTTP/disclosure tests; never claim host-native execution that didn't occur. (Agent G)
- **Lifecycle preservation** — non-destructive foundation is sound; gate any change behind upgrade
  fixtures + HOME/XDG e2e + dirty-repo warning + context-drift detection; never silently prune
  `.cx`/Beads/docs/adapters/AGENTS.md/CLAUDE.md/config. (Agent F)

## What is NOT broken (so we don't "fix" it)

- Orchestration prepared/executed contract (test-enforced).
- Non-destructive write foundation (markers/staging/atomic).
- A1 session auto-reflect.
- No search surface fakes web search.
- ADR-0048 find_tool matches its spec.
- Verified green test baseline (0 failures).

## Decisions rendered (owner, 2026-06-29)

- **`.5.1` web search → BUILD a governed public web/search capability** (not permanently
  host-delegated). Implication: epic `.10` external benchmarking becomes real; interim typed
  degradation still required until the capability ships. Spawned `construct-rr63.5.2` (capability
  contract + citation/degradation tests, ADR-0017 source-credibility enforced).
- `.1.1` (Oracle surface) and `.3.1` (`.cx/context` upgrade contract) remain open — awaiting owner.

## Phase-3 gate

Synthesis complete. Contradiction C1 quarantined. No production code changed. Proceed to Phase 4
(bead tree) — implementation remains blocked until beads carry model/file-locks/tests/docs/migration.
