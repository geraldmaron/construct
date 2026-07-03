<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0062: Persona reasoning framework format — LMCP-F6

- **Date**: 2026-07-03
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner), Construct maintainers (cx-architect)
- **Relates to**: ADR-0047 (specialist vs flavor model), ADR-0054 (workflow manifest schema), ADR-0055 (pack schema), ADR-0061 (embed capability — `framework` field)
- **Tracking**: LMCP-F6-DEC. Blocks LMCP-F7 (author frameworks for PM/ops/engineer/qa/architect), LMCP-F8 (wire into workflow-invoke plan assembly + differentiation test).

## Problem

A specialist today carries **prompt seasoning**, not a reasoning procedure. From `specialists/prompts/*.md` frontmatter, each specialist has `perspective.{bias, tension, openingQuestion, failureMode}` plus a prose body ("what you're suspicious of", a role-skill pointer). That makes a specialist *sound* like its persona but does not make it *walk* the persona's reasoning: a `cx-product-manager` does not demonstrably work through user value → tradeoffs → prioritization; it has a PM-flavored prompt and a single `openingQuestion`.

The user requirement is "specialists actually **think** like the persona." Two consequences of the gap:

- The reasoning is not **demonstrable** — nothing in the output attributes a conclusion to a persona-specific reasoning move, so you cannot prove a PM framing differs from an engineer framing *because of* how each reasons (only because the prose differs).
- The reasoning is not **testable** — F8's differentiation test needs a framework-attributable signal, and F5's embed block (ADR-0061) already reserves a `framework` field with nothing to point it at.

## Decision

Define a **persona reasoning framework** as a first-class, standalone, structured artifact — distinct from both the specialist prompt (seasoning) and the role skill (domain knowledge). A framework is an **ordered list of named reasoning moves**, each declaring what it asks, what labeled output it must emit, and what that output must cite.

### 1. Artifact format and home

A framework is a Markdown file with YAML frontmatter — the same convention as `specialists/prompts/*.md` — resolved through the **pack** system (E1 / ADR-0055), living next to a pack's prompts as `frameworks/<framework-id>.md`. This makes frameworks obey the same three-tier precedence as every other pack asset (ADR-0061 config home): the core pack ships the default frameworks, and a project override (`.cx` pack tier) wins for the same `id`. Frameworks are *not* placed under `skills/` — pack resolution, not sync-time inlining, is what gives the project-override semantics F7 requires. Frontmatter:

```yaml
---
id: cx-pm-value-tradeoff
version: 1
appliesToRole: product-manager          # the role this framework equips
summary: >-
  Walks a product decision from user value through tradeoffs to a
  prioritization call.
steps:
  - id: user-value
    move: Name the user and the job                 # the reasoning move
    question: Whose problem is this and what job are they hiring it for?
    emits: value-statement                          # labeled output token
    cites: source                                   # what the output must reference
  - id: tradeoffs
    move: Surface the tradeoff space
    question: What does choosing this cost, and who bears it?
    emits: tradeoff-table
    cites: source
  - id: prioritization
    move: Make the call and say what it defers
    question: Given the tradeoffs, what ships now and what is explicitly deferred?
    emits: prioritization-call
    cites: prior-step
---

<prose body: how to run these moves, worked cues, what good/bad output looks like>
```

Each `step` is a reasoning **move**, not a template slot:
- **`move`** — the named cognitive step (human-readable, appears in output attribution).
- **`question`** — what the specialist asks itself at this step.
- **`emits`** — a **labeled output token** the step must produce. The ordered set of `emits` tokens is the framework's *fingerprint* — it is what makes the reasoning framework-attributable (§3).
- **`cites`** — `source` (an ingested observation / provider item / file) or `prior-step` (an earlier `emits` token). This binds every framework step to the no-fabrication contract: a move's output must reference something re-verifiable, never invented.

### 2. Binding: specialist ↔ framework ↔ embed

- The specialist prompt frontmatter gains one field: **`framework: <framework-id>`** (optional; absent means seasoning-only, the current behavior — backward compatible).
- The embed capability's `framework` field (ADR-0061) references the same `<framework-id>`.
- One framework may equip many specialists of its `appliesToRole`; a specialist references exactly one framework. Frameworks and role skills stay **separate concerns**: the role skill (`skills/roles/<role>.md`) is domain knowledge and anti-patterns; the framework is the ordered procedure. A framework body *may* point at its role skill, but does not inline it.

### 3. How it becomes demonstrable and testable (F8 contract)

- **Plan assembly (F7/F8).** `workflow-invoke` plan assembly injects the resolved framework's ordered `steps` into the plan as a reasoning scaffold, and the plan's output contract requires **one labeled output per `emits` token, in order**. The host runtime that performs the reasoning (ADR-0061) therefore returns output segmented by move.
- **Framework-attributable differentiation (F8 test).** Because each framework declares a distinct ordered `emits` fingerprint, two specialists running over the *same* input produce outputs whose *structure* differs by framework, not merely by prose — a `cx-pm-value-tradeoff` output carries `value-statement → tradeoff-table → prioritization-call`; a `cx-engineer-*` framework carries a different sequence. F8's differentiation test asserts the two outputs (a) carry different `emits` fingerprints and (b) that the differing framing is attributable to specific moves. This is the machine-checkable form of "thinks like the persona."
- **No-fabrication enforcement.** Every `emits` output must satisfy its `cites` requirement; a move that emits an unsourced claim fails the output contract, consistent with `rules/common/no-fabrication.md` and the per-specialist anti-fabrication contract already in the prompts.

### 4. Validation

A framework file validates at load (F7 lands the validator): required frontmatter (`id`, `version`, `appliesToRole`, non-empty `steps`); each step has `id`/`move`/`question`/`emits`/`cites`; `emits` tokens unique within a framework; `cites` ∈ {`source`, `prior-step`}; `appliesToRole` is a known role. Invalid frameworks fail closed with the file path and offending field — no silent skip.

## Alternatives considered

- **Keep prose seasoning only** (status quo). Rejected: not demonstrable, not testable, leaves ADR-0061's `framework` field pointing at nothing.
- **Embed the steps directly in specialist frontmatter** (no standalone artifact). Rejected: prevents one framework equipping several specialists, and couples the reasoning procedure to a single persona; the embed block and the specialist would each need their own copy.
- **A code module per framework** (steps as executable functions). Rejected: reasoning moves are prompt-shaped, authored by the cx-* specialists as research artifacts (like profiles and prompts), and belong in the pack alongside prompts, not in `lib/`.
- **Free-form step list with no `emits`/`cites` tokens.** Rejected: without labeled outputs the reasoning is not attributable (F8 has no signal) and not bound to no-fabrication.

## Consequences

- A specialist can be made to *walk* its persona's reasoning via a named, ordered, sourced framework — the "think like the persona" requirement becomes concrete and checkable.
- ADR-0061's embed `framework` field, ADR-0061 dry-run's binding chain (`specialist → providers → filters → framework → authority`), and F8's differentiation test all resolve against one artifact format.
- Backward compatible: specialists without a `framework:` field keep today's seasoning-only behavior.
- LMCP-F7 (author frameworks for product-manager, operations/TPM, engineer, qa, architect + the validator) and LMCP-F8 (plan-assembly wiring + framework-attributable differentiation test) are unblocked on this format.
