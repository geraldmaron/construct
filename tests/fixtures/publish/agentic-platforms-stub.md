---
description: Thin PRD stub for publish release-gate negative tests and demo tapes; not production product docs.
artifactType: prd-platform
intake: none
intake_rationale: Negative fixture for publish pipeline guardrail tests; not production product docs.
last_verified_at: 2026-06-19
verified_by: construct · publish gate tests
status: draft
---

# PRD: Enterprise Agentic Platform

- **Date**: 2026-06-19
- **Owner**: product-manager
- **Status**: draft

## Summary

Platform teams need a single operational layer that routes work across specialist agents, grounds every artifact in verifiable evidence, and gates high-risk writes behind human approval. Construct already implements the core primitives (specialist registry, embedded procedure invoke, intake traceability, release gates, and publish-to-PDF distribution) per PRD-0001 (verified 2026-06-19). This PRD defines the **agentic platform** product surface: how enterprises adopt those primitives as a governed multi-agent system rather than a collection of disconnected assistant sessions.

## Problem

Teams running multiple AI coding agents report three recurring failures (synthesized from PRD-0001 user segments, verified 2026-06-19):

1. **Cold starts** — each session re-derives context; no durable specialist routing or evidence packet survives across tools.
2. **Unaudited artifacts** — PRDs and ADRs appear without intake provenance or release-gate review (`construct artifact validate`, verified in `registry/capabilities.json` workflow entries).
3. **Unbounded autonomy** — agents write to trackers, repos, or docs without an approval queue (FR-11 in PRD-0001).

The human remains the integrator. An agentic platform must make routing, evidence, and approval **first-class CLI and MCP contracts**, not prompt conventions.

## Goals

| ID | Goal | Construct anchor |
|---|---|---|
| G1 | Route requests to Worker Profile chains with provenance | `construct procedure invoke --procedure-id prd-draft` |
| G2 | Ground requirements in cited evidence | `skills/docs/prd-workflow.md`, no-fabrication rule |
| G3 | Block unreviewed doc ship | `construct artifact validate --type=prd` |
| G4 | Distribute briefs as styled PDF with rendered diagrams | `construct publish --figures` (Pandoc + Typst) |

## Architecture (agentic platform loop)

```d2
direction: right

user: User / PM {
  shape: person
}
cli: construct CLI {
  shape: rectangle
}
router: Workflow invoke\n(prd-draft) {
  shape: rectangle
}
pm: product-manager {
  shape: rectangle
}
arch: architect {
  shape: rectangle
}
prd: docs/prd/*.md {
  shape: document
}
gate: artifact validate {
  shape: diamond
}
pdf: Styled PDF\n(Pandoc + Typst) {
  shape: document
}

user -> cli: "Draft agentic platform PRD"
cli -> router: procedure invoke
router -> pm: requirements package
router -> arch: feasibility + trade-offs
pm -> prd: write
arch -> prd: annotate
prd -> gate: release gate
gate -> pdf: construct publish --figures
pdf -> user: distribution
```

## Functional requirements

| ID | Requirement |
|---|---|
| FR-1 | `construct procedure invoke` returns selected roles, applied skills, model resolution, and approval mode without executing specialist LLM calls in the host (embedded contract, verified 2026-06-19). |
| FR-2 | Workflow types include `prd-draft`, `architecture-review`, and `research-synthesis` (`lib/embedded-contract/workflow-defs.mjs`). |
| FR-3 | Published PDFs render fenced `d2` and `mermaid` blocks via vendored `pandoc-ext/diagram` at export time. |
| FR-4 | High-risk durable writes require explicit approval mode; default for `prd-draft` is `proposal-only`. |

## Non-goals

- Replacing the host agent runtime (Construct returns plans; hosts execute reasoning).
- Mandating npm dependencies in core CLI (ADR-0001 zero-npm-core).

## Acceptance criteria

- AC-1: `construct procedure invoke --procedure-id prd-draft` selects `product-manager` and `architect` with `docs/prd-workflow` in applied skills.
- AC-2: `construct publish <this-file> --figures` writes a PDF under `.construct/publish/` with the architecture diagram rendered (not raw code).
- AC-3: `construct artifact validate` reports structure and citation gaps on draft PRDs before approval.

## Distribution

Negative test fixture. Export is blocked by the release gate unless `--no-gate` is used:

```bash
node bin/construct publish tests/fixtures/publish/agentic-platforms-stub.md --figures
```
