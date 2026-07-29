# Construct Strategy

> This is the strategy doc for the Construct project itself. The org-in-a-box, dogfooding on its own repo. Other projects that use Construct have their own strategy at `.construct/strategy.md` (see [`templates/docs/strategy.md`](./templates/docs/strategy.md)).

Last updated: 2026-07-21
Horizon: 6 to 12 months
Status: living document, revised when a bet changes

## A note before the strategy

I'm not a developer by trade. I started Construct to learn what shipping a real multi-agent operational tool would look like, in public, with no team. This doc is the honest version of where it's going and how I think we get there. It is not a roadmap. It is a list of bets I'm willing to defend, and the things I have decided not to do.

If a bet here looks wrong six months from now, I'd rather change the bet than rewrite history. Old versions stay in git.

## What was reviewed before writing this

Per [`rules/common/review-before-change.md`](./rules/common/review-before-change.md), I audited existing artifacts first. The closest existing source was [`docs/specs/prd/0001-construct-org-in-a-box.md`](./docs/specs/prd/0001-construct-org-in-a-box.md), which captures goals (G1 to G7), functional requirements, and acceptance criteria. This document does something different: it states the Northstar and the bets that get us there, then points to the PRD for the spec layer underneath. The PRD continues to be the source of truth for FRs, NFRs, and acceptance criteria.

## Northstar

**One person, or a small team, can run a real software organization from a single AI interface.** Construct is the operational layer. The product is "organizational intelligence that accumulates," not "another coding agent."

The Northstar is reached when the construct repo itself is run by Construct: PRDs, ADRs, RFCs, intake, releases, and health snapshots all flow through the system, the human stays in the loop only for novel decisions and approvals, and the same setup can be pointed at any other project with one command.

## Vision (3 to 5 years)

A person who is not a full-time engineer can operate a working software organization through Construct. The agents do the routine work, including planning, code, review, ops, intake, and docs. The human owns direction, novel decisions, and approval of high-risk actions. Construct is the operating system the rest plugs into. It is open source, runs locally by default, and deploys for teams when needed.

## North Star Metric

| Metric | Baseline (today) | Target (12 mo) | Owner |
|---|---|---|---|
| Share of construct repo's own artifacts authored through Construct | partial (some PRDs, some ADRs) | 100% of new PRDs, ADRs, RFCs, snapshots authored through Construct | Gerald |

The single test: can Construct run the construct repo without manual artifact authoring. If it cannot run its own org, it will not run anyone else's.

## Current state, honestly

What is there:

