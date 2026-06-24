---
intake: none
intake_rationale: foundational artifact authored before intake traceability was wired; intake-independent by construction.
last_verified_at: 2026-06-01
verified_by: cx-docs-keeper · PR-D baseline stamp
---

# ADR 0001: Zero npm dependencies in core

**Date:** 2026-04-23  
**Status:** Accepted  
**Deciders:** Construct·Engineer

---

## Context

Construct is a CLI tool installed directly on developer machines via `npm install -g`. The core runtime (`lib/`, `bin/`) must work in locked-down enterprise environments, air-gapped setups, and minimal Node.js installs. Every npm dependency added to core:

1. Expands the supply chain attack surface for all installers
2. Adds a version-pinning and audit burden to every release
3. Risks install failures in constrained environments due to optional native binaries, network restrictions, or incompatible engines

The declared exceptions (`@modelcontextprotocol/sdk`, `@lancedb/lancedb`, `apache-arrow`) were accepted because they provide protocol-level contracts or essential vector performance with no viable built-in alternative.

## Decision

**Core zone (`lib/`, `bin/`) uses Node.js built-ins only**, plus the declared exceptions. All other functionality is implemented in-tree.

Implementations affected by this decision: BM25 text search, cosine similarity, UUIDv7 generation, session management, observation/entity stores. See `docs/in-tree-implementations.md` for details.

## Consequences

### Positive
- Zero supply chain risk in core
- Installs reliably in constrained environments
- No engine-compatibility surprises
- Forces implementations to remain simple (scope-limited by LOC burden)

### Negative
- Team owns maintenance of hand-rolled implementations indefinitely
- Edge cases in in-tree implementations must be fixed in-house
- Onboarding cost: contributors must read in-tree code rather than pointing at upstream docs

### Mitigation
- `docs/in-tree-implementations.md` tracks LOC, coverage, and known limitations for every hand-rolled component
- Promotion trigger: 3+ defects in 6 months on any component → library replacement ADR required
- Services zone (`services/`) is exempt: deployed services may use npm packages with ADR justification

## Exempt zones (amended 2026-06-18, ADR-0041)

The core restriction applies to `lib/` and `bin/`. Two zones are exempt because
they are buildable surfaces, not the installed runtime spine:

- **`services/`** — deployed services (original exemption).
- **`apps/`** — buildable front-end surfaces that compile to an artifact the
  core loads or serves, never imported into the zero-dep core. `apps/dashboard/`
  (Next.js/React) was the first; `apps/chat/` (Ink TUI + the owned agent-loop
  engine, ADR-0041) is the second.

Dependencies for `apps/` surfaces ship as `optionalDependencies`, not
`dependencies`, so the core `npm install -g` stays lean for locked-down and
air-gapped installs. The core detects missing optional extras at runtime and
prints an install hint rather than failing the install. The bridge between an
`apps/` surface and the core is a built-in-only contract module in `lib/`
(for chat, the normalized event union in `lib/chat/harness/driver.mjs`).

### Chat surface dependencies (ADR-0041) — exception-path answers

1. *What protocol/performance need does each provide that has no viable built-in
   alternative?* `ai` + `@ai-sdk/*` provide a provider-agnostic agent loop
   (tool-call -> execute -> re-call), streaming, and per-step usage that would
   otherwise be hand-rolled per provider; `ink` + `react` provide a maintained,
   resize-aware multi-pane terminal layout (Yoga flexbox) that the peer agents
   Construct sits beside already standardize on; `zod` provides the tool-input
   schema validation the loop engine requires.
2. *Is there a built-in alternative?* For the linear, accessible path: yes — the
   zero-dep `lib/chat/tui/render.mjs` renderer remains and requires none of
   these. The rich path is opt-in and degrades to the built-in path.
3. *What is the maintenance/supply-chain cost and how is it contained?* Contained
   to `apps/chat/` and to `optionalDependencies`; the zero-dep core and every
   non-chat surface are unaffected, and the dependencies are absent from
   locked-down installs that never run the rich TUI.

## Exception path

To add a new core dependency, write a new ADR in this directory answering the three questions in `docs/dependencies.md`. Do not add the dep without a merged ADR.
