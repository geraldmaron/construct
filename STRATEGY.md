# Construct Strategy

> This is the strategy doc for the Construct project itself. The org-in-a-box, dogfooding on its own repo. Other projects that use Construct have their own strategy at `.cx/strategy.md` (see [`templates/docs/strategy.md`](./templates/docs/strategy.md)).

Last updated: 2026-05-26
Horizon: 6 to 12 months
Status: living document, revised when a bet changes

## A note before the strategy

I'm not a developer by trade. I started Construct to learn what shipping a real multi-agent operational tool would look like, in public, with no team. This doc is the honest version of where it's going and how I think we get there. It is not a roadmap. It is a list of bets I'm willing to defend, and the things I have decided not to do.

If a bet here looks wrong six months from now, I'd rather change the bet than rewrite history. Old versions stay in git.

## What was reviewed before writing this

Per [`rules/common/review-before-change.md`](./rules/common/review-before-change.md), I audited existing artifacts first. The closest existing source was [`docs/prd/0001-construct-org-in-a-box.md`](./docs/prd/0001-construct-org-in-a-box.md), which captures goals (G1 to G7), functional requirements, and acceptance criteria. This document does something different: it states the Northstar and the bets that get us there, then points to the PRD for the spec layer underneath. The PRD continues to be the source of truth for FRs, NFRs, and acceptance criteria.

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

- One persona (`construct`) sits in front of a specialist team shaped by an org profile. The default `rnd` profile is wired, plus `operations`, `creative`, `research`.
- Intake loop classifies signals in `.cx/inbox/` deterministically, assigns owners, and routes through typed contract chains.
- Hard gates fire at write time, commit time, and CI. Bypasses are env-var only and audited.
- Solo mode runs locally with filesystem queue, local pgvector, JSONL traces. Team and enterprise modes exist as a scaffold.
- Dashboard is shipped: chat, approvals, knowledge panel, providers, models, infra tab.
- Doc auditability stamps land on every generated `.md` file.
- A docs site is published at `geraldmaron.github.io/construct/`.

What is partial:

- Embed daemon supervises but is not the dominant operating mode yet. Most use is point-at, not continuous monitoring.
- Self-host of the construct repo is incomplete. The system manages some of its own state, but not every PRD, RFC, or snapshot is authored through it.
- Team and enterprise modes have the scaffolding but few real users yet.
- Provider coverage is uneven. GitHub, Slack, Jira, Confluence, Salesforce exist; depth varies.
- Visual coverage in the docs site is thin (most concepts have no diagrams).

What is missing:

- A reliable continuous monitoring loop that produces useful snapshots on a schedule, in the background, without prompting.
- A clean "first hour" experience for someone who has never seen the project.
- Real adoption signal. The project is open source and public, but I do not yet have meaningful usage data outside my own machine.

## Bets

Each bet is a choice. Each one carries a "why," because in 6 months I want to know what I believed when I made it.

### Bet 1: The product is the loop, not the agents

The differentiator is not "more specialists." It is the gated, contracted, evidence-required loop the specialists run inside. Other tools dispatch to agents. Construct dispatches, gates, verifies, and re-runs.

Why: agreement at every step is a smell. The loop is what keeps the system honest when nobody is watching.

### Bet 2: Local-first, with a real path to multi-user

Solo mode must work without any cloud service. The same primitives promote to Postgres, brokered MCP, and Docker workers in team mode without changing the agent loop. Mode is a backend choice, not a different product.

Why: lock-in kills open source projects. If everything works locally, the team mode is opt-in and the solo user is never abandoned.

### Bet 3: Profiles, not personas, are the unit of fit

The persona stays the same; the org profile changes who is behind it. `rnd`, `operations`, `creative`, `research`, and custom profiles let the same Construct point at very different kinds of work without forking the project.

Why: vertical agents are a feature, not a fork. The lifecycle in `docs/concepts/profile-lifecycle.md` keeps profiles from sprawling into low-quality JSON.

### Bet 4: Hard gates over soft hooks

Comment policy, doc verification, template policy, and contract postconditions fail the build. They are not advisory. Bypasses require explicit env vars and leave an audit trail.

Why: soft hooks decay. Hard gates either pass or they get fixed. The decay rate of a soft gate is the same as a TODO comment.

### Bet 5: Construct runs Construct, visibly

The construct repo is customer zero. If Construct cannot run its own intake, planning, docs, and reviews, it does not deserve to run anyone else's. The construct_guide.md, dashboard usage, snapshot history, and intake queue on this repo are public evidence.

Why: dogfood is the only honest demo. A tool that does not run its own project is selling.

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

Work: harden the embed daemon for unattended operation, wire the dashboard approval queue to live intake, finish the artifact authoring path for PRDs and ADRs through the persona.

### Phase 2. First-hour experience (months 2 to 5)

Exit condition: a person who has not seen Construct can install, init, and run a first useful task in under fifteen minutes with no manual debugging.

Work: tighten `construct doctor`, finish the install wizard for missing dependencies, add the visuals pass to the docs site, write a real onboarding cookbook recipe.

### Phase 3. Profile depth (months 4 to 8)

Exit condition: one non-rnd profile is used by a real user for a real task. Evidence shows up in `.cx/observations/` and in the intake queue.

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

- [`docs/prd/0001-construct-org-in-a-box.md`](./docs/prd/0001-construct-org-in-a-box.md). The spec layer underneath this strategy.
- [`docs/concepts/architecture.md`](./docs/concepts/architecture.md). Canonical architecture.
- [`docs/concepts/profile-lifecycle.md`](./docs/concepts/profile-lifecycle.md). How profiles are built.
- [`templates/docs/strategy.md`](./templates/docs/strategy.md). The template projects use for their own strategies.
- [`rules/common/review-before-change.md`](./rules/common/review-before-change.md). The audit that ran before this doc was written.
