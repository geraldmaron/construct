---
description: Golden slide-deck fixture for branded HTML deck and PPTX export examples.
artifactType: one-pager
subtitle: Governed agentic platform — stakeholder deck
version: "0.1"
doc_id: DECK-PLATFORM-001
classification: internal
status: draft
owner: product-manager
last_verified_at: 2026-06-20
---

# Construct Platform Overview

Field-notebook ink · Plus Jakarta Sans typography · 16:9 slides

---

## Problem

Platform teams orchestrating AI agents lack a **governed operational layer**.

- Cold start — context re-discovered each session
- Artifacts ship without provenance or citations
- Exports use host styling, not Construct brand

---

## What Construct provides

1. **Routing** — Worker Profile chains with intent, track, and gates
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

- Ink ramp `#1a1d24` → `#eef1f3`
- **Plus Jakarta Sans** body · **JetBrains Mono** code
- Hand-drawn structural diagrams in PDF/HTML via D2 sketch; Mermaid classic for simple flows

---

## Next steps

- Export: `construct export … --to=pptx`
- Regenerate: `npm run examples:deck`
- Matrix: [Document I/O reference](/reference/document-io)

Review outputs in `.tmp/distribution-examples/`.
