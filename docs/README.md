# Documentation

The previous documentation system (96 ADRs, 5 RFCs, PRD trees, guides, ~387 files) was deleted on 2026-08-03 as part of the strategy rewrite. It encoded a superseded direction and had become a maintenance surface larger than its value.

## The new documentation contract

- **[STRATEGY.md](../STRATEGY.md)** (repo root) is the only standing strategy document: north star, end-state UX, architecture commitments, program shape, named risks.
- **Beads** is the only work record: the program graph, acceptance criteria, dependencies, and verification evidence live in the tracker, not in decision documents.
- **No ADRs, RFCs, or PRDs.** A decision is either an architecture commitment (goes in STRATEGY.md, replacing what it supersedes) or a work item (goes in beads). Documents that merely record that a decision happened are not written.
- **Docs regrow only when they earn their keep.** A new document is added here when a real reader (user or contributor) needs it repeatedly, not ahead of that need. Each addition names its audience and its maintenance owner in its header.
- **CHANGELOG.md** (repo root) remains the release record.

<!-- AUTO:catalog-sync -->
## Capability catalog (generated)

> Narrative docs index — this table is regenerated from `registry/capabilities.json`.
> Run `npm run docs:sync` after catalog changes. Do not hand-edit inside the AUTO markers.

Catalog census: 132 CLI commands, 58 npm scripts, 0 embedded workflows.

| Capability | Criticality | CLI surface | Verification |
|---|---|---|---|
| `ingest.adapter` | P0 | construct ingest | `tests/functional/node-native-extraction.functional.test.mjs` |
| `ingest.docling` | P1 | construct ingest --legacy-extractor=false | `tests/functional/mcp-ingest-resilience.functional.test.mjs` |
| `local.model.tier` | P1 | construct models resolve | `—` |
| `mcp.broker.connection` | P0 | — | `tests/functional/mcp-parity.functional.test.mjs` |
| `oracle.meta-review` | P1 | construct oracle review | `tests/functional/oracle-bounded-auto.functional.test.mjs` |
| `orchestration.routing` | P0 | construct orchestrate run | `tests/functional/orchestration-mcp.functional.test.mjs` |
| `surfaces.opencode-primary` | P1 | construct sync | `tests/functional/opencode-primary-surface.functional.test.mjs` |
| `workflow.architecture-review` | P1 | construct procedure invoke | `tests/functional/embedded-contract-procedure-invoke.functional.test.mjs` |
| `workflow.evidence-ingest` | P1 | construct procedure invoke | `tests/functional/embedded-contract-procedure-invoke.functional.test.mjs` |
| `workflow.prd-draft` | P1 | construct procedure invoke | `tests/functional/embedded-contract-procedure-invoke.functional.test.mjs` |
| `workflow.proposal-review` | P1 | construct procedure invoke | `tests/functional/embedded-contract-procedure-invoke.functional.test.mjs` |
| `workflow.research-synthesis` | P1 | construct ask | `tests/functional/embedded-contract-procedure-invoke.functional.test.mjs` |
| `workflow.risk-review` | P1 | construct procedure invoke | `tests/functional/embedded-contract-procedure-invoke.functional.test.mjs` |
<!-- /AUTO:catalog-sync -->

## What existed before

The deleted tree is recoverable from git history prior to 2026-08-03 if a specific document is ever needed for archaeology. Do not resurrect documents wholesale; extract the fact you need and cite the commit.
