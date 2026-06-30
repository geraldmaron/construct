---
title: Export Audit Guide
description: Understanding post-export validation checks and how to interpret typed degradations.
---

# Export Audit Guide

After an artifact exports to a distribution format, the publish pipeline runs a suite of post-export checks to verify the file is valid, the content was preserved, and references remain intact. This guide explains what each check does, how to read the output, and what a **typed degradation** means.

## Post-Export Checks

### PDF Page Count (`validatePdf`)

**What it checks:** Confirms the PDF file contains real pages.

**How it works:** Runs `pdfinfo <file>` to extract the page count. A valid PDF has at least one page.

**Output:**
```
✓ pdf: valid PDF, 12 page(s)
✗ pdf: invalid PDF, 0 page(s)
```

**Failure scenarios:**
- Export succeeded but created an empty or corrupt PDF.
- PDF is image-only with no recoverable page data.

**Degradation:**
```
⚠ pdf: missing-dependency
   pdfinfo not available
```
This means `pdfinfo` (part of Poppler) is not installed. The check cannot run. A missing tool does not fail the publish; it is honestly reported so you know coverage is limited.

---

### Content Roundtrip (`contentRoundtrip`)

**What it checks:** Verifies that text content was not dropped during export.

**How it works:**
1. Extracts all text from the exported file using format-specific tools:
   - PDF: `pdftotext`
   - HTML: strips HTML tags and extracts plain text
   - DOCX/PPTX: unzips and parses XML for text content
2. Compares extracted text against key phrases from the source markdown headings (up to 12 headings).
3. Computes a preservation ratio: `(headings found) / (headings in source)`.

**Output:**
```
✓ roundtrip: 12/12 key phrases preserved
⚠ roundtrip: 10/12 key phrases preserved (83%)
   Missing: "Diagram Quality"
```

**Failure scenarios:**
- Export silently dropped a heading or major section.
- Text extraction failed (the exported file has no readable text layer).

**Degradation:**
```
⚠ roundtrip: missing-dependency
   cannot extract text from pdf (pdftotext not available)
```
The extraction tool is absent. The check is skipped. Output quality is still verifiable visually; the text preservation metric is just unavailable.

---

### Reference Integrity (`referenceIntegrity`)

**What it checks:** Confirms all local image and link targets exist on disk.

**How it works:**
1. Parses the source markdown for image paths (`![alt](path)`) and local links (`[text](path)`).
2. Ignores remote URLs (http/https), anchors (`#section`), and mailto links.
3. Resolves each local path relative to the source document's directory.
4. Reports any missing files.

**Output:**
```
✓ references: all local references resolved
✗ references: 2 broken links
   Missing: images/diagram.png, docs/guide.md
```

**Failure scenarios:**
- An image was moved or renamed after the document was written.
- A relative link points to a file that does not exist.
- The document references a file outside the project tree.

**Why it matters:** A broken reference breaks the artifact's delivery. The export file itself is valid, but the artifact is incomplete when distributed.

---

### Brand Contrast (`validateBrandContrast`)

**What it checks:** Confirms the document's text and background colors meet WCAG AA accessibility standards.

**How it works:**
1. Validates the brand template's color palette against WCAG 2.1 Level AA contrast requirements.
2. Checks all text-on-background pairs (foreground vs. background).
3. Reports any pairs below the 4.5:1 (normal text) or 3:1 (large text) threshold.

**Output:**
```
✓ contrast: brand text palette meets WCAG AA
✗ contrast: 2 brand pairs below AA
   #F0F0F0 on #FFFFFF (1.05:1, need 4.5:1)
```

**Note:** Contrast is a brand invariant, not a property of the individual artifact. A regression here indicates a template issue, not a document defect. The advisory is surfaced at standard gate levels; at full-certification and above, it escalates to a hard failure.

---

### Diagram Legibility (`lintDocumentDiagrams`)

**What it checks:** Detects readability issues in embedded Mermaid and D2 diagrams.

**How it works:**
- Analyzes each fenced mermaid/d2 block in the source.
- Checks for excessive node density, long labels, unlabeled edges, and incomplete decision paths.
- Returns findings for each diagram.

**Output (advisory by default):**
```
⚠ diagram 1 (flowchart): node_density_high
   28 nodes exceed the 24-node readability limit
⚠ diagram 2 (flowchart): decision_without_branches
   decision D has 1 outgoing branch(es); a decision needs at least the yes/no paths
```

**Failure scenarios (with `cx_diagram_quality: strict` in frontmatter):**
The warnings above become hard failures and block approval.

**Codes:**
- `node_density_high` — Too many nodes (>24).
- `label_too_long` — A label exceeds 48 characters.
- `decision_without_branches` — A flowchart decision node has <2 outgoing paths (only the happy path drawn).
- `sequence_too_few_participants` — A sequence diagram needs at least 2 participants to be worthwhile.

Unlabeled edges are deliberately not flagged: a bare arrow is idiomatic in dependency and data-flow diagrams.

---

### Accessibility Audit (`auditAccessibility`)

**What it checks:** Per-format accessibility compliance and honest coverage reporting.

**How it works:**
1. Identifies which a11y checks apply to the export format.
2. Runs all applicable checks.
3. Returns a list of passed checks and a list of uncheckable concerns (manual review required).

**Output:**
```
a11y coverage (pdf):
  checked [alt_text: PASS, text_extractable: PASS]
  uncheckable [contrast (OCR needed), tag_structure (manual audit)]
```

**Checks by format:**

