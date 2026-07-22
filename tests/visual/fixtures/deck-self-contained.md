---
description: Self-contained deck fixture for the test:visual rendered-artifact gate (no root-relative links, so reference-integrity resolves entirely within this directory).
artifactType: one-pager
subtitle: Rendered-artifact visual gate fixture
version: "0.1"
doc_id: DECK-VISUAL-GATE-001
classification: internal
status: draft
owner: product-manager
last_verified_at: 2026-07-03
---

# Visual Gate Deck

Monochrome ink · rendered-artifact proof deck

---

## Problem

Rendered artifacts must carry real, visible ink on every page.

- A blank page from a broken template must fail the gate
- Text extracted from the export must match the source
- Local references must resolve on disk

---

## Goals

- Export through the real Pandoc/pptxgenjs engines
- Rasterize every slide and sample real pixels
- Fail loud when a required engine is absent
