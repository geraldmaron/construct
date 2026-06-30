---
intake: none
---

# Final Bead Tree — Construct Self-Audit (Phase 4)

Supervisor: Opus · Branch: `audit/best-practice-alignment` · Date: 2026-06-29

The complete Beads tree for the best-practice alignment / self-hosting program after Wave-1 audit
and Phase-3 synthesis. Only Opus created these beads (traffic-jam #1). Implementation beads for
Waves 3–4 are intentionally **not yet created** — they are authored only after their gate test beads
go green, so the tree never implies premature work.

## Epic tree

```
construct-rr63  EPIC  Construct best-practice alignment and self-hosting certification
├── .1   ADR truth audit and architecture drift report
│   ├── .1.1  DECISION  Resolve ADR-0043/0039 Oracle CLI surface contradiction        [owner-gate, med]
│   └── .1.2  chore     ADR status truth-up: 0018/0019/0020/0021 -> accepted          [parallel-safe, low, READY]
├── .2   Registry-first architecture and anti-hardcoding pass
│   └── .2.1  task      Wave2 registry extraction inventory + characterization tests  [arch-gate-opener, high, READY]
├── .3   End-to-end install init sync upgrade certification
│   ├── .3.1  DECISION  Upgrade contract for .cx/context.* (re-converge vs preserve)  [owner-gate, high]  ──blocks──┐
│   └── .3.2  task      Wave2 upgrade fixtures + HOME/XDG e2e + dirty-repo test        [migration-gate-opener, high] <┘
├── .4   Host parity and capability availability matrix
│   └── .4.1  task      Wave2 host capability-matrix contract + matrix test           [host-parity-gate-opener, high, READY]
├── .5   Research and search capability contract
│   ├── .5.1  DECISION  Public web search: future capability vs host-delegated        [owner-gate, high]  ──blocks──┐
│   └── (.5 impl beads authored after .5.1)                                                                          │
├── .6   MCP tool design discovery annotations and evals                                                            │
│   └── .6.1  task      Wave2 MCP outputSchema + errorSchema + typed-degradation test [tool-contract-gate-opener] <─┘
├── .7   Orchestration truth and execution parity
│   └── .7.1  task      Wave2 orchestration negative/inverse/HTTP/CoT tests           [arch-gate-opener, high, READY]
├── .8   Document intelligence and template stewardship
│   └── .8.1  task      Wave2 doc-intake approval gate + alias-conflict fixtures       [migration-gate, high]
├── .9   Learning loops failure capture and specialist improvement
│   └── .9.1  task      Wave2/4 learning-loop consumers + e2e loop test               [tool-contract-gate, med]
├── .10  Community best-practice alignment and external benchmark    (blocked on .5.1 decision; see body)
└── .11  Construct runs on Construct certification                   (Wave 5; depends on all gates)
```

## Bead classification ledger

| Bead | Type | Wave | Parallelization | Risk | Executor | Gate it opens / needs |
|---|---|---|---|---|---|---|
| .1.1 | decision | 1 | serial-required | med | Opus→Sonnet | owner decision |
| .1.2 | chore | 1 | parallel-safe | low | Haiku→Opus | none |
| .2.1 | task | 2 | serial-required | high | Haiku→Sonnet→Opus | opens architecture-gate (Wave 3) |
| .3.1 | decision | 1 | serial-required | high | Opus | owner decision; blocks .3.2 |
| .3.2 | task | 2 | serial-required | high | Sonnet | opens migration-gate; needs .3.1 |
| .4.1 | task | 2 | parallel-safe | high | Opus→Sonnet | opens host-parity-gate |
| .5.1 | decision | 1 | serial-required | high | Opus | owner decision; blocks .6.1 + .10 |
| .6.1 | task | 2 | parallel-safe | med | Opus→Sonnet | opens tool-contract-gate; needs .5.1 |
| .7.1 | task | 2 | parallel-safe | high | Sonnet→Opus | opens architecture-gate (orchestration) |
| .8.1 | task | 2 | parallel-safe | high | Sonnet→Opus | under migration-gate |
| .9.1 | task | 2→4 | parallel-safe→serial | med | Sonnet→Opus | under tool-contract-gate |

## Wired dependencies (in Beads)

- `.3.1` **blocks** `.3.2` — fixtures encode the contract the owner chooses.
- `.5.1` **blocks** `.6.1` — degradation shape depends on the web-search stance.
- `.5.1` → `.10`: dependency recorded in `.10`'s body (bd disallows epic→task block edges).

## File-lock map (no two ready beads share a writable file)

| Bead | Writable paths (locked) | Read-only |
|---|---|---|
| .1.2 | `docs/decisions/adr/0018-*,0019-*,0020-*,0021-*`, `docs/decisions/index.md` | — |
| .2.1 | `…/synthesis/registry-extraction-inventory.md`, `tests/registry-characterization.test.mjs` | lib/service-manager, lib/parity, lib/mcp/server, lib/init/* |
| .3.2 | `tests/fixtures/upgrade/**`, `tests/functional/upgrade-*.test.mjs`, `…/home-xdg-isolation.*` | lib/init-unified, lib/setup |
| .4.1 | `…/synthesis/host-capability-matrix.md`, `tests/functional/host-capability-matrix.*` | lib/parity.mjs |
| .6.1 | `tests/functional/mcp-output-contract.*`, `schemas/mcp-tool-output.schema.json` | lib/mcp/server.mjs |
| .7.1 | `tests/functional/orchestration-truth-negative.*` | lib/orchestration/** |
| .8.1 | `tests/functional/doc-intake-approval.*` + fixtures | lib/init/doc-lanes, docs-routing |
| .9.1 | `tests/functional/learning-loop-e2e.*` | lib/oracle, lib/doctor |

**Off-limits to every audit bead:** the 20 pre-existing dirty-tree files (orchestration-readiness
work for `construct-b4za`/`construct-5wkl`) listed in [baseline.md](../baseline.md). Any need to
touch them requires an explicit Opus file-lock reassignment.

## Ready now (Wave-1 close / Wave-2 start, no gate blocking)

`.1.2` (ADR truth-up, low risk), and the gate-opener test beads `.2.1`, `.4.1`, `.7.1` (each writes
only new test/doc files — parallel-safe under the lock map above). Decision beads `.1.1`, `.3.1`,
`.5.1` await the owner.

## What is deliberately absent

No Wave-3 registry-extraction beads and no Wave-4 capability-implementation beads exist yet. They are
authored only after the corresponding Wave-2 characterization/contract tests are committed and green
— so the bead tree can never be mistaken for "implementation is in flight." This is the Phase-5/6
discipline: contracts before code.
