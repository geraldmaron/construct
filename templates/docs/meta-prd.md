---
title: "{title}"
subtitle: "{one-line meta outcome}"
status: draft
owner: "{name}"
artifactType: meta-prd
date: {YYYY-MM-DD}
version: "0.1"
doc_id: META-PRD-{NNN}
tags: []
contributors: []
approvers: []
---

<!--
Product operating system itself: agent workflow, document standard, evidence
pipeline, evaluation loop, template family, governance process, or internal
product intelligence capability.

A normal PRD defines what a product capability must do for users. A Meta PRD
defines how the organization decides, documents, validates, and improves work.

Owning specialists: product-manager + operations.
Before drafting: get_skill("docs/artifact-authorship")
  + get_skill("perspectives/product-manager").

NATIVE SPINE:
  TL;DR → Background → Problem → Outcomes - Goals & Non-Goals → Principles
  → Inputs and evidence → Phases → Human approval gates
  → Failure modes and mitigations → Rollout → Open questions → References

HIERARCHY (mandatory — skeleton bullets fail review):
  Phase → Workflow req (MR-<phase>.<n>) and/or Doc+eval req (DR-<phase>.<n>)
  Requirement → Acceptance (*Acceptance* or AC-MR/DR-<phase>.<n>.<k>)

Each phase needs **Why?** (human purpose for operators/authors) plus **Goal**.
Inclusive framing: name who runs the practice and who is harmed if it fails.
Prefer unknown / [unverified] with owner + decision-by date over fabrication.
-->

## TL;DR

{3–5 sentences: which operating practice changes, who runs it, what becomes different about how the org decides/documents/evaluates once this ships, and what decision is sought.}

## Background

{Current state of the operating system: which workflow, template, eval loop, or governance process is in play today, and what actually happens when teams or agents use it. Cite real examples.}

| Evidence source | Type | What it shows | Link / id |
|---|---|---|---|
| {recent PRD / decision / trace / ticket} | qualitative / quantitative | {claim} | {path or URL + date} |
| {second independent source} | … | … | … |

If fewer than two sources exist, mark **research-required** before locking scope.

## Problem

{Failure mode in the current process. Who feels it, how often, what breaks downstream. Solutions stay out of this section.}

Examples of the right shape:
- "PRDs ship without rejected alternatives, so reviewers re-litigate decisions weeks later."
- "Postmortems are written by the on-call who shipped the bug, so action items are not independent."

## Outcomes - Goals & Non-Goals

**Goals** (operating-system outcomes; 3–5 max):

1. {Measurable or observable practice change}
2. {…}
3. {…}

**Non-goals / out of scope:**

| | Description |
|---|---|
| **In scope** | {templates, workflows, agents, gates, or evals touched} |
| **Out of scope** | {related operating systems deferred — name the reason} |
| **Adjacent (deferred)** | {natural follow-ups not in this Meta PRD} |

**Practitioner outcome** (one sentence): {What becomes different when someone opens the artifact or runs the workflow.}

## Timing & stakes

<!-- Org-system bets still need urgency without cloning the full customer PRD spine. -->

{Why this operating-system change cannot wait. Name revenue/ops/compliance stakes or mark unknown with owner.}

| Timing dimension | Present? | Estimate / window | Source |
|---|---|---|---|
| Revenue / adoption at risk | yes / no / unknown | {or unknown} | {URL+date / unknown — owner: {name} by {YYYY-MM-DD}} |
| Cost of delay | yes / no / unknown | {toil / incident / unknown} | {…} |
| Compliance / legal deadline | yes / no / unknown | {or unknown} | {recruit privacy/legal if yes} |
| Competitive / market window | yes / no / unknown | {or unknown} | {…} |

## Principles

Durable rules this operating system must preserve across phases. Each principle should be testable enough to guide tradeoffs when phases conflict.

1. {Principle — testable enough to resolve a conflict}
2. {…}

