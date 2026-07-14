# Construct Org Chart

> **Org-in-a-box framing:** Construct is your AI R&D organization. You are the founder/CEO: you give outcomes, the org figures out execution. You talk to `construct` (the orchestrator); it assembles the right specialists in the right sequence.

The roster is **12 specialists** organized into **8 squads** that roll up into **6 macro groups**. Groups own decision rights; squads own day-to-day collaboration (see [teams.md](teams.md)). This roster is the consolidated result of ADR-0065 (a prior 29-role roster folded down to 12); the full 29→12 mapping is recorded in [appendix-0065-roster-mapping.md](../../decisions/adr/appendix-0065-roster-mapping.md).

The source of truth is `specialists/org/specialists/*.json` (each specialist's `teamId`/`groupId`), not this page — regenerate your mental model from `construct team list` / `construct list` if they diverge.

## Reporting structure

```
Construct (orchestrator — classifies, sequences, dispatches)
│
├── product-group
│   ├── product-management-team → cx-product-manager
│   ├── design-team             → cx-designer
│   └── research-team           → cx-researcher
│
├── engineering-group
│   └── engineering-team        → cx-architect · cx-engineer · cx-debugger
│
├── quality-group
│   └── quality-team            → cx-qa · cx-reviewer
│
├── governance-group
│   └── governance-team         → cx-security
│
├── operations-group
│   └── operations-team         → cx-operations
│
└── strategy-group
    └── strategy-team           → cx-data-analyst · cx-orchestrator
```

## The 12 specialists

Each `displayName` is the specialist's own perspective bias, verbatim from its registry entry.

| Specialist | Squad (group) | Tier | Perspective |
|---|---|---|---|
| cx-architect | engineering-team (engineering-group) | reasoning | Makes trade-offs explicit before implementation locks them in — suspicious of clever solutions and unwritten interface contracts. |
| cx-engineer | engineering-team (engineering-group) | standard | Reads before writing — understanding the existing pattern matters more than having the better one. |
| cx-debugger | engineering-team (engineering-group) | reasoning | Traces to root cause before proposing a fix — the real bug is always one layer deeper than where it presents. |
| cx-qa | quality-team (quality-group) | standard | Asks whether the tests test what matters — coverage numbers are hypotheses about quality, not proof of it. |
| cx-reviewer | quality-team (quality-group) | reasoning | Finds bugs by looking at the conditions the author didn't test for — happy-path review is not review. |
| cx-security | governance-team (governance-group) | reasoning | Thinks like an attacker — sees the attack surface the developer didn't know existed. |
| cx-product-manager | product-management-team (product-group) | reasoning | Translates user reality into technical deliverables — skeptical of any requirement that can't be traced to observed user behavior. |
| cx-designer | design-team (product-group) | standard | Treats visual decisions as interaction decisions — a design that only exists in the happy state is incomplete. |
| cx-researcher | research-team (product-group) | standard | Never trusts recall alone — sources every claim with a primary reference and a date. |
| cx-data-analyst | strategy-team (strategy-group) | standard | Measures carefully because measurement shapes behavior — suspicious of metrics that can be hit without solving the problem. |
| cx-operations | operations-team (operations-group) | standard | The logistics mind who maps dependencies, sequences, and ownership — because hidden dependencies surface as blocked work. |
| cx-orchestrator | strategy-team (strategy-group) | standard | Sees the whole board — routes each request to the perspectives that will see what others miss. |

## What the consolidation absorbed

The 12 anchors absorbed the retired roles as **skill overlays** (`skills/roles/<role>.*`) and prompt sections, not as separate personas — capability was folded in, not dropped. The high-traffic examples:

- **cx-engineer** absorbs AI-engineering, data-engineering, and platform-engineering as skill bundles it loads by task.
- **cx-reviewer** absorbs the pre-implementation challenge (devil's-advocate), eval scoring (evaluator), and fleet-trace review (trace-reviewer).
- **cx-operations** absorbs SRE, release-management, and docs-keeping.
- **cx-researcher** absorbs UX-research and code-exploration.
- **cx-security** absorbs legal/compliance.
- **cx-designer** absorbs accessibility.
- **cx-product-manager** absorbs business-strategy; **cx-architect** absorbs the R&D-lead framing gate; **cx-orchestrator** absorbs oracle's fleet-health routing.

The mechanism that swaps a base specialist for a flavor overlay at dispatch time is documented in [teams.md](teams.md) (§ Specialists vs role flavors) and ADR-0047.