- One front door (`construct`) sits in front of Assignments routed to Worker Profiles. Workspace Presets (`rnd`, `operations`, `creative`, `research`) configure workspace-wide intake, document, tone, and Skill defaults — they do not name a fixed cast of workers.
- Intake loop classifies signals in `inbox/` deterministically, assigns owners, and routes through typed contract chains.
- Hard gates fire at write time, commit time, and CI. Bypasses are env-var only and audited.
- Solo mode runs locally with filesystem queue, local pgvector, JSONL traces. Team and enterprise modes exist as a scaffold.
- OpenCode is the first-class conversation surface. Construct supplies the front-door agent, MCP tools, workflows, and runtime plugin through generated host adapters.
- **Oracle** L0.5 meta-controller collects signals, auto-executes safe maintenance, queues consequential fixes (`construct oracle`).
- Doc auditability stamps land on every generated `.md` file.
- A docs site is published at `geraldmaron.github.io/construct/`.
- A deterministic flow engine (`lib/flows/`, ADR-0067) sequences work as typed state instead of prose an agent is trusted to follow — checkpoint/resume, effort budgets, and fan-out restricted to read-only work all land. See [Flow engine](./docs/guides/concepts/architecture.mdx#flow-engine).
- Heavy per-project state (traces, runs, vector index, docling venv) moved to a machine-scoped root at `~/.construct/projects/<key>/` (ADR-0066); the docling venv is now one shared machine-wide install instead of one per project (ADR-0068).
- Users can author their own Worker Profiles (`construct worker-profile create`) without editing `registry/`, merging builtin → user → project tiers at load time. The v1 `construct specialist` / `construct team` commands are tombstones that point at Worker Profiles.

What is partial:

- Embed daemon supervises but is not the dominant operating mode yet. Most use is point-at, not continuous monitoring.
- Self-host of the construct repo is incomplete. The system manages some of its own state, but not every PRD, RFC, or snapshot is authored through it.
- Team and enterprise modes have the scaffolding but few real users yet.
- Provider coverage is uneven. GitHub, Slack, Jira, Confluence, Salesforce exist; depth varies.
- Visual coverage in the docs site is thin (most concepts have no diagrams).
- The 29-persona roster consolidation is applied (ADR-0065): 12 core Worker Profiles ship in `registry/worker-profiles/` with prompts under `registry/worker-profiles/prompts/` (unprefixed ids: `architect`, `engineer`, `reviewer`, … — no `cx-` product namespace).
- The ADR-0067 flow engine (`lib/flows/`) stays live, driven directly by `construct flow resume`/`construct flow status` for hand-authored flow definitions. Its additive delegation port (`lib/orchestration/delegation-flow.mjs`) was deleted as dead code (`construct-b0nny.13`, workspace-control-plane M0) — the `orchestration_delegation_next` tool that would have called it was already removed under the tool-surface budget, leaving zero production consumers. Contract-chain dispatch runs on the original prompt-injected `dispatchPlan`/`dispatchSummary` path (`lib/orchestration-policy.mjs`) plus `routeRequest`'s Worker Profile dispatch output; no flow-step abstraction sequences it.
- Bun-compiled binary distribution builds and runs in isolation (all 4 platform targets, LanceDB + MCP SDK verified under Bun) but `bin/construct` itself doesn't yet run standalone under the compiled binary (a data-root resolution gap); npm remains the only working distribution channel.

What is missing:

- A reliable continuous monitoring loop that produces useful snapshots on a schedule, in the background, without prompting.
- A clean "first hour" experience for someone who has never seen the project.
- Real adoption signal. The project is open source and public, but I do not yet have meaningful usage data outside my own machine.

## 2026-07 architecture refit

A full challenge of the standing architecture, recorded in `plan.md` (epic `construct-rf26`), asked whether Construct should stay as it was and whether Python or the better parts of CrewAI should get blended in. Four decisions came out of it, each landing as its own ADR:

- **D1 — Node core stays; Python narrows to one sidecar; distribution moves to a compiled binary** ([ADR-0064](./docs/decisions/adr/0064-language-runtime-strategy.md)). Every peer product in this category (Claude Code, OpenCode, Codex CLI) ships a Bun- or Rust-compiled binary, not Python; `npm install -g` friction is the real first-hour gap, not the language. `uv` stays the formal, pinned contract for the docling sidecar.
- **D2 — Orchestrator-worker with a small core roster supersedes the 29-persona role-crew org** ([ADR-0065](./docs/decisions/adr/0065-orchestrator-worker-consolidation.md)). The evidence base (Anthropic's multi-agent research writeup, Cognition's "Don't Build Multi-Agents," the Berkeley MAST failure taxonomy) argues against fixed persona crews for most work; a deterministic flow engine replaces prompt-injected sequencing, and parallel fan-out is restricted to read-only, breadth-first work.
- **D3 — Config-layer project footprint** ([ADR-0066](./docs/decisions/adr/0066-config-layer-project-footprint.md)). A project keeps only committed text (`construct.config.json`, `.construct/context.md`, custom Worker Profiles); all heavy state (traces, vector index, runs, docling venv) moves to a machine-scoped root, shrinking a ~2.5–3 GB per-project footprint toward KB scale.
- **D4 — Standalone-project comment hygiene.** Code comments may not name another software project by way of comparison; decision documents keep their citations (the no-fabrication rule requires them there).

No backwards compatibility: these are clean breaks, not migration shims. Execution runs in six phases (decide → flow engine → roster → footprint → distribution → docs/verification); as of this writing 12 of the epic's 22 beads are closed. The flow engine, checkpoint/resume, machine-scoped state, shared docling venv, lazy vector index, and the core-roster consolidation (12 Worker Profiles shipped) are landed; the Bun-binary distribution is drafted/in-flight but not yet applied. See the current state notes above, [Flow engine](./docs/guides/concepts/architecture.mdx#flow-engine) in the architecture doc, and the ADR index for the full supersession record.

## Bets

Each bet is a choice. Each one carries a "why," because in 6 months I want to know what I believed when I made it.

### Bet 1: The product is the loop, not the agents

The differentiator is not "more Worker Profiles." It is the gated, contracted, evidence-required loop the profiles run inside. Other tools dispatch to agents. Construct dispatches, gates, verifies, and re-runs. The 2026-07 refit's flow engine (ADR-0067) is this bet's next increment: the loop's sequencing becomes a typed state machine instead of prose injected into an agent's context, without changing what the loop guarantees.

Why: agreement at every step is a smell. The loop is what keeps the system honest when nobody is watching.

### Bet 2: Local-first, with a real path to multi-user

Solo mode must work without any cloud service. The same primitives promote to Postgres, brokered MCP, and Docker workers in team mode without changing the agent loop. Mode is a backend choice, not a different product. The config-layer footprint decision (ADR-0066) is this bet applied to disk: a project stays local and lightweight (committed text only), while the heavy state a solo machine accumulates moves to a machine-scoped root instead of bloating every git checkout.

Why: lock-in kills open source projects. If everything works locally, the team mode is opt-in and the solo user is never abandoned.

### Bet 3: Presets and Profiles, not personas, are the unit of fit

The `construct` front door stays the same; the Workspace Preset changes workspace-wide defaults, and Worker Profiles are selected per Assignment. `rnd`, `operations`, `creative`, `research`, and custom presets let the same Construct point at very different kinds of work without forking the project.

Why: vertical agents are a feature, not a fork. The lifecycle in `docs/guides/concepts/workspace-preset-lifecycle.md` keeps presets from sprawling into low-quality JSON.

### Bet 4: Hard gates over soft hooks

Comment policy, doc verification, template policy, and contract postconditions fail the build. They are not advisory. Quality gates fire unconditionally — no `CONSTRUCT_SKIP_*` bypass env vars on blocking checks (`tests/hooks/no-skip-vars.test.mjs`). Notice-only signals auto-suppress in CI and non-TTY contexts.

Why: soft hooks decay. Hard gates either pass or they get fixed. The decay rate of a soft gate is the same as a TODO comment.

### Bet 5: Construct runs Construct, visibly

The construct repo is customer zero. If Construct cannot run its own intake, planning, docs, and reviews, it does not deserve to run anyone else's. The construct_guide.md, dashboard usage, snapshot history, and intake queue on this repo are public evidence.

Why: dogfood is the only honest demo. A tool that does not run its own project is selling.

### Bet 6: Orchestrator-worker over a fixed role-crew org

A small orchestrator plus a thin core roster of Worker Profiles, with skills (`skills/**`) as the actual unit of specialization, replaces a large fixed cast of 29 named personas. Customizability goes up, not down: fewer built-ins, but users author their own Worker Profiles declaratively (`construct worker-profile create`) instead of forking the org. This is ADR-0065's bet, and it is deliberately one-way — the no-backwards-compat mandate governing the 2026-07 refit meant retired specialist prompts were deleted, not archived behind a flag; the applied roster is the 12 that ship today in `registry/worker-profiles/`.

Why: the evidence (Anthropic's own multi-agent research, Cognition's "Don't Build Multi-Agents," the Berkeley MAST taxonomy) says role-play crews earn their cost only for read-only, parallelizable, breadth-first work — not most of what Construct's Worker Profiles do. Keeping 29 fixed personas past the point the evidence stopped supporting them would be inertia, not a bet.

## Non-bets (the things I am explicitly not doing)

- **Not building a coding IDE.** The agent harness (Claude Code, Codex, Cursor, Copilot) owns the IDE surface. Construct sits behind it.
- **Not building a model.** No fine-tuning, no custom training. Anthropic, OpenAI, OpenRouter, Ollama do that.
- **Not replacing trackers, chat, docs.** Construct reads from and writes to Jira, Linear, Slack, Confluence, Notion, GitHub. It does not replace them.
- **Not a multi-cloud abstraction.** Terraform handles infra. Construct's Dockerfile runs anywhere containers run. That is the abstraction.
- **Not chasing parity with closed-source agent platforms.** If a closed tool ships a feature, Construct adds it only when it serves the loop. Parity for parity's sake is wasted work.
- **Not adding versioned URL paths to the docs site.** No `v2/`, no `b2/`, no marketing version forks. The doc site is one site at `geraldmaron.github.io/construct/`, versioned through CHANGELOG and release notes.

## Time horizon: the next 6 to 12 months

What must be true at month 12, in order of priority:

1. **The construct repo is run through Construct.** Every new PRD, ADR, RFC, and release artifact is authored through the system. Health snapshots run on a schedule. Intake handles incoming signals without manual triage.
2. **The first-hour experience is reliable.** A new user can run `npm install -g`, `construct install`, `construct init`, and have a working session in the editor without surprises.
3. **The docs site is dense with visuals.** Every concept doc and every cookbook recipe has at least one diagram. Concepts have a flow; recipes have an outcome diagram.
4. **One non-rnd profile has a serious customer.** Either operations, creative, or research, used in a real workflow that is not my own.
5. **Team mode is usable by a real second user.** Not a hypothetical multi-tenant deployment. A second human, on a different machine, using the same Postgres-backed memory and shared queue.

## How we get there

Not a Gantt chart. Phases with an exit condition each.

### Phase 1. Self-host (now to month 3)

Exit condition: the construct repo's intake, PRD authoring, ADR authoring, and snapshot generation all run through Construct. No more hand-rolled artifacts in this repo.

Work: harden the embed daemon for unattended operation, wire the dashboard approval queue to live intake, finish the artifact authoring path for PRDs and ADRs through Construct.

### Phase 2. First-hour experience (months 2 to 5)

Exit condition: a person who has not seen Construct can install, init, and run a first useful task in under fifteen minutes with no manual debugging.

Work: tighten `construct doctor`, finish the install wizard for missing dependencies, add the visuals pass to the docs site, write a real onboarding cookbook recipe.

### Phase 3. Profile depth (months 4 to 8)

Exit condition: one non-rnd profile is used by a real user for a real task. Evidence shows up in `.construct/observations/` and in the intake queue.

Work: instrument profile usage, finish the profile lifecycle gates, recruit a single user outside my own setup.

### Phase 4. Team mode (months 6 to 12)

Exit condition: a second human uses Construct on a different machine against the same shared Postgres and shared queue, with separate auth, for at least a week.

Work: harden the multi-tenant scaffold, exercise RBAC, validate the MCP broker under contention, audit the secrets path end to end.

## Risks and what would kill the strategy

- **Solo bandwidth.** I am one person. If the loop gets too complex to maintain, the bets above are not defensible. Mitigation: hard gates against bloat, the comment policy, the "extend or supersede" rule.
- **Closed-source platforms absorb the loop.** If the agent harness vendors ship gates, contracts, and intake natively, Construct's differentiation narrows. Mitigation: stay open source, stay local-first, make the loop visible.
- **Provider drift.** External APIs change. Each broken provider is a maintenance cost. Mitigation: capability matrix + typed errors + degraded-mode fallbacks. A broken provider should not break the loop.
- **Strategy drift.** Building the wrong thing because someone asked for it. Mitigation: this doc. Bets and non-bets are explicit so requests can be evaluated against them.

## Open bets (decisions not yet made)

| # | Question | Pending until |
|---|---|---|
| OB-1 | Should the embed daemon become the default operating mode, with point-at as a fallback? | Phase 1 self-host evidence |
| OB-2 | Should team mode require a paid tier for the multi-tenant broker, or stay fully open source? | Phase 4 entry |
| OB-3 | Do we ship a hosted Construct, or stay self-host only? | After Phase 4 |
| OB-4 | What is the minimum capability set a provider must expose to be listed in the registry? | Provider drift evidence accumulates |

## Related artifacts

- [`docs/specs/prd/0001-construct-org-in-a-box.md`](./docs/specs/prd/0001-construct-org-in-a-box.md). The spec layer underneath this strategy.
- [`docs/guides/concepts/architecture.mdx`](./docs/guides/concepts/architecture.mdx). Canonical architecture.
- [`docs/guides/concepts/workspace-preset-lifecycle.md`](./docs/guides/concepts/workspace-preset-lifecycle.md). How Workspace Presets are built.
- [`templates/docs/strategy.md`](./templates/docs/strategy.md). The template projects use for their own strategies.
- [`rules/common/review-before-change.md`](./rules/common/review-before-change.md). The audit that ran before this doc was written.
- [`plan.md`](./plan.md). The 2026-07 architecture refit's decision record (D1–D4) and ADR challenge register.
- [`docs/guides/concepts/flow-authoring.md`](./docs/guides/concepts/flow-authoring.md). How to define a flow for the deterministic flow engine (ADR-0067).
