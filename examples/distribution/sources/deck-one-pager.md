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

Monochrome ink · Space Grotesk typography · 16:9 slides

---

## Problem

Platform teams orchestrating AI agents lack a **governed operational layer**.

- Cold start — context re-discovered each session
- Artifacts ship without provenance or citations
- Exports use host styling, not Construct brand

---

## What Construct provides

1. **Routing** — specialist chains with intent, track, and gates
2. **Validation** — manifest-enforced structure before distribution
3. **Document I/O** — many formats in; branded PDF, HTML, deck, PPTX out

---

## Document I/O at a glance

| Direction | Formats |
|-----------|---------|
| **Ingest** | PDF, Office, email, AV |
| **Author** | Typed markdown artifacts |
| **Export** | PDF, DOCX, HTML, PPTX |

High fidelity: **docling** sidecar (local-first). Fast tier: unpdf/mammoth.

---

## Branded exports

One token set across all distributable formats:

- Ink ramp `#0a0c10` → `#fafafa`
- **Space Grotesk** body · **JetBrains Mono** code
- Hand-drawn diagrams in PDF/HTML (D2 sketch + Mermaid)

---

## Next steps

- Export: `construct export … --to=pptx`
- Regenerate: `npm run examples:deck`
- Matrix: [Document I/O reference](/reference/document-io)

Review outputs in `.tmp/distribution-examples/`.
