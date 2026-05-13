---
title: Slash command index
description: All Construct slash commands grouped by user intent. Pick the verb that matches what you want to do.
---

Construct ships ~30 slash commands across nine command families. Each command is a self-contained skill — Claude Code, OpenCode, and other hosts pick them up via the registry. This page groups them by *what you want to do*, not by alphabetical order, so you can find the right command from a real task.

## I want to understand something

Reach for the **understand** family when you need to gather context before touching code.

| Command | Use when |
|---|---|
| `/understand:this` | Explain the file or function you're looking at right now. Best for opening unfamiliar areas. |
| `/understand:why` | Trace *why* a piece of code exists — git history, related commits, comments, PR refs. |
| `/understand:docs` | Surface the relevant doc pages (concepts, cookbook, references) for the area you're in. |
| `/understand:research` | Multi-source research with citations. For "what's the SOTA on X?" or "how do other projects solve Y?" |

## I want to plan something

The **plan** family produces structured plans before you write any code.

| Command | Use when |
|---|---|
| `/plan:feature` | Full feature plan — requirements, design, file paths, verification. Right default for a build task. |
| `/plan:requirements` | Pull out user-stated requirements + implied constraints. Use before /plan:feature when scope is fuzzy. |
| `/plan:decide` | Decision record — compare two or more approaches, recommend one, capture the why. |
| `/plan:api` | API surface design — request/response shapes, error cases, versioning. |
| `/plan:challenge` | Stress-test a plan or design — "what breaks under load? what's the failure mode?" |

## I want to design UX or flows

The **design** family is for visual + interaction design work.

| Command | Use when |
|---|---|
| `/design:flow` | Walk through a user flow step-by-step — entry points, decisions, error paths. |
| `/design:ui` | UI design (layout, hierarchy, components). Pairs well with Figma or wireframes. |
| `/design:access` | Accessibility pass — WCAG checks, keyboard nav, contrast, screen reader. |

## I want to build something

The **build** family writes code. Use after planning.

| Command | Use when |
|---|---|
| `/build:feature` | Implement a feature end-to-end. Pairs with `/plan:feature`. |
| `/build:fix` | Land a bug fix. Includes regression test + verification. |

## I want to review work

The **review** family critiques code or designs.

| Command | Use when |
|---|---|
| `/review:code` | Code review on a diff or set of files. |
| `/review:quality` | Broader quality pass — naming, structure, comments, edge cases. |
| `/review:security` | Security-focused review — OWASP top 10, supply chain, auth, secrets. |

## I want to ship

The **ship** family handles the path from "code is done" to "users have it."

| Command | Use when |
|---|---|
| `/ship:ready` | Are we ready to ship? Run release gates, surface blockers. |
| `/ship:status` | Status of an in-flight release. |
| `/ship:release` | Cut a release — version bump, changelog, tag. |

## I want to measure outcomes

The **measure** family is for after-shipping observation.

| Command | Use when |
|---|---|
| `/measure:experiment` | Design an A/B or feature-flag experiment. |
| `/measure:results` | Read out experiment results — significance, recommendation. |
| `/measure:metrics` | Define metrics for a feature — what to track, where to surface. |

## I want to do focused work

The **work** family covers in-the-trenches operations.

| Command | Use when |
|---|---|
| `/work:drive` | Autonomous multi-step session — Construct picks up work, runs gates, lands changes. |
| `/work:parallel-review` | Spin up parallel review agents on a PR. |
| `/work:clean` | Cleanup pass — dead code, stale tests, doc drift. |
| `/work:optimize-prompts` | Improve a prompt against a labeled corpus. |

## I want to remember something

The **remember** family is the durable-context family.

| Command | Use when |
|---|---|
| `/remember:context` | Save the active session context (`.cx/context.md`). |
| `/remember:runbook` | Promote a one-off recipe into a permanent runbook. |
| `/remember:handoff` | Generate a handoff for the next session. |

## How commands compose

The intended workflow for a feature is roughly:

```
/understand:this  →  /plan:feature  →  /build:feature  →  /review:code  →  /ship:ready
```

For a bug it's shorter:

```
/understand:why  →  /build:fix  →  /review:code
```

Commands are skills under [`commands/`](https://github.com/geraldmaron/construct/tree/main/commands) — read the source if you want to know exactly what each one does. Each is a single Markdown file you can read, edit, and override per-project at `.claude/commands/<family>/<name>.md` if you need a project-specific variant.
