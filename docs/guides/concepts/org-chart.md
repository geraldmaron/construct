# Worker Profile roster

> **Filename note:** `org-chart.md` is a historical path; this page is the Worker Profile roster, not an org chart.


> **Execution framing:** Construct is one governed interface. You give outcomes; Construct decomposes work into Assignments and selects Worker Profiles under typed Capability contracts. You talk to `@construct`; internal profiles route behind that front door.

The roster is **12 Worker Profiles**. There is no permanent org chart, team roster, or specialist tree in Construct 2.0 — Plans own Assignment relationships, and a Workspace Preset configures workspace-wide defaults without naming a fixed cast of workers.

The source of truth is `registry/worker-profiles/*.json`, not this page. Regenerate your mental model from `construct worker-profile list` / `construct list` if they diverge.

## The 12 Worker Profiles

Each `displayName` is the profile's perspective bias, verbatim from its registry entry.

| Worker Profile | Tier | Perspective |
|---|---|---|
| architect | reasoning | Makes trade-offs explicit before implementation locks them in — suspicious of clever solutions and unwritten interface contracts. |
| engineer | standard | Reads before writing — understanding the existing pattern matters more than having the better one. |
| debugger | reasoning | Traces to root cause before proposing a fix — the real bug is always one layer deeper than where it presents. |
| qa | standard | Asks whether the tests test what matters — coverage numbers are hypotheses about quality, not proof of it. |
| reviewer | reasoning | Finds bugs by looking at the conditions the author didn't test for — happy-path review is not review. |
| security | reasoning | Thinks like an attacker — sees the attack surface the developer didn't know existed. |
| product-manager | reasoning | Translates user reality into technical deliverables — skeptical of any requirement that can't be traced to observed user behavior. |
| designer | standard | Treats visual decisions as interaction decisions — a design that only exists in the happy state is incomplete. |
| researcher | standard | Never trusts recall alone — sources every claim with a primary reference and a date. |
| data-analyst | standard | Measures carefully because measurement shapes behavior — suspicious of metrics that can be hit without solving the problem. |
| operations | standard | The logistics mind who maps dependencies, sequences, and ownership — because hidden dependencies surface as blocked work. |
| orchestrator | standard | Sees the whole board — routes each request to the perspectives that will see what others miss. |

## What the consolidation absorbed

The 12 anchors absorbed retired roles as **Skill emphasis** and **perspective overlays** (`skills/perspectives/*.md`), not as separate public assistants — capability was folded in, not dropped. High-traffic examples:

- **engineer** loads AI-engineering, data-engineering, and platform-engineering Skills by task.
- **reviewer** absorbs pre-implementation challenge, eval scoring, and fleet-trace review perspectives.
- **operations** absorbs SRE, release-management, and docs-keeping emphasis.
- **researcher** absorbs UX-research and code-exploration Skills.
- **security** absorbs legal/compliance emphasis.
- **designer** absorbs accessibility emphasis.
- **product-manager** absorbs business-strategy emphasis; **architect** absorbs framing gates; **orchestrator** absorbs fleet-health routing.

Full reference with tier and purpose: [Worker Profiles](/guides/reference/worker-profiles).

Historical 29→12 mapping remains in [appendix-0065-roster-mapping.md](../../decisions/adr/appendix-0065-roster-mapping.md) as evidence only.
