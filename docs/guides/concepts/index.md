---
title: Concepts
description: The mental model behind Construct — read once, refer back.
---

Concept pages explain *why* Construct works the way it does. They're not how-to guides; for those, see [Cookbook](/guides/cookbook).

## The core model

- **One front door, twelve Worker Profiles.** You address `@construct`. It decomposes work into Assignments and selects Worker Profiles (architect, engineer, reviewer, QA, security, designer, …) under typed Capability contracts. [Read more →](/guides/reference/worker-profiles)

- **Hard gates, not vibes.** Every code mutation runs through enforcement: no secrets, tests green, docs current, comments lint-clean, CI passes. Gates live in three places (write-time, commit-time, CI safety-net). Quality gates fire unconditionally; notice-only signals auto-suppress in CI and non-TTY contexts. [Read more →](/guides/concepts/gates-and-enforcement)

- **OpenCode-first conversation.** OpenCode is the primary conversation surface. Construct supplies the front-door agent, MCP tools, skills, workflows, and runtime plugin through `construct sync`. [Read more →](/guides/start/connect-your-editor)

- **Oracle health review.** The Oracle meta-controller collects project signals, synthesizes gaps, auto-executes safe maintenance, and queues consequential fixes for approval. [Read more →](/guides/concepts/architecture)

- **Durable state.** Sessions survive boundary changes. Decisions get written to `.construct/context.md`, work-in-progress to beads, handoffs to `.construct/handoffs/`. The next session resumes from the right place. [Read more →](/guides/concepts/beads-and-state)

- **R&D intake and triage.** Files dropped into `inbox/` are classified into the active Workspace Preset's intake loop (bug / experiment / incident / requirement / …), assigned a primary owner Worker Profile, and given a recommended handoff chain — all by a deterministic keyword classifier in the daemon, no LLM call. The `construct intake` CLI inspects and drives the queue. [Read more →](/guides/concepts/intake-and-triage)

- **Deployable.** Construct runs locally as the default and can be deployed for team or enterprise usage with shared memory, telemetry, queues, and policy. Three modes — solo, team, enterprise — and the rest of the system reads from there. [Read more →](/guides/concepts/deployment-model)

## How everything fits together

[Architecture](/guides/concepts/architecture) is the deep dive — diagrams, contracts, the request lifecycle, the plugin contracts. Read it once when you want to understand the bones.

- **Integrity and trust.** Every artifact Construct produces traces to source. Four layers enforce this: a canonical no-fabrication rule, artifact-prose lint that catches unsupported claims in real time, intake traceability that stamps every artifact's origin packet into its frontmatter, and machine-checked Capability postconditions between Assignment handoffs. [Read more →](/guides/concepts/integrity-and-trust)

## Reference-shaped concepts

A few topics earn dedicated concept pages because they affect many subsystems:

- [Prompt surfaces](/guides/concepts/prompt-surfaces) — what the public Worker Profile vs. internal profiles see at each stage.
- [Knowledge layout](/guides/concepts/knowledge-layout) — how `.construct/`, beads, vector index, and SQL fit together.
- [Embedding boundary](/guides/concepts/embedding-boundary) — what stays local vs. what crosses the network boundary.
