---
intake: none
intake_rationale: capability decision recorded from research brief construct-i1mt; not routed through an intake packet.
last_verified_at: 2026-06-05
verified_by: construct · export half shipped (lib/document-export.mjs + construct export CLI + document_export MCP tool); ingestion half present via lib/document-ingest.mjs + lib/runtime/uv-bootstrap.mjs; functional test tests/functional/document-export.functional.test.mjs covers detect/missing-binary/happy-path
---

# ADR 0024: Document I/O is an optional, externally-bound capability

**Date:** 2026-06-04
**Status:** Accepted
**Deciders:** Construct·Architect
**Supersedes:** none

---

## Problem

Construct's specialists routinely consume documents (a customer hands over a PDF spec, a DOCX brief, a deck) and produce them (a strategy or PRD a stakeholder wants as a formatted PDF or Word file). Today that conversion is ad-hoc: there is no uniform, host-agnostic operation that Construct — or a tool sitting on top of Construct — can call to turn an arbitrary document into agent-readable markdown, or a finished markdown artifact into a distributable PDF/DOCX.

The naive fix is to bundle a conversion library into core. That collides head-on with [ADR 0001](0001-zero-npm-core.md): the strongest ingestion engine (Docling) is a Python + `torch` + downloaded-ML-model stack, and the strongest export tools are system binaries. Forcing either onto every `npm install` is precisely the supply-chain and constrained-install cost ADR 0001 and [ADR 0014](0014-local-embeddings-optional.md) exist to prevent.

## Context

- ADR 0001 commits `lib/` and `bin/` to Node built-ins plus a narrow sanctioned exception, to keep installs small and reliable.
- ADR 0014 established the pattern for heavy capability deps: declare them `optional`, lazy-load on first use, and degrade gracefully to a working baseline when absent.
- An ingestion provider abstraction already exists (`lib/ingest/strategy.mjs`, `lib/ingest/provider-extract.mjs`), so a new provider plugs into a known seam rather than a greenfield surface.
- The research brief (`.cx/research/doc-io-and-invocation-research.md`, 2026-06-04) establishes three load-bearing facts: Docling converts *into* markdown/HTML/JSON but cannot export markdown *to* PDF/DOCX (ingestion-only); Pandoc ships as a statically-linked binary with no runtime dependencies (GPLv2+, isolated by process boundary); and Typst is a single Apache-2.0 binary suitable as a PDF engine.

## Decision

Document I/O is an **optional capability with two independent halves, both bound to external tooling discovered at runtime and never bundled in core**:

1. **Ingestion** (document → markdown/JSON) via Docling, preferably the `docling-serve` HTTP sidecar, plugged in behind the existing `lib/ingest` provider seam.
2. **Export** (markdown → PDF/DOCX/HTML) via **Pandoc** (DOCX and driver) and **Typst** (PDF engine), spawned as external system binaries.

Both halves are exposed uniformly across CLI, MCP, and SDK as explicit operations. When the underlying tool is absent, the operation degrades gracefully with an actionable "install X to enable" message — it never fails an unrelated install and never silently no-ops.

## Rationale

Splitting ingestion from export follows the evidence: Docling is the best ingestion engine but does not export at all, so a single-tool design is impossible (research brief, Topic 1). Pandoc and Typst are statically-linked standalone binaries, so spawning them adds zero npm or native weight to the core install — the ADR 0001 constraint holds by construction (research brief, Topic 2). Invoking Pandoc as a separate process keeps its GPLv2+ license isolated from Construct's own (research brief, Topic 2, Pandoc COPYRIGHT). Declaring the whole capability optional with a working-absent fallback is the proven ADR 0014 shape, not a new pattern. Reusing `lib/ingest` keeps ingestion within an audited abstraction.

## Rejected alternatives

- **Bundle Docling (Python/torch) as a dependency or npm wrapper.** Forces a multi-gigabyte ML stack and runtime model downloads onto every installer, reproducing the exact supply-chain and constrained-install failure ADR 0014 remediated. Rejected as a direct ADR 0001/0014 violation.
- **Use Docling for export as well as ingestion.** Docling's supported export formats are HTML, Markdown, JSON, Text, DocTags, and WebVTT — it cannot produce PDF or DOCX (research brief, Topic 1, primary source). Rejected as technically impossible, not merely undesirable.
- **Pure-JS export via bundled headless Chromium (e.g. md-to-pdf/Puppeteer).** Forces a hundreds-of-megabyte browser download for what a ~static binary does, with no fidelity gain for document-style output. Rejected on footprint; retained only as an opt-in second engine if pixel-perfect CSS fidelity ever becomes a hard requirement.
- **WeasyPrint for export.** Drags in Python plus Cairo/Pango/GDK-PixBuf system libraries (research brief, Topic 2), a heavier non-Node toolchain than Pandoc+Typst with no advantage for the document targets in scope. Rejected on footprint.

## Consequences

- Any host or tool-on-top can request a conversion through one explicit operation; the core install is unchanged and cannot fail on document-tooling resolution.
- Feature availability now depends on external tooling being present, so detection and clear "install X" messaging become a required part of the capability contract, not an afterthought.
- Running Docling at scale introduces an operational component (the `docling-serve` sidecar) to own and monitor.
- Conversion is locked in as a capability contract (CLI/MCP/SDK operation), not a library API — callers depend on the operation, leaving the engine swappable.

## Reversibility

Two-way door per half. The export engines are swappable behind the operation; the ingestion path can move between a CLI Docling invocation and the sidecar without a contract change. Vendoring a pure-JS converter later (accepting its footprint) would be a manifest and provider change justified by a superseding ADR. Adding a bundled core dependency would require superseding this ADR and ADR 0001.

## References

- [ADR 0001: Zero npm dependencies in core](0001-zero-npm-core.md)
- [ADR 0014: Local ONNX embeddings are an optional capability](0014-local-embeddings-optional.md)
- Research brief: `.cx/research/doc-io-and-invocation-research.md` (2026-06-04)
- `lib/ingest/strategy.mjs`, `lib/ingest/provider-extract.mjs`
- Beads: `construct-yrdd` (capability), `construct-i1mt` (research)
