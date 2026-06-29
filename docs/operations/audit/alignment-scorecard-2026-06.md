---
title: Alignment Scorecard (2026-06)
description: Phase 0 end-review baseline for the Construct Alignment Program. Dated snapshot — not a living doc.
---

# Alignment Scorecard — 2026-06-18

Program: Construct Alignment Program · Branch: `feature/construct-terminal-acp` · Census: `node scripts/alignment/census.mjs` → `audit-artifacts/alignment-census.json`

**Exit gate:** Maintainer review of this scorecard before Phase 1+ execution is treated as complete.

## Audit harness (phases 00–06, 05b)

| Phase | Result | Reproduce |
|---|---|---|
| 00 inventory | 113 commands, 0 handler-orphans | `node scripts/audit/00-inventory.mjs` |
| 01 smoke | 113 wired, 0 dead | `node scripts/audit/01-smoke.mjs` |
| 02 deadcode | 0 dead, 0 test-only (jsx import graph fix) | `node scripts/audit/02-deadcode.mjs` |
| 03 docs | 0 undocumented cmds, 0 nav-orphans | `node scripts/audit/03-docs.mjs` |
| 03b naming | 0 drift | `node scripts/audit/03b-naming.mjs` |
| 06 audit | chain ok, hook registered | `node scripts/audit/06-audit.mjs` |
| 05b visual | 31 help surfaces scored, 0 flagged | `node scripts/audit/05b-visual-judge.mjs` |

**Ratchet:** `scripts/audit/baseline.json` has empty `acceptedIds` — **0 regressions** after doc/nav fixes (strict gate).

## Skill and workflow census

| Metric | Value | Source |
|---|---:|---|
| Skill files | 149 | `lib/audit-skills.mjs` |
| Declared in registry | 94 | `specialists/registry.json` |
| Registry bound-orphans | 53 | not in any specialist `skills:` array (2 A-binds applied) |
| Profile-aware orphans | 0 | `docs/document-ingest-workflow`, `docs/strategy-workflow` bound |
| Embedded workflows | 10 | `lib/embedded-contract/workflow-defs.mjs` |
| YAML workflow templates | 3 | `templates/workflows/*.yml` |
| Agent contracts | 40 | `specialists/contracts.json` |

Proposal for bound-orphans: [`skill-consolidation-proposal-2026-06.md`](./skill-consolidation-proposal-2026-06.md) (maintainer approval before bind/merge/delete).

## Surface parity (`construct doctor` snapshot)

- Cross-surface adapter parity: ok (project `.cursor/` + `.vscode/` checked when hosts installed)
- Cursor bootstrap: `npm run adapters` + tool-repo postinstall sync
- Oracle daemon: `construct oracle review --dry-run` (L0.5 meta-review)
- Docling runtime: ready (docling 2.45.0)
- Platform capability registry: `platforms/capabilities.json` loaded (ADR-0033)
- Contract violations: 88 in last 24h (warning — existing operational signal)

## Six-dimension scores (0–3)

| Dimension | Score | Evidence |
|---|---:|---|
| 1. Prompt economy | **3** | Single Front Door: all hosts use orchestration micro-prompt; static roster removed from sync ([`scripts/sync-specialists.mjs`](../../scripts/sync-specialists.mjs)) |
| 2. Tool surface design | **2** | MCP 7-tool flat core + `construct_call`; ADR-0039 `surface` field on CLI commands shipped |
| 3. Local-model strategy | **2** | `local/*` tier detection; host prompt profiles; probe + doctor local-model checks |
| 4. Skill/knowledge architecture | **2** | 53 B-composer orphans documented in [`naming.md`](../../guides/reference/naming.md); A-bind workflows wired; consolidation proposal tracked |
| 5. Hook/gate philosophy | **2** | 36 hooks wired; `hook-calls.jsonl` telemetry shipped; rule reference telemetry added (`rule-calls.jsonl`) |
| 6. Test strategy | **2** | Extend-not-rebuild (ADR-0035); registry + capability test tier added; P0 `lastValidated` still null until `--stamp` run |

**Overall:** Foundation is sound; gaps are **registry spine**, **skill binding honesty**, and **capability validation discipline** — not a rebuild.

## Phase 1+ deliverables (this implementation)

| Deliverable | Path |
|---|---|
| Capability registry (17 pilot entries) | `registry/capabilities.json` |
| Registry validator | `lib/registry/validate.mjs` |
| Generated reference | `docs/guides/reference/capabilities.md` |
| Alignment census script | `scripts/alignment/census.mjs` |
| Surface map (ADR-0039) | `lib/registry/surface-map.mjs` |
| P0 capability tests | `tests/capabilities/*/mcp.test.mjs` |
| Workflow verification bars | `skills/docs/*-workflow.md` frontmatter |

## Commands

```bash
node scripts/alignment/census.mjs
construct registry:validate
construct registry:generate-docs
construct rules usage --since=30d
node scripts/run-capability-tests.mjs --tier=P0 --stamp
```
