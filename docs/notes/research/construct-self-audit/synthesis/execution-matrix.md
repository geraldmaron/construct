---
intake: none
---

# Execution Matrix — Construct Self-Audit (Phase 3 synthesis)

Supervisor: Opus · Branch: `audit/best-practice-alignment` · Date: 2026-06-29

Maps the 11 child epics (`construct-rr63.1`–`.11`) to execution waves, parallelization class, gate,
and the model tier allowed to execute. **No production implementation starts until the relevant gate
is GREEN** (see [risk-register.md](risk-register.md)). Wave 1 = audit/contracts only.

## Parallelization classes

- `parallel-safe` — disjoint file set, no shared-state mutation; may run concurrently with locks.
- `serial-required` — touches a shared surface; one writer at a time.
- `blocked-by-*-gate` — may not start until the named gate is green (architecture / migration /
  host-parity / tool-contract).

## Model tiers

- **Haiku** — docs-only, inventory-only, fixture/description drafting (bounded, reviewed by Opus).
- **Sonnet** — normal implementation + tests.
- **Opus** — architecture, migration design, registry contracts, conflict resolution, final review.
- High/critical-risk implementation is **never** delegated below Opus review.

## Epic → wave → execution plan

| Epic | Title | Lead findings | Wave | Class | Gate | Executor |
|---|---|---|---|---|---|---|
| .1 | ADR truth & drift | 0018–0021 mislabeled; 0043/0039 conflict | 1 | parallel-safe | none (docs) | Haiku draft → Opus decide |
| .2 | Registry-first / anti-hardcoding | tools/services/hosts/migration hardcoded | 1→3 | blocked-by-architecture-gate | architecture | Opus contract → Sonnet extract |
| .3 | Install/init/sync/upgrade cert | non-destructive ok; 4 gaps; no fixtures | 1→2→4 | blocked-by-migration-gate | migration | Opus design → Sonnet impl |
| .4 | Host parity & capability matrix | file-parity not capability-parity | 1→2→4 | blocked-by-host-parity-gate | host-parity | Opus matrix → Sonnet impl |
| .5 | Research/search contract | no web search; no typed degradation | 1→4 | blocked-by-tool-contract-gate | tool-contract | Opus contract → Sonnet impl |
| .6 | MCP design/discovery/evals | no outputSchema; ad-hoc errors | 1→2→4 | blocked-by-tool-contract-gate | tool-contract | Opus schema → Sonnet impl |
| .7 | Orchestration truth & parity | enforced; negative-test holes | 1→2 | blocked-by-architecture-gate | architecture | Sonnet tests → Opus review |
| .8 | Document intelligence | no approval gate; lane dup/collision | 1→2→4 | blocked-by-migration-gate | migration | Opus contract → Sonnet impl |
| .9 | Learning loops | tool-miss/failure capture unused | 1→2→4 | blocked-by-tool-contract-gate | tool-contract | Sonnet impl → Opus review |
| .10 | Best-practice / external benchmark | depends on .5 web-search stance | 5 | serial-required | tool-contract (.5) | Opus synth |
| .11 | Construct-on-Construct cert | self-hosting 0 tests | 5 | serial-required | all gates | Opus + Sonnet |

## Wave plan (what is allowed / blocked)

### Wave 1 — Audit & contracts  ✅ (this run)
Allowed: ADR drift report, registry contract proposal, host capability matrix proposal, search/
research contract proposal, orchestration truth table, upgrade scenario inventory, test coverage
map. **Done:** baseline + 10 evidence reports + 4 synthesis docs. **Blocked:** production refactors,
web-search impl, host adapter rewrites, service-manager refactor, migration framework changes.

### Wave 2 — Test scaffolding (no behaviour change)
Executor: Sonnet (Haiku for fixture descriptions). Allowed: registry-schema validation tests, host
capability-matrix tests, MCP discovery evals, **upgrade scenario fixtures**, orchestration negative/
truth tests, research-unavailable degradation test, docs-detection fixtures. **Blocked:** large
refactors until these tests exist. These tests are the gate-openers for Waves 3–4.

### Wave 3 — Registry extraction
Executor: Sonnet + **Opus review required**. Allowed only once Wave-2 characterization tests are
green: extract MCP-tools / services / host-check / doc-lanes / migration-table registries; generate
host & MCP docs from registry; assert no behaviour change. **Blocked:** new capabilities.

### Wave 4 — Capability remediation
Executor: Sonnet + Opus review for search/orchestration/migration. Allowed: research/search typed
degradation; host capability reporting; MCP outputSchema + structured errors; orchestration result
hardening; learning-loop capture consumers. Each behind its tool-contract / host-parity / migration
gate.

### Wave 5 — Self-hosting certification
Executor: Opus (architecture) + Sonnet (scenarios) + Haiku (docs). Allowed: Construct self-audit
workflow; "Construct runs on Construct" cert; doctor/oracle/beads/learning integration; final
release-gate updates (epic→gate mapping).

## Dependency gates (DAG)

```
Wave1 audit ──> Wave2 tests ──┬─> Wave3 registry extraction ──┐
                              ├─> Wave4 capability remediation ┼─> Wave5 self-host cert
owner decisions (R2,.10,.5) ──┘                               │
migration-gate fixtures (R7,R9) ──────────────────────────────┘
```

## Owner decisions required before they unblock

1. **R2** — ADR-0043 Oracle surface: user-facing (`core`) or `internal`?
2. **.5** — Is public web search a future Construct capability or permanently host-delegated? (Sets
   whether .10 external benchmarking is even possible without fabrication.)
3. **R7 scope** — On upgrade, may Construct re-converge `.cx/context.*`, or is user-edited-without-
   resync the intended contract?

These are captured as `questionsForOpus` in the relevant reports and surfaced in the final bead tree
as decision beads, not implementation beads.
