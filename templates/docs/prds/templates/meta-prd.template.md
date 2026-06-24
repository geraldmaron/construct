# Meta PRD: {title}

- **Date**: {YYYY-MM-DD}
- **Owner**: {name}
- **Status**: draft | in-review | approved | shipped | deprecated

<!--
Use this when the subject is the product operating system itself: an agent workflow,
document standard, evidence pipeline, evaluation loop, template family, governance
process, or internal product intelligence capability.

A normal PRD defines what a product capability must do for users. A Meta PRD defines
how the organization decides, documents, validates, and improves the product work.

Write with a balance of structured paragraphs, compact tables, and selective bullets.
Avoid a wall of bullets. Keep em dashes rare; prefer commas, periods, or parentheses.
-->

## Summary
<!--
One paragraph (3-5 sentences). What product practice or operating system is
being defined or changed, who runs it, and what becomes different about how
the org decides, documents, or evaluates work once this ships.
-->

## Background
<!--
The current state of the operating system: which workflow, template, eval
loop, or governance process is in play today, and what's actually happening
when teams or agents use it. Cite real examples: recent PRDs, prior decisions,
trace evidence, support tickets: not hypotheticals.
-->

## Problem
<!--
The failure mode in the current process. Name who feels it, how often, and
what breaks downstream. Keep solutions out of this section.

Examples of the right shape:
- "PRDs ship without rejected alternatives, so reviewers re-litigate decisions
  three weeks in. Happens on ~40% of PRDs in the last quarter."
- "Postmortems are written by the on-call who shipped the bug, so the action
  items reflect their proposals: not independent review."
-->

## Goals
<!--
What success looks like for the operating system. Three to five outcomes max.
Examples: "PRDs cite primary sources by default", "Postmortems get peer
review before publish", "ADR rejection rate drops from 60% to under 20%".
-->

## Outcome
<!--
What is concretely different about how work moves through the org once this
operating model is adopted. Written from the practitioner's perspective:
"When I open a PRD, I'm prompted to record rejected alternatives before
the doc enters review."
-->

## In scope and out of scope

| | Description |
|---|---|
| **In scope** | <which templates, workflows, agents, gates, or evals are touched> |
| **Out of scope** | <related operating systems explicitly deferred: name the reason> |
| **Adjacent (deferred)** | <natural follow-up changes not in this Meta PRD> |

## Principles
<!--
Durable rules this operating system must preserve across phases. Each
principle should be testable enough to guide tradeoffs when phases conflict.
-->

## Inputs and evidence
<!--
What evidence the system consumes: customer notes, interviews, traces, Jira
issues, PRDs, research, analytics, support tickets, prior decisions. State
minimum evidence thresholds where useful (e.g. "two independent customer
interviews before a PRD enters review").
-->

## Phases

<!--
Each phase below holds its own goal, status, workflow requirements (MR),
and document + evaluation requirements (DR), with acceptance criteria
inline next to each. Use `MR-<phase>.<n>` and `DR-<phase>.<n>` so
requirements can be referenced from reviews, traces, and evals.

MR = Workflow requirement: how the process or agent workflow must behave;
observable in generated artifacts, workflow state, or tool behavior.

DR = Document + evaluation requirement: how outputs are shaped, reviewed,
and scored; required sections, evidence rules, citation rules, formatting
constraints, anti-patterns, rubric dimensions, pass/fail checks.

Status values: not started | in progress | shipped | deferred.
-->

### Phase 1: <name>

- **Goal**: <what this phase delivers>
- **Status**: not started

**Workflow**

- **MR-1.1**: <imperative statement of how the workflow must behave>
  - *Acceptance*: <how a reviewer or trace verifies this without asking the author>
- **MR-1.2**: <...>
  - *Acceptance*: <...>

**Document + evaluation**

- **DR-1.1**: <required section, evidence rule, citation rule, formatting constraint, or anti-pattern>
  - *Acceptance*: <rubric dimension, pass/fail check, or trace signal that proves it>

### Phase 2: <name>

- **Goal**: <what this phase delivers>
- **Status**: not started

**Workflow**

- **MR-2.1**: <...>
  - *Acceptance*: <...>
- **MR-2.2**: <...>
  - *Acceptance*: <...>

**Document + evaluation**

- **DR-2.1**: <...>
  - *Acceptance*: <...>

### Phase 3: <name>

- **Goal**: <what this phase delivers>
- **Status**: not started

**Workflow**

- **MR-3.1**: <...>
  - *Acceptance*: <...>

**Document + evaluation**

- **DR-3.1**: <...>
  - *Acceptance*: <...>

## Human approval gates
<!--
Where a person must review, approve, reject, or supply missing context before
the system writes externally or treats a document as approved. Name the gate,
the reviewer role, and the timeout policy if no reviewer responds.
-->

## Failure modes and mitigations

| Failure mode | Likelihood | Impact | Mitigation |
|---|---|---|---|
| <how this could go wrong if followed too literally, over-automated, or used with weak evidence> | low / med / high | low / med / high | <guardrail or escape hatch> |

## Rollout
<!--
How this operating model becomes the default. Migration steps, owners,
training, deprecation date for the older template or workflow. Name what
happens to in-flight work (grandfathered or migrated).
-->

## Open questions

| Question | Owner | Decision needed by |
|---|---|---|
| <unknown that could change the operating model> | <name> | <YYYY-MM-DD> |

## References
<!-- Linked examples, prior PRDs, Meta PRDs, research, tickets, traces, or decisions. -->
