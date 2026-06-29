---
title: Alignment Scorecard (2026-06-19)
description: Full documentation and site alignment pass — dated snapshot, not a living doc.
---

# Alignment Scorecard — 2026-06-19

Program: Construct Alignment Program · Branch: `feature/construct-terminal-acp` · Census: `node scripts/alignment/census.mjs` → `audit-artifacts/alignment-census.json`

**Exit gate:** Documentation/site alignment pass complete; release gates green.

## Audit harness (phases 00–06, 05b)

| Phase | Result | Reproduce |
|---|---|---|
| 00 inventory | 113 commands, 0 handler-orphans | `node scripts/audit/00-inventory.mjs` |
| 01 smoke | 113 wired, 0 dead | `node scripts/audit/01-smoke.mjs` |
| 02 deadcode | 0 dead, 0 test-only | `node scripts/audit/02-deadcode.mjs` |
| 03 docs | 0 undocumented cmds, 0 nav-orphans | `node scripts/audit/03-docs.mjs` |
| 03b naming | 0 drift | `node scripts/audit/03b-naming.mjs` |
| 06 audit | chain ok (repo-deterministic) | `node scripts/audit/06-audit.mjs` |
| 05b visual | 31 help surfaces scored, 0 flagged | `node scripts/audit/05b-visual-judge.mjs` |

**Ratchet:** `scripts/audit/baseline.json` empty `acceptedIds` — **0 regressions**.

## Skill and workflow census

| Metric | Value | Source |
|---|---:|---|
| Skill files | 149 | `lib/audit-skills.mjs` |
| Declared in registry | 97 | `specialists/registry.json` |
| Registry bound-orphans | 52 | not in any specialist `skills:` array |
| Composer-reachable (B-composer) | 52 | intentional via `lib/prompt-composer.js` |
| True orphans (C-merge + D-review) | 0 | `lib/registry/consolidation.mjs` |
| Embedded workflows | 10 | `lib/embedded-contract/workflow-defs.mjs` |
| Agent contracts | 40 | `specialists/contracts.json` |

Proposal: [`skill-consolidation-proposal-2026-06.md`](./skill-consolidation-proposal-2026-06.md) (gate: nothing deleted without approval).

## Documentation and site alignment

| Deliverable | Path |
|---|---|
| Generated specialists page | `docs/guides/reference/specialists.md` (was broken `/reference/agents` link) |
| `construct docs:site --check` | `lib/auto-docs.mjs` + `release:check` + CI docs job |
| Site sidebar lanes | Maintenance, Contributing, ADRs in `apps/docs/lib/docs-source.ts` |
| Home page gate copy | Matches `docs/guides/concepts/gates-and-enforcement.mdx` (no skip env vars) |
| ADR link fixes | `/adr/*` routes in `docs/guides/concepts/architecture.mdx` |
| Two-registry disambiguation | `registry/capabilities.json` vs `platforms/capabilities.json` in architecture |

## P0 capability validation

| Capability | lastValidated | Verification |
|---|---|---|
| `orchestration.routing` | 2026-06-19 | tier tests + partial functional |
| `mcp.broker.connection` | 2026-06-19 | `tests/capabilities/mcp.broker.connection/mcp.test.mjs` |
| `ingest.adapter` | 2026-06-19 | `tests/functional/node-native-extraction.functional.test.mjs` |

Stamp: `node scripts/run-capability-tests.mjs --tier=P0 --stamp` · Regenerate: `construct registry:generate-docs`

## Oracle overseer (org-in-a-box)

| Deliverable | Evidence |
|---|---|
| Closed loop | `.cx/oracle/verdicts/<date>.json`, idempotent beads raise, `construct oracle approve <id>` executes |
| Org graph | `lib/oracle/org-graph.mjs` — workflow gates, legal intake, capability stamps, propagation-stale |
| Sign-off metadata | Approve actions carry `{ gateType, requiredApprover, artifactPath }` |
| Ambient | Oracle starts with `construct dev`; session-start prelude surfaces verdict + pending |
| Tests | `tests/functional/oracle-synthesis.functional.test.mjs`, `oracle-closed-loop.functional.test.mjs`, `oracle-bounded-auto.functional.test.mjs` |
| Capability | `oracle.meta-review` stamped 2026-06-19 |

## Six-dimension scores (0–3)

| Dimension | Score | Evidence |
|---|---:|---|
| 1. Prompt economy | **3** | Single Front Door; composer-reachable role flavors documented |
| 2. Tool surface design | **2** | MCP flat core + ADR-0039 surfaces |
| 3. Local-model strategy | **2** | Local tier + host prompt profiles |
| 4. Skill/knowledge architecture | **3** | 0 true orphans; B-composer metrics in census |
| 5. Hook/gate philosophy | **2** | Unconditional gates; site copy aligned |
| 6. Test strategy | **2** | `docs:site --check` in release gate; capability stamps |

**Overall:** Documentation, site navigation, and registry honesty aligned with runtime. Remaining work is product capabilities (`construct diagram`, `construct demo`) tracked separately.

## Commands

```bash
node scripts/alignment/census.mjs --ratchet
node ./bin/construct docs:site --check
node ./bin/construct registry:validate
npm run release:check
DOCS_BASE_PATH=/construct npm --prefix apps/docs run build
```