| Format | Checks | Uncheckable |
|--------|--------|-------------|
| PDF | Alt text, text extractability | Rendered-text contrast (needs OCR), tag structure (manual) |
| HTML | Alt text, heading hierarchy, contrast | (none) |
| DOCX | Alt text | Contrast (resolves in client), heading hierarchy (manual check) |
| PPTX | Alt text, font floor | Rendered-text contrast (needs OCR), reading order (visual review) |
| Deck (HTML) | Alt text, heading hierarchy, contrast, font floor | Reading order (visual review) |

**Failing checks block approval at `full-certification` and above.**

---

## Typed Degradation (What It Means)

A **degradation** is a deliberately recorded miss that does NOT fail the publish.

**When you see a degradation:**
```
⚠ roundtrip: missing-dependency
   cannot extract text from pdf (pdftotext not available)
```

**What it means:**
- The check **cannot run** because a required tool is missing.
- This is **NOT a failure**; the artifact is not invalid.
- The ledger honestly records: "we tried, but the tool was unavailable."
- Possible reasons:
  - `missing-dependency` — A required binary (pdfinfo, pdftotext, unzip) is not installed.
  - `unavailable-renderer` — A tool exists but failed to produce output (e.g., pdftotext crashed).
  - `unsupported-format` — The export format is not supported for this check (e.g., a11y audits for untagged PDF).
  - `headless-limitation` — A rendering tool needs a display server (X11, Wayland) not available in headless mode.
  - `skipped-by-policy` — The check was intentionally skipped (e.g., no export file found for a dry-run).

**Why degradations are honest:**
A typed degradation prevents false passes. If `pdftotext` is missing and the publish gateway silently said "✓ roundtrip: pass" with no text extracted, you'd have a hidden gap. Instead, the system says "✓ export: OK, but ⚠ roundtrip: uncovered (tool missing)" — you see the limit.

**How to handle degradations:**
1. **In CI/CD:** Install the missing tool in your build environment or accept the coverage gap.
2. **In solo mode:** Run `construct tools detect` to see what's missing; install via your package manager.
3. **For gates:** Degradations never escalate to hard failures; a real validation failure (ok: false, degradation: null) is what blocks publish.

---

## Reading the Publish Output

### Full Report Example

```bash
$ construct publish --preview article.md --format pdf

[export] article.md → article.pdf (2.3 MB, 4.2s)

[validate]
  ✓ pdf: valid PDF, 12 page(s)
  ✓ roundtrip: 12/12 key phrases preserved
  ✓ references: all local references resolved
  ✓ contrast: brand text palette meets WCAG AA

[diagrams]
  ⚠ diagram 1 (flowchart): label_too_long
    node approval_gate label is 52 chars (max 48)

[a11y]
  a11y coverage (pdf):
    checked [alt_text: PASS, text_extractable: PASS]
    uncheckable [contrast (OCR needed), tag_structure (manual)]

[render-smoke]
  ✓ screenshot: 1_cover.png, 2_intro.png, 3_body.png, …, 12_appendix.png
    Saved to: .cx/publish/preview/article/

[summary]
  gate: render-smoke
  ok: true
  failures: []
```

### Interpreting Codes

- **✓ (checkmark)** — Check ran and passed (or is not applicable).
- **✗ (cross)** — Check ran and failed; artifact is not okay.
- **⚠ (warning)** — Advisory issue (degradation or optional severity).

---

## Gate-Level Differences

Different gate levels run different checks and handle failures differently:

| Level | Checks | Diagram Quality | A11y | Render |
|-------|--------|-----------------|------|--------|
| **fast** | Structural, linting | Advisory | No | No |
| **standard** | + export validity, roundtrip, references | Advisory | No | No |
| **render-smoke** | + all standard + brand contrast | Advisory | Advisory | Yes |
| **full-certification** | + strict a11y at AA level | Strict if `cx_diagram_quality: strict` | Strict (failures block) | Yes |
| **human-reviewed** | + all above + visual review verdict | Strict | Strict | Yes |

---

## Troubleshooting

### "missing-dependency: pdfinfo not available"

Install Poppler:
```bash
# macOS
brew install poppler

# Ubuntu/Debian
apt-get install poppler-utils

# CentOS/RHEL
yum install poppler-utils
```

### "roundtrip: 8/12 key phrases preserved"

A section heading was dropped during export. Check:
1. Is the heading in the source markdown?
2. Did the export hang or timeout?
3. Are any headings malformed (contain `{`, `}`, or `<`)?

Regenerate the export and compare.

### "✗ references: broken links"

Verify the file path:
```bash
# From the directory containing the markdown:
ls -la images/diagram.png
```

If the file is missing, add it or update the link.

### "diagram 1 (flowchart): decision_without_branches"

A decision node has only one outgoing path. Update the diagram:
```mermaid
flowchart LR
    A{approved?}
    A -->|yes| B[Proceed]
    A -->|no| C[Reject]  // <-- Add the missing branch
```

---

## Next Steps

Once export validation completes:

1. **If ok: true** — Artifact is valid for distribution.
   - At render-smoke level or higher, inspect the screenshots.
   - Record a visual-review verdict (see `visual-review-checklist.md`).
   - Proceed to approval workflow.

2. **If ok: false (non-degraded failure)** — Fix the defect.
   - Update the source markdown.
   - Re-export and re-validate.

3. **If degradations present** — Decide on coverage.
   - Accept the gap and proceed (degradations do not block).
   - Or install the missing tool and re-validate.
