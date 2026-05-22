---
title: Beads and durable state
description: How beads, .cx/, handoffs, and the vector index make sessions resumable. The substrate under "did the work survive?"
---

Sessions end. Editor windows close. Networks drop. Construct treats this as the default, not the exception — every meaningful piece of state is durable across boundary changes.

Four stores carry the load. Each has a clear job; nothing important lives in only one place.

## beads — durable work tracking

`bd` (beads) is an embedded SQL issue tracker. It runs as a Dolt server backed by `.beads/`. Construct uses it as the canonical source for work items: every plan task, every blocker, every closed-with-notes outcome lives in beads.

Why beads, not GitHub Issues / Jira / a markdown checklist:

- **Repo-resident.** Works offline; in solo mode the data is in your repo. In team/enterprise mode the same `bd` interface talks to a shared Dolt remote.
- **AI-friendly.** `bd list --json` and `bd show --json` give specialists structured data they can reason about without scraping HTML or hitting an API.
- **Audit trail.** Every state change is recorded with timestamps and actor.
- **Session-end gate.** The policy engine refuses to end a session if any beads issue is `in_progress` and not explicitly acknowledged.

Construct's relationship to beads is one-way authoritative: specialists write issues during a session; the runtime reads them at session-start to know what's mid-flight.

## .cx/ — resumable project context

`.cx/context.md` and `.cx/context.json` are the canonical "where this project is right now" record. They're written by the docs-keeper specialist whenever durable state changes — architectural decisions, active workstreams, open questions.

When you open a new session, Construct reads `.cx/context.md` first. The persona has all the architectural and decision context the previous session built up. You don't recap; you continue.

Other `.cx/` files:

- **`.cx/handoffs/{date}-{slug}.md`** — gitignored single-session reports. Each handoff captures what happened, what's left, where things are stuck. Read at session-start when relevant.
- **`.cx/edit-accumulator.json`** — running count of files edited per session. Used by the Stop hook to decide whether session-end gates fire.
- **`.cx/observations/`** — the local vector index for semantic retrieval over project history. Embedded automatically on a schedule when Postgres + pgvector aren't available.

## The vector index — semantic recall

Construct runs hybrid retrieval — BM25 + cosine — over your codebase + ingested docs + observations. The vector backend is one of:

1. **Postgres + pgvector** — preferred when available. `construct init` brings it up via Docker.
2. **Local JSON index** — fallback when Postgres isn't available. Lives in `.cx/observations/` or `~/.construct/vector/`. Smaller corpora, slower, no concurrency, but works offline.

Either way, the embedding model is configurable. `construct evals retrieval` measures recall against a fixture so changes to the model or chunker don't silently degrade quality.

## git — code state

The codebase itself is durable in git. Construct doesn't try to be a code-versioning tool — `git` is. Hard gates (no force-push to main, no `claude/*` push, required CI checks) protect the git substrate; everything else is built on top.

## .cx/intake/ and .cx/task-graphs/ — the R&D loop's durable layer

Two newer surfaces complete the durable substrate, both written by the daemon and read by the agent:

- **`.cx/intake/{pending,processed,skipped}/<id>.json`** — incoming signals after deterministic R&D triage. Each packet carries the triage block (intakeType, rdStage, primaryOwner, recommendedChain, recommendedAction, risk, confidence, rationale), a docs-lane suggestion, the top-K related artifacts, and an excerpt. `construct intake list / show / done / skip / reopen` drives the queue. In team / enterprise mode the same packets live in the `construct_intake_items` Postgres table; the CLI contract is identical.
- **`.cx/task-graphs/<graph-id>.json`** — per-signal plans of work. Generated from a triage packet with `construct graph from-intake <intake-id>`; one node per persona in the recommendedChain; depends_on edges chain the work; evidence records ride with each node so a node can't reach `done` without a verified result. See [intake and triage](/concepts/intake-and-triage) for the full taxonomy.

These two are distinct from `bd` issues. Beads is the project-wide task tracker. The intake queue is the inbox; task graphs are the per-signal execution plans. They eventually graduate to beads issues when work crosses session boundaries.

`.cx/traces/<YYYY-MM-DD>.jsonl` is the append-only audit log: every intake.received, task_graph.created, worker.started, evidence.recorded, and tool.called event lands there with a stable traceId / spanId, ready to be ingested into a telemetry backend or an OTel collector.

## What goes where

| State | Lives in | Survives | Authoritative? |
|---|---|---|---|
| Incoming signal | `.cx/inbox/<file>` (input), `.cx/intake/pending/<id>.json` (after triage) | session end + clone (intake/) | yes |
| Per-signal execution plan | `.cx/task-graphs/<id>.json` | session end + clone | yes |
| Evidence for a task graph node | nested inside `.cx/task-graphs/<id>.json` + linked via traceId | session end + clone | yes |
| Trace events | `.cx/traces/<YYYY-MM-DD>.jsonl` | session end (rotated) | append-only, audit-grade |
| Work item: "Implement X, blocked on Y" | beads (`.beads/`) | session end + clone | yes |
| Decision: "We chose Postgres over SQLite because…" | `.cx/context.md` (read), `docs/adr/` (formal) | session end + clone | yes |
| Mid-task scratch: "I'm halfway through. Tomorrow I'll do Z" | `.cx/handoffs/{date}.md` | session end (gitignored) | working note only |
| Semantic recall: "What did we decide about retrieval?" | Postgres pgvector or `.cx/observations/` | session end | derived, regenerable |
| Code itself | git | forever | yes |

## Failure modes Construct guards against

- **Cloud went down mid-session.** Postgres / remote telemetry export / the dashboard can all fail. Construct keeps working from beads + `.cx/` + git + the local vector index.
- **Session ended with work in progress.** The Stop hook refuses to end a session with open beads issues. You either close them, defer them, or explicitly acknowledge with `CONSTRUCT_STOP_OK_OPEN_BD=1`.
- **A specialist's reasoning got lost.** Observations are written as the chain runs; the next session can re-read them via semantic retrieval.
- **A decision drifted without anyone noticing.** ADRs in `docs/adr/` are append-only and reviewed; `.cx/context.md` mirrors active state and is part of the doc-coupling gate.

The substrate is intentionally boring. The interesting work is the orchestration on top of it; the substrate just has to be reliable enough that the orchestration can trust it.
