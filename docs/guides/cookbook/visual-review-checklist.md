---
title: Visual Review Checklist
description: Step-by-step guide for reviewers to approve artifacts before distribution.
---

# Visual Review Checklist

Before recording a visual-review verdict and advancing an artifact to the `approved` state, follow this checklist to inspect the rendered export and confirm quality standards are met.

## Prerequisites

- You have a markdown source artifact ready to review.
- You have Pandoc and the target export format tool available (Typst for PDF, pptxgenjs for PPTX, etc.).
- You are ready to render the export and inspect screenshots.

## Checklist

### 1. Render the Export

```bash
construct publish --preview <input.md>
```

This command:
- Exports the markdown to the requested format (PDF by default).
- Renders the export to a series of PNG screenshots.
- Reports what was checked and any warnings or failures.
- Saves screenshots to `.construct/publish/preview/` for inspection.

Wait for the command to complete. If render fails, consult the error message before proceeding.

### 2. Inspect the Screenshots

Open the screenshot sequence and review visually:

- **Spacing and layout** — Text is not cramped; margins are appropriate for the format.
- **Visual hierarchy** — Headings, body text, and callouts are clearly distinguished; the document is scannable.
- **Reading order** — Text flows naturally from top to bottom, left to right; no overlapping or clipped content.
- **Images and diagrams** — All embedded figures are present, legible, and properly sized. Check that diagram nodes are readable and connections are clear.
- **Consistency** — Fonts, colors, and spacing are uniform across pages. Brand elements (logo, color palette) are applied correctly.

Diagram-specific checks (when present):
- Node labels fit without wrapping excessively.
- Decision branches are labeled (no unlabeled edges on flowcharts).
- Sequence diagrams have at least 2 participants and clear message flow.
- No graph exceeds reasonable density (node count typically capped at 24).

### 3. Check Accessibility Coverage

After the render completes, `construct publish` reports a **per-format accessibility coverage line**, e.g.:

```
a11y coverage (pdf): checked [alt_text, text_extractable] | uncheckable [contrast, tag_structure]
```

This tells you:
- **checked** — These tests ran and passed.
- **uncheckable** — These require manual review (e.g., rendered-text contrast in a PDF needs OCR; tag structure in an untagged PDF is a manual audit).

For formats with manual checks listed, plan to inspect those aspects yourself:
- PDF contrast and tag structure: use a PDF reader's accessibility tools.
- PPTX reading order: open in PowerPoint and check the Navigation Pane.
- Deck (HTML) audio/video captions: verify sync and completeness manually.

### 4. Review Diagram Warnings

If the render output includes diagram warnings (e.g., "diagram 2 (flowchart): decision_without_branches"), review each flagged diagram:

- **node_density_high** — Too many nodes to follow comfortably; consider splitting or simplifying.
- **label_too_long** — Node or edge label exceeds 48 characters; shorten or reword.
- **decision_without_branches** — Decision node has <2 outgoing paths; add the missing branch so the non-happy path is drawn.
- **sequence_too_few_participants** — Sequence diagram needs at least 2 participants; verify it is worth a diagram.

Address any critical warnings before approving.

### 5. Verify Export Validity

The render report includes validation results:

```
✓ pdf: valid PDF, 12 page(s)
✓ roundtrip: 12/12 key phrases preserved
✓ references: all local references resolved
✓ contrast: brand text palette meets WCAG AA
```

If any check shows a degradation reason (e.g., `missing-dependency`), note it. A typed degradation means the tool was unavailable; this is honest reporting, not a failure. A real failure (ok: false, no degradation) blocks approval.

### 6. Record the Verdict

Once inspection is complete, record your visual-review verdict:

```javascript
// For a reviewer (automated or human):
import { recordVisualReview, makeVisualReview } from 'lib/visual-review.mjs';

const review = makeVisualReview({
  rubricId: 'document-v1',  // or 'deck-v1', 'diagram-v1'
  image: '/path/to/screenshot-1.png',
  verdict: 'pass',  // or 'needs-changes', 'fail'
  reviewer: 'your-name',
  notes: 'Headings are clear, diagrams are legible, no clipped content.'
});

const evidence = recordVisualReview({
  screenshotEvidence: capturedScreenshot,
  review,
  actor: 'reviewer'
});
```

Available verdicts:

- **pass** — Artifact meets quality standards; safe to approve and distribute.
- **needs-changes** — Visual issues detected that should be addressed before approval (e.g., cramped layout, illegible labels). Create a rework task and update the source.
- **fail** — Artifact has critical visual defects that make it unsuitable for distribution (e.g., missing pages, broken layout). Halt the approval process and investigate.

## Rubrics

Visual reviews are evaluated against format-specific rubrics:

### Document (PDF, DOCX, HTML)

**Criteria:**
- Spacing and visual rhythm (margins, line height, padding)
- Visual hierarchy and scannability (heading sizes, font weights, color contrast)
- Reading order sanity (natural flow, no unexpected reordering)

### Deck (PPTX, HTML Deck)

**Criteria:**
- Slide density (content fits without crowding)
- Font legibility at viewing distance (minimum 14pt for body text in decks)
- No clipped or overflowing content (elements stay within slide bounds)

### Diagram (Mermaid, D2)

**Criteria:**
- Purpose is clear (diagram has a defined intent; reader immediately understands what it shows)
- Labels are readable (text is large enough and positioned to avoid overlap)
- Density is manageable (node count and edge complexity are within comfortable viewing range)
- Non-happy path shown where relevant (flowcharts include error/alternate paths; sequences show exception cases)

## After Approval

Once you record a `pass` verdict:

1. The artifact transitions to the `visually-reviewed` state.
2. Stakeholders can now review the verdict.
3. If all other approval gates (accessibility, content, compliance) pass, the artifact is promoted to `approved`.
4. Upon final confirmation, the artifact moves to `completed` when published.

If you record `needs-changes` or `fail`:

1. The artifact remains at `screenshot-captured` or `accessibility-reviewed`.
2. Create a follow-up task to rework the source.
3. After updates, re-render and re-review.
4. Once issues are resolved, re-record the verdict.
