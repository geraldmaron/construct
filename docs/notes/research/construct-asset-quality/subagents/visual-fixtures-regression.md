---
intake: none
---

# Subagent Evidence Report: Visual fixtures & regression

## 1. Summary

Construct has mature rendered-output regression testing for three export pipelines (PPTX deck export, PDF/DOCX document export, diagram rendering) built on pre-export layout audits and post-export bounds validation. Fixtures are golden markdown files (877 LOC total across 28 artifact types) that pass structural + visual release gates before export. **Critical gap:** no visual quality regressions caught by pixel/rendering logic — only layout geometry and binary format validation. Tests assert on *structured properties* (bounds, overflow flags, diagram presence) rather than rendered appearance. Optional-dependency degradation is handled: renderers (Pandoc, Typst, pptxgenjs, D2/Graphviz) gracefully degrade to source-only or skipped tests. CI fast-vs-full split via `npm run test:functional` isolation.

## 2. Evidence table

| Finding | Evidence file | Evidence | Confidence |
|---------|---------------|----------|------------|
| PPTX export has pre-export layout audit (slides, tables, text density, vertical/horizontal overflow) | lib/deck-export-pptx.mjs:249–320 | `auditDeckMarkdownLayout()` estimates block heights, checks table cell wrap lines > 5 (`table_cell_wrap_excess`), text > 200 chars (`text_dense`), total Y > budget (`vertical_overflow`); returns structured `{ok, issues[]}` | high |
| PPTX export has post-export bounds audit (slide size, shape overflow in content band) | lib/deck-export-pptx.mjs:338–403 | `auditPptxFile()` unzips PPTX XML, scans shape boxes, flags `horizontal_overflow` / `vertical_overflow` if right or bottom exceed safe margins; `[object Object]` unresolved rich text; native table detection | high |
| Deck export tests call layout audit before export | tests/functional/deck-export.functional.test.mjs:30–34 | `auditDeckMarkdownLayout(body, {title})` called on fixture; test asserts `audit.ok === true` and layout issues before attempting PPTX export | high |
| PDF/DOCX export has rendered-diagram detection | lib/document-export.mjs:93–100 | `pdfRenderedDiagrams(pdfPath, sourceContent)` counts embedded images in PDF, checks D2 direction hints; `htmlRenderedDiagrams()` checks for `<img src="data:image">` tags in HTML output | high |
| Document export tests call rendered-diagram checks | tests/functional/document-export.functional.test.mjs:214–223 | Two tests: `htmlRenderedDiagrams` rejects raw source (`<pre>flowchart`), accepts rendered tags (`<img src="data:image/png">`); DOCX test checks for media/image refs in relationship XML | high |
| Diagram render gate asserts source always produced, SVG when renderer present | tests/functional/diagram.functional.test.mjs:34–54 | Contract: exit 0 always; source files (.d2/.dot/.md) >= 1 always; SVG files >= 1 only when `locateRenderer()` is true; `--source-only` flag produces no SVG | high |
| Graceful degradation when renderers missing | tests/functional/diagram.functional.test.mjs:20, document-export.functional.test.mjs:51, 65–70 | `diagram.functional.test.mjs` uses `locateRenderer()` guard; `detect('html', env)` reports `{present: false, missing: ['pandoc']}` without error; `pptxgenPresent()` skips PPTX test when lib absent | high |
| Golden fixtures are structural + visual gated before any test | tests/fixtures/artifacts/golden-fixtures.test.mjs:27–32 | Every golden fixture `.md` file runs through `validateArtifactRelease({filePath, type})` which chains `lintDocStructure()` (sections) and `lintDocVisuals()` (postconditions) | high |
| Golden artifacts span 28 types, 877 total lines, per-type > 20 lines | metrics from `wc` | artifacts/*/golden.md: prd (49 lines), runbook (44 lines), incident-report (43 lines), postmortem (43 lines), etc. | high |
| Visual requirements pinned per artifact type (runbook flowchart, incident timeline, RFC sequence, ADR diagram) | docs/guides/concepts/doc-visual-matrix.md:1–32, lib/templates/visual-requirements.mjs:23–30 | Enforced visuals: runbook `artifact-has-mermaid` (flowchart), incident-report (table `Time \| Event`), rfc (sequenceDiagram); template-visuals.test.mjs verifies every type's template carries its visual | high |
| Templates carry visual scaffolding; tests pin parity | tests/template-visuals.test.mjs:23–32 | Loop over `visualRequirementTypes()`, check each template exists and passes `lintDocVisuals()` with zero violations | high |
| Artifact quality checks source text for prose + citations (no rendering) | tests/e2e/lib/artifact-quality.mjs:57–71 | `assessArtifactQuality()` counts prose paragraphs, citations, sections; returns `{ok, structure, prose, research}`; used in realistic-user-validation.md S4 (real LLM brief scored) | high |
| CI matrix: PR = ubuntu 22 only, main = ubuntu + macos node 20/22 | .github/workflows/ci.yml:110–130 | Test job runs only ubuntu-latest on PR; main push runs ubuntu + macos; functional tests isolated via `npm run test:functional` | high |
| Heavy timeout (180s) for dashboard-build + LLM suites | scripts/run-tests.mjs:85–92 | `defaultTimeout = wantsHeavyTimeout ? 180_000 : 30_000`; covers diagram + export rendering overhead | high |
| Test sterility guard fingerprints real configs before/after | scripts/run-tests.mjs:96–112, tests/helpers/sterile-host-env.mjs | `fingerprintRealConfigs()` before test run; `assertRealConfigsUnchanged()` after; any host state leak fails entire run | high |
| Document export supports 13 formats; graceful for missing engines | lib/document-export.mjs:32–53 | EXPORT_FORMATS = pdf/docx/doc/deck/pptx/html/rtf/odt/epub/tex/txt/md/mdx; FORMAT_ENGINES maps each to pandoc/typst/pptxgenjs/libreoffice/copy; detect() never throws | high |
| Export contract: detect() + exportMarkdown() return structured errors, never throw | tests/functional/document-export.functional.test.mjs:78–99 | `detect('xyz')` returns `{ok: false, message}` for unsupported format; `detect('html', emptyPathEnv)` returns `{ok: true, present: false, missing: ['pandoc'], message}` | high |
| Real-LLM validation: specialist brief scored by artifact-quality gate; passed with 14 prose + 14 citations | tests/e2e/reports/realistic-user-validation.md:28–29 | S4 verdict: "Real `cx-researcher` brief: structure ✓, **14 prose paragraphs**, **14 citations** (9 A1 sources fetched live), OBSERVATION/INFERENCE tagged"; gate `overall: true` | high |

## 3. Existing mechanisms

1. **Pre-export layout audits** (`auditDeckMarkdownLayout`, `auditPptxFile`): Estimate vertical/horizontal overflow before PPTX write; validate bounds after ZIP extraction.

2. **Rendered-diagram detection** (`pdfRenderedDiagrams`, `htmlRenderedDiagrams`, `docxRenderedDiagrams`): Check for embedded images or rendered SVG/PNG; reject on raw source.

3. **Graceful degradation gates** (`detect()`, `locateRenderer()`, `pptxgenPresent()`): Renderers optional; missing binaries skip tests or degrade to source-only output.

4. **Fixture quality gates** (structural + visual): Every golden `.md` artifact passes `validateArtifactRelease()` before CI touches it; enforced via `tests/fixtures/artifacts/golden-fixtures.test.mjs`.

5. **Artifact quality scoring** (`assessArtifactQuality`): Prose paragraph count, citation count, `[unverified]` discipline; used in realistic-user validation.

6. **Visual requirements per type** (lib/templates/visual-requirements.mjs + doc-visual-matrix.md): Runbooks must have flowchart, incidents must have timeline, RFCs must have sequence diagram; enforced by postconditions.

7. **Test sterility** (fingerprint real configs, assert no mutation): Prevents any test from leaking into live host state.

## 4. Confirmed gaps

1. **No pixel/rendering regressions**: Tests assert on *structure* (layout geometry, bounds, overflow flags, binary format) but never check rendered pixels. A change that distorts typography, colors, spacing, or diagram rendering logic will not be caught unless it produces an XML tag mismatch or bounds overflow. Example: deck export tests check `auditDeckMarkdownLayout().ok === true` (pre-export) and slide count, but not whether a table font size change makes cells illegible.

2. **No visual diff on real output**: PDF/PPTX/HTML exports are validated for structural properties (embedded images, shape bounds) but not compared against golden renderings. A regression in Pandoc line-breaking, Typst font rendering, or pptxgenjs table layout would not surface until an operator opens the file.

3. **No "ugly" or anti-fixtures**: All fixtures are happy-path, well-formed markdown. There are no regression tests for "too-dense text", "overflow table", "clipped diagram" that should *intentionally* fail audit or export, serving as negative test cases.

4. **Golden fixture updates manual**: `tests/fixtures/artifacts/golden-fixtures.test.mjs` verifies fixtures against release gate, but `npm run examples:deck`, `generate-artifact-fixtures.mjs`, etc. are manual regeneration scripts. No CI job automatically bumps goldens when templates change, so drift can silently accumulate.

5. **No screenshot/rendered HTML diffs**: Deck export produces HTML + PPTX; HTML is never screenshot-diffed or visually inspected via headless browser. Construct deck template (templates/distribution/construct-deck.html) branding tokens are tested structurally (regex match for `Space Grotesk`) but not rendered.

6. **Diagram rendering coverage gaps**: Diagram export has smoke gate (exit 0, source present, SVG when renderer present) but no regression on SVG geometry changes. D2 `--sketch` and Mermaid `handDrawn` settings hardcoded; no test verifies they are applied to export outputs.

7. **No post-export pixel bounds**: `auditPptxFile()` checks XML shape coordinates in EMU units, but never rasterizes slides to verify text legibility or diagram sizing at final resolution.

## 5. Unconfirmed concerns

1. **Diagram embedding in PDF/DOCX**: Code mentions `preprocessMarkdownDiagrams()` and `buildDistributionDiagramEnv()` (lib/document-export.mjs:23–26) but no visible test that confirms D2/Mermaid fenced blocks are actually embedded in final PDF. The `pdfRenderedDiagrams()` check counts embedded images but does not verify they correspond to fenced blocks in source.

2. **Pandoc/Typst version pinning**: No evidence of locked Pandoc or Typst versions in CI; tests use stubbed pandoc on tmpdir PATH. A real Pandoc breaking change or typst font regression could go unnoticed if CI machines have heterogeneous versions.

3. **pptxgenjs text measurement accuracy**: `charsPerInchAtFont()` and `lineHeightIn()` are heuristic estimates (fontSize * 1.45 / 72). If pptxgenjs measures differently at runtime, pre-export audit could miss overflows that appear in the final PPTX.

4. **Optional dependency test coverage**: ink, pptxgenjs, pandoc, mammoth, unpdf are optional. Tests skip when absent, but CI does not enforce "must run with all optionals present" on at least one matrix cell.

5. **Multi-format export consistency**: Exporting the same markdown to PDF, DOCX, HTML, PPTX — no test verifies they render identically or match a shared brand spec. Pandoc and pptxgenjs may produce different spacing or font fallbacks.

## 6. Asset-quality contract opportunities

1. **Rendered visual fixtures**: Introduce golden PNG/SVG screenshots of deck slides and PDF pages; use headless browser + image-diff library to detect rendering regressions. Store golden images in version control (or use a content-addressed store) and compare against new exports.

2. **Anti-fixtures (negative tests)**: Author deliberately dense tables, tall text blocks, and overflow scenarios; assert they *do* fail pre-export audit with specific codes (`vertical_overflow`, `table_cell_wrap_excess`). Proves audit detects real problems.

3. **Pandoc/Typst version lockfile**: Pin `pandoc --version` and `typst --version` output in CI; fail if versions drift without explicit update and re-baseline.

4. **Post-export rasterization audit**: After PPTX/PDF export, render slides/pages to PNG at final resolution; check text bounding boxes (OCR or bbox detection) for legibility thresholds (font size >= 10pt on slides, etc.).

5. **Per-format consistency contract**: Export same markdown to all 13 formats; spot-check PDF page count, DOCX table structure, PPTX slide count, HTML heading hierarchy match expected values. Catch format-specific regressions early.

6. **Fixture regeneration + diff gating**: Make `generate-artifact-fixtures.mjs` idempotent; if templates change, regenerate goldens and diff before merge. Require explicit approval for golden updates.

7. **Optional dependency matrix**: CI should have at least one job that installs all optional deps and runs export tests with them all present, catching breakages that skipped-test modes hide.

## 7. Render or visual-review requirements

- **Deck PPTX export**: Pre-export audit (layout estimate), post-export audit (bounds check), but no rendered slide images. Recommend headless pptx-to-png conversion + image diff for regression detection.
- **PDF/DOCX export**: Pandoc + Typst produce typeset output; tests check for embedded images and bounds but not font/spacing correctness. Recommend post-render OCR or bounding-box validation.
- **Diagram rendering (D2/Mermaid)**: SVG produced; tests verify file exists and is valid XML but not SVG path accuracy or label placement. Recommend SVG DOM inspection or render-to-raster + pixel diff.
- **HTML deck export**: Produced by Pandoc template; branded with Construct tokens; tested structurally (Space Grotesk regex) but not rendered. Recommend headless browser screenshot.

## 8. Tests needed

1. **Rendered output smoke tests**: After deck/PDF/DOCX export, render to raster (pptx-to-image, gs for PDF, pandoc for HTML); assert color palette includes Construct brand ink, no text overflow beyond slide edges.

2. **Anti-fixture validation**: Write intentionally bad markdown (dense table, tall paragraph, overflow diagram); assert pre-export audit flags with expected error codes and export refuses to proceed.

3. **Diagram embedding confirmation**: Export markdown with D2/Mermaid fenced block to PDF/DOCX/HTML; parse output; verify embedded diagram file count matches fenced block count in source.

4. **Multi-format consistency**: Export same markdown to pdf/docx/html/pptx; spot-check: page/slide counts match, heading hierarchy preserved, table structure identical.

5. **Optional dependency coverage**: At least one CI matrix cell runs with all optional deps present (pptxgenjs, pandoc, typst, mammoth, unpdf, ink, react) and exports all 13 formats.

6. **Fixture golden drift**: Before merging template or export-logic changes, regenerate all golden fixtures; diff them; require approval for any golden changes.

7. **Font/branding audit**: After deck/PDF export, inspect embedded fonts; verify Space Grotesk + JetBrains Mono are bundled; assert INK color ramp is applied to text.

## 9. Docs needed

1. **Visual regression testing guide** (docs/guides/reference/visual-regression-testing.md): Document pre-export audits (`auditDeckMarkdownLayout`, `auditPptxFile`), rendered-diagram checks, graceful degradation, anti-fixtures, pixel-diff setup.

2. **Export format compatibility matrix**: Table showing which formats support which features (diagrams, fonts, tables, page breaks, etc.) and expected rendering differences.

3. **Golden fixture regeneration runbook**: When to regenerate, how to diff, approval workflow for golden updates.

4. **Branding token application**: How Construct ink, typography, and layout are applied per format; where regressions can occur (Pandoc template, pptxgenjs constants, CSS).

5. **Optional dependency fallback behaviors**: Document what happens when pandoc, typst, pptxgenjs, D2, Graphviz are missing; which tests skip; which degrade gracefully.

## 10. Dependency and degradation concerns

| Dependency | Status | Fallback | Risk |
|------------|--------|----------|------|
| Pandoc | Optional (devDep) | Tests skip if absent; `detect()` reports missing; export returns structured error. | Moderate: CI may not have Pandoc; `npm run test:functional` could miss export regressions on contributor machine. Recommend CI install via apt. |
| Typst | Optional (PDF engine) | Tests skip if absent; fallback is none (PDF export will fail if requested). | Moderate: Typst is new; version instability. Recommend lockfile. |
| pptxgenjs | Optional devDep | `pptxgenPresent()` guard skips PPTX tests if absent. | Moderate: Deck export tests skipped on machines without npm install, hiding pptxgenjs breakages. |
| D2 / Graphviz | Optional system binaries | `locateRenderer()` checks PATH; if absent, diagram produces source only (no SVG). | Low: Graceful degradation by design. Diagram tests verify this. |
| Mammoth, UnPDF | Optional devDep | Document ingest (separate pipeline) degrades if absent. | Low: Ingest failures are observable; no silent data loss. |
| LibreOffice | Optional system binary | `.doc` export converts DOCX via LibreOffice; if absent, DOCX export still works. | Low: Only affects legacy `.doc` format; modern workflows use `.docx`. |

**Degradation handling**: All optional dependencies are checked before use; missing binaries return `{present: false, missing: […], message: "Install X"}` rather than throwing. Export logic never assumes a renderer is present.

## 11. Questions for Opus

1. **Pixel-diff strategy**: Should visual regressions be caught via image diffs (golden PNGs checked into git or content-addressed store) or via post-export headless browser / OCR validation? Trade-offs: image diffs are storage-heavy but deterministic; OCR is lighter but less precise.

2. **Golden fixture regeneration approval**: Should `generate-artifact-fixtures.mjs` be CI-gated (auto-regenerate + diff before merge, require approval) or manual (developer runs locally, commits)? Current behavior is manual.

3. **Optional dependency matrix in CI**: Should at least one job always run with all optional deps installed (vs. current selective skipping)? Cost: slower CI; benefit: catch dep-specific regressions early.

4. **Anti-fixtures in version control**: Should "ugly" or intentionally-failing markdown examples live in tests/fixtures/ as documented regression cases, or are pre-export audit codes + unit tests enough?

5. **Pandoc/Typst version pinning**: Should CI lockfile Pandoc/Typst versions, or rely on "latest available on runner"? Current behavior is uncontrolled; drifts silently.

## 12. Suggested bead updates

No beads to update; this audit is read-only. However, findings suggest future work:

- **Bead: "Add pixel-diff regression testing for deck/PDF exports"** — Implement headless browser + image-diff for rendered outputs; add to CI matrix.
- **Bead: "Introduce anti-fixtures (negative test cases)"** — Author deliberately bad markdown; verify audit flags them correctly; document expected failure codes.
- **Bead: "Lock Pandoc/Typst versions in CI"** — Investigate current version handling; add lockfile or version gate.
- **Bead: "Optional dependency coverage in CI"** — Ensure at least one matrix cell runs all optional deps.
- **Bead: "Golden fixture drift detection"** — Automate regeneration + diff; gate approval for golden changes.