## Inputs and evidence

What evidence the system consumes, and minimum thresholds where useful.

| Input class | Examples | Minimum threshold | Owner |
|---|---|---|---|
| {customer notes / traces / tickets / prior decisions} | {…} | {e.g. two independent interviews before review} | {role} |

## Phases

<!--
Each phase holds goal, status, workflow requirements (MR), and document +
evaluation requirements (DR), with acceptance criteria inline or tabulated.
Status: not started | in progress | shipped | deferred.
-->

### Phase 1: {name}

- **Why?**: {human purpose — which operators/authors benefit and what failure mode this phase reduces}
- **Goal**: {what this phase delivers for the operating system}
- **Status**: not started
- **Requirements**: MR-1.1, DR-1.1, …
- **Exit**: {what must be true to call this phase shipped}

**Workflow**

- **MR-1.1**: {imperative statement of how the workflow must behave}
  - *Acceptance*: {how a reviewer or trace verifies this without asking the author}

**Document + evaluation**

- **DR-1.1**: {required section, evidence rule, citation rule, formatting constraint, or anti-pattern}
  - *Acceptance*: {rubric dimension, pass/fail check, or trace signal that proves it}

### Phase 2: {name}

- **Why?**: {human purpose for this phase}
- **Goal**: {…}
- **Status**: not started
- **Requirements**: MR-2.1, DR-2.1, …
- **Exit**: {…}

**Workflow**

- **MR-2.1**: {…}
  - *Acceptance*: {…}

**Document + evaluation**

- **DR-2.1**: {…}
  - *Acceptance*: {…}

### Phase 3: {name}

- **Why?**: {human purpose for this phase}
- **Goal**: {…}
- **Status**: not started
- **Requirements**: MR-3.1, DR-3.1, …
- **Exit**: {…}

**Workflow**

- **MR-3.1**: {…}
  - *Acceptance*: {…}

**Document + evaluation**

- **DR-3.1**: {…}
  - *Acceptance*: {…}

## Human approval gates

Where a person must review, approve, reject, or supply missing context before the system writes externally or treats a document as approved.

| Gate | Reviewer role | Required evidence | Timeout / escalation |
|---|---|---|---|
| {gate name} | {role} | {what must be present} | {policy if no response} |

## Failure modes and mitigations

### Delivery and process risks

| Failure mode | Likelihood | Impact | Mitigation |
|---|---|---|---|
| {followed too literally / over-automated / weak evidence} | low / med / high | low / med / high | {guardrail or escape hatch} |

### Legal, privacy, and compliance triggers

Complete when the operating system touches people data, external writes, or regulated content.

| Trigger | Present? | Specialist | Gate before ship |
|---|---|---|---|
| PII / accounts in ingested evidence | yes / no / unknown | security.privacy | retention/deletion path |
| External publish / customer-visible write | yes / no / unknown | security.legal-compliance | human approval gate named |
| AI model training on workspace content | yes / no / unknown | security.ai + privacy | disclosure / opt-out |

### Adversarial challenge (FMEA)

| Failure mode | Effect | Cause | S×O×D (1–10) | Mitigation or accept-with-rationale |
|---|---|---|---|---|
| {highest-cost wrongness of this operating model} | {who hurts} | {why} | {product} | {action} |

## Rollout

{How this operating model becomes the default. Migration steps, owners, training, deprecation date for the older template or workflow. Name what happens to in-flight work (grandfathered or migrated).}

| Step | Owner | By when | Success signal |
|---|---|---|---|
| {migration / training / deprecation} | {name} | {YYYY-MM-DD} | {observable} |

## Open questions

| Question | Owner | Decision needed by |
|---|---|---|
| {unknown that could change the operating model} | {name} | {YYYY-MM-DD} |

## References

- {linked examples, prior PRDs, Meta PRDs, research, tickets, traces, decisions, bead ids}
