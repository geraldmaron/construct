---
description: Golden slide-deck fixture for branded HTML deck and PPTX export examples.
artifactType: one-pager
subtitle: Governed agentic platform — stakeholder deck
version: "0.1"
doc_id: DECK-PLATFORM-001
classification: internal
status: draft
owner: cx-product-manager
last_verified_at: 2026-06-20
---

# Construct Platform Overview

Monochrome ink · Plus Jakarta Sans typography · 16:9 slides

---

## Problem

Platform teams orchestrating multiple AI agents lack a **governed operational layer**.

- Cold start every session — context is re-discovered, not replayed
- Artifacts ship without provenance or citation discipline
- Exports use host-default styling instead of one Construct brand

---

## What Construct provides

1. **Routing** — specialist chains with explicit intent, track, and gates
2. **Validation** — manifest-enforced structure before distribution
3. **Document I/O** — many formats in; branded PDF, HTML, deck, and PPTX out

---

## Document I/O at a glance

| Direction | Formats |
|-----------|---------|
| **Ingest** | PDF, Office, email, AV, transcripts |
| **Author** | Typed markdown artifacts (PRD, ADR, RFC, …) |
| **Export** | PDF, DOCX, DOC, HTML, **deck**, **PPTX**, RTF, EPUB |

High fidelity ingest uses the **docling Python sidecar** (local-first). Fast tier uses unpdf/mammoth.

---

## Branded exports

Every distributable format shares the same tokens:

- Ink ramp `#0a0c10` → `#fafafa`
- **Plus Jakarta Sans** body and headings · **IBM Plex Mono** for code
- Hand-drawn diagrams in PDF/HTML (D2 sketch + Mermaid handDrawn)

Open the generated examples under `.tmp/distribution-examples/` to review deck HTML and PPTX output.

---

## Next steps

- Export this deck: `construct export tests/fixtures/publish/golden-deck-platform.md --to=pptx`
- Regenerate examples: `npm run examples:deck`
- Read the matrix: [Document I/O reference](/reference/document-io)
