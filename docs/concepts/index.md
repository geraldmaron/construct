---
title: Concepts
description: The mental model behind Construct — read once, refer back.
---

Concept pages explain *why* Construct works the way it does. They're not how-to guides; for those, see [Cookbook](/cookbook).

## The core model

- **One persona, many specialists.** You address `@construct`. It dispatches work to a team of 28 specialists (architect, engineer, reviewer, QA, security, designer, …) under typed contracts. [Read more →](/concepts/agents-and-personas)

- **Hard gates, not vibes.** Every code mutation runs through enforcement: no secrets, tests green, docs current, comments lint-clean, CI passes. Gates live in three places (write-time, commit-time, CI safety-net). Quality gates fire unconditionally; notice-only signals auto-suppress in CI and non-TTY contexts. [Read more →](/concepts/gates-and-enforcement)

- **Owned-loop chat.** `construct chat` runs Construct's own agent loop with a transparency-first terminal or browser surface — token/cost ledger, tool timeline, routing detail. Dashboard `/chat` mirrors the same loop. [Read more →](/cookbook/construct-chat)

- **Oracle health review.** The Oracle meta-controller collects project signals, synthesizes gaps, auto-executes safe maintenance, and queues consequential fixes for approval. [Read more →](/concepts/architecture)

- **Durable state.** Sessions survive boundary changes. Decisions get written to `.cx/context.md`, work-in-progress to beads, handoffs to `.cx/handoffs/`. The next session resumes from the right place. [Read more →](/concepts/beads-and-state)

- **R&D intake and triage.** Files dropped into `.cx/inbox/` are classified into the R&D loop (bug / experiment / incident / requirement / …), assigned a primary owner persona, and given a recommended handoff chain — all by a deterministic keyword classifier in the daemon, no LLM call. The `construct intake` CLI inspects and drives the queue. [Read more →](/concepts/intake-and-triage)

- **Deployable.** Construct runs locally as the default and can be deployed for team or enterprise usage with shared memory, telemetry, queues, and policy. Three modes — solo, team, enterprise — and the rest of the system reads from there. [Read more →](/concepts/deployment-model)

## How everything fits together

[Architecture](/concepts/architecture) is the deep dive — diagrams, contracts, the request lifecycle, the plugin contracts. Read it once when you want to understand the bones.

- **Integrity and trust.** Every artifact Construct produces traces to source. Four layers enforce this: a canonical no-fabrication rule, artifact-prose lint that catches unsupported claims in real time, intake traceability that stamps every artifact's origin packet into its frontmatter, and machine-checked contract postconditions between specialist handoffs. [Read more →](/concepts/integrity-and-trust)

## Reference-shaped concepts

A few topics earn dedicated concept pages because they affect many subsystems:

- [Prompt surfaces](/concepts/prompt-surfaces) — what the persona vs. specialists see at each stage.
- [Knowledge layout](/concepts/knowledge-layout) — how `.cx/`, beads, vector index, and SQL fit together.
- [Embedding boundary](/concepts/embedding-boundary) — what stays local vs. what crosses the network boundary.
