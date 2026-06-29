---
intake: none
---

# Subagent Evidence Report: Document export quality

## 1. Summary

The document export pipeline (`lib/document-export.mjs`, `lib/diagram-export.mjs`, `vendor/pandoc-ext/diagram.lua`) successfully **renders mermaid/d2 diagrams to images**, not filters them. The implementation includes three post-export validators (`pdfRenderedDiagrams`, `docxRenderedDiagrams`, `htmlRenderedDiagrams`) that detect when diagrams fail to render and report structured errors. However, there is **no PDF validity checking, DOCX text-extraction roundtrip validation, or rendered-page visual review**. Export-time validation is localized to diagrams; broader asset quality (missing images, broken links, font fallbacks, PDF integrity) lacks observability.

---

## 2. Evidence table

| Finding | Evidence file | Evidence | Confidence |
|---------|---------------|----------|------------|
| Diagram rendering is active, not filtered | `lib/document-export.mjs:467-469`, `vendor/pandoc-ext/diagram.lua:590-672` | `--lua-filter diagram.lua` is passed to pandoc when `figures=true`; the Lua filter's `code_to_figure()` function compiles diagrams via engine (mermaid/d2), stores result in mediabag, and returns Image/Figure AST node. Returns `nil` (no-op) only if no engine found for block. | high |
| Diagram source is preprocessed before render | `lib/diagram-export.mjs:197-201` | `preprocessMarkdownDiagrams()` injects Mermaid init block and D2 defaults (monochrome palette, font size, sketch mode) into code blocks before export. Called at `lib/document-export.mjs:318`. | high |
| Post-export diagram validators exist | `lib/document-export.mjs:93-150`, lines 492-519 | Three validators: (1) `pdfRenderedDiagrams()` counts embedded images in PDF binary (Subtype /Image or /Form regex); (2) `docxRenderedDiagrams()` unzips DOCX, checks document.xml for raw diagram source and word/media/ directory for embedded images; (3) `htmlRenderedDiagrams()` reads HTML, scans for `<img>` or `<svg>` tags or data:image URIs. Each returns false if source diagrams found and no images embedded. | high |
| Diagram render failures block export | `lib/document-export.mjs:488-520` | When `figures=true` and diagram count > 0, export checks result with validator. If validator returns false, export returns `ok: false` with structured error message naming tool requirements (d2, mmdc, Chrome). Not a warning; blocks the export. | high |
| Diagram rendering calls pandoc filter | `vendor/pandoc-ext/diagram.lua:1-10, 675-687` | File header confirms "filter uses Figure AST element, added in pandoc 3". `Pandoc = function(doc)` walks CodeBlock nodes, calls `code_to_figure(conf)` for each. Returns modified Pandoc document with images in mediabag. | high |
| Diagram engine failure returns nil | `vendor/pandoc-ext/diagram.lua:621-638` | If `engine.compile()` fails (pcall error), logs warning, returns `nil` (no-op on the code block). Also returns `nil` if compiled result is falsy or has no mime type. Code block remains in output as text. | high |
| PDF template and DOCX reference are discoverable | `lib/document-export.mjs:55-67, 427-430` | `resolvePdfTemplatePath()`, `docxReferencePath()`, `htmlTemplatePath()` check existence and return path or null. Reference docs are optional (graceful degradation); PDF/HTML templates are required for construct branding. | high |
| Branding policy routing exists | `lib/export-branding.mjs:23-31` | `resolveExportBranding(format, requested)` returns applied branding (construct/plain/none) based on format capability. Default is 'construct' for all style-capable formats. | high |
| Font bundling for offline PDF | `lib/brand-fonts.mjs:22-80` | Bundled fonts: SpaceGrotesk-Variable.ttf (sans), JetBrainsMono-Regular/Medium/SemiBold (mono). PDF export passes `--font-path`, `--ignore-system-fonts`, `--ignore-embedded-fonts` to Typst, ensuring brand fonts render or fail visibly. PPTX embeds via `pptx-embed-fonts` when available. | high |
| Source diagram detection for validation | `lib/document-export.mjs:108-110, 204-206` | `rawDiagramSourcePattern()` regex matches literal diagram syntax (flowchart TD, sequenceDiagram, direction: down, etc.). `countDiagramFences()` counts ` ```mermaid` and ` ```d2` blocks. Used as expected-diagram count. | high |
| Functional tests include diagram render checks | `tests/functional/document-export.functional.test.mjs:187-223` | Tests 'docxRenderedDiagrams' and 'htmlRenderedDiagrams' with real zip unpacking and media lookups. Hand-constructs DOCX structure, verifies unresolved source detected, verified resolved media accepted. | high |
| Extract PDF text for content validation | `tests/functional/publish.functional.test.mjs:41-60, 216-283` | Test helper `extractPdfPages()` calls `pdfinfo` and `pdftotext` to extract text, validates ordered list numbering preserved and literal diagram source does NOT appear (line 279). | high |
| Diagram environment variables are set | `lib/diagram-export.mjs:209-225` | `buildDistributionDiagramEnv()` exports D2/Mermaid options (theme, scale, sketch, PPTX config, Chrome path) as env vars consumed by diagram binaries. Called at `lib/document-export.mjs:364`. | high |
| No PDF/DOCX validity check API | `lib/document-export.mjs` (full file), `lib/export-branding.mjs`, `lib/brand-fonts.mjs` | No calls to PDF validation tools (e.g., qpdf, gs) or DOCX schema validators. File size check only (`fs.statSync().size > 1000`). | high |
| No link or image-reference validation | `lib/document-export.mjs` (full file), `lib/diagram-export.mjs` | No regex scanning of markdown for `[](broken-url)` or `![](missing-image.png)`, no file-existence checks for image references. | high |
| No font fallback detection | `lib/document-export.mjs`, `lib/brand-fonts.mjs` | PDF fonts are bundled and enforced via --ignore-system-fonts flag. No detection of what fonts actually rendered in PDF. Font check in `lib/brand-fonts.mjs:pdfUsesBundledBrandSans()` does regex search for font family names in PDF binary (line 89), but returns boolean only; not called during export. | high |
| No screenshot or pixel-diff testing | `tests/functional/`, `lib/`, `scripts/` (searched) | No headless browser screenshots, no visual regression tools (resemble.js, pixelmatch, etc.), no Playwright visual comparisons of rendered exports. | high |
| Example gallery exists but is view-only | `scripts/generate-distribution-examples.mjs`, `examples/distribution/manifest.json` | Script regenerates PDF/HTML/deck/PPTX examples into `.tmp/distribution-examples/` with figures enabled. Index lists exports and failed formats, but no validation or quality assertions on outputs. Intended for manual review. | high |
| Export returns structured result | `lib/document-export.mjs:522-533` | Result object includes: ok, format, inputPath, outputPath, engine, pdfEngine, figures, template, branding, message. Callers can inspect branding and template; no metadata about what was actually rendered. | high |

---

## 3. Existing mechanisms

### Detection and availability (runtime)
- **`detect(format, env, opts)`** returns binary/tool availability with install hints. Checks pandoc, typst, d2, mmdc, libreoffice, pptxgenjs, templates. Called before export; does not throw.
- **Format engines mapping** (`FORMAT_ENGINES` object, lines 39-53) declares which engine + binaries each format requires.

### Diagram preprocessing
- **`preprocessMarkdownDiagrams(content)`** injects brand theme (Mermaid) and D2 defaults before Pandoc runs. Adds monochrome color palette, font size, sketch mode env vars.
- **`buildDistributionDiagramEnv(baseEnv)`** exports diagram rendering options as env vars: D2_THEME, D2_SCALE, D2_SKETCH, MERMAID_MIME, MERMAID_SCALE, Chrome path.

### Post-export validation (diagrams only)
- **`pdfRenderedDiagrams(pdfPath, sourceContent)`** (line 93–106): Counts embedded images in PDF binary (latin1 text, regex for `/Subtype /Image` and `/Subtype /Form`). If expected diagrams > embedded count and raw diagram syntax detected in PDF text, returns false.
- **`docxRenderedDiagrams(docxPath, sourceContent, env)`** (line 126–136): Unzips DOCX, reads word/document.xml and word/_rels/document.xml.rels, counts word/media/ entries. Fails if raw diagram source in document.xml and no image relationships.
- **`htmlRenderedDiagrams(htmlPath, sourceContent)`** (line 138–150): Reads HTML, counts `<img>` and `<svg>` tags or `data:image` URIs. Fails if raw diagram source and no rendered tags.

### Template and branding
- **Branded templates** (construct-pdf.typ, construct-web.html, construct-deck.html, construct-reference.docx) apply CSS/typography/layout per artifact type.
- **Brand tokens** (lib/brand-tokens.mjs): monochrome ink ramp, Space Grotesk / JetBrains Mono, font weights and sizes.
- **PDF font enforcement**: Typst export passes `--ignore-system-fonts` and `--ignore-embedded-fonts`, forcing bundled TTF or rendering failure.

### Functional tests
- **`tests/functional/document-export.functional.test.mjs`** stubs Pandoc, tests detect() contract, format support, reference doc optional handling, and diagram validation helpers.
- **`tests/functional/publish.functional.test.mjs`** exports real golden fixture PDFs, extracts text via pdftotext, validates ordered list numbering and diagram rendering (line 279: asserts literal diagram source does NOT appear).

---

## 4. Confirmed gaps

### Post-export quality assurance
1. **No PDF validity or integrity check** — No call to `qpdf`, `ghostscript`, `pdfinfo`, or PDF schema validator after export. File size is checked (> 1000 bytes) but no structural integrity.
2. **No DOCX text-extraction roundtrip** — No call to extract text from DOCX post-export to verify content preservation (equivalent to `tests/functional/publish.functional.test.mjs` but automated during export, not just in tests).
3. **No missing-image detection** — Markdown references to `![](path/to/image.png)` are never validated; if image does not exist, Pandoc silently omits it or includes a broken reference.
4. **No broken-link detection** — Markdown `[link text](http://example.com)` references are never validated; dead links are embedded as-is.
5. **No font-fallback detection** — PDF is produced but we do not detect whether bundled fonts actually rendered or fell back to system defaults (only a regex search in brand-fonts.mjs, not called during export).

### Visual and rendering fidelity
1. **No screenshot or visual regression testing** — No headless browser rendering of HTML/deck exports; no pixel-diff comparison against golden images or baseline.
2. **No Playwright visual comparisons** — Distribution examples are generated and manually reviewed; no automated screenshot assertion.
3. **No page-count or structural analysis of PDF** — Functional test `extractPdfText()` via pdftotext is test-only; export result does not include page count, heading structure, or TOC verification.

### Broader asset quality
1. **No comprehensive post-export manifest** — Export result does not include metrics: number of rendered figures, text coverage, image count, link count, font names actually embedded.
2. **No roundtrip validation for other formats** — DOCX/PPTX/HTML formats have no text-extraction or structure validation equivalent to pdftotext check.
3. **No image-embedding verification for office formats** — DOCX can contain broken image references or linked (not embedded) images; not detected.

---

## 5. Unconfirmed concerns

1. **Mermaid Chrome/Puppeteer availability** — `mmdc` (mermaid-cli) requires Chrome or Chromium. `resolvePuppeteerExecutable()` searches Playwright cache and system paths, but if Chrome is missing, diagram render silently degrades. The no-op case is detected post-export by `htmlRenderedDiagrams()` / `docxRenderedDiagrams()`, but users see "ensure mmdc is installed" without knowing Chrome is the actual blocker.

2. **D2 dot/graphviz fallback** — D2 can use `dot` (graphviz) as a fallback layout engine. Detection checks for d2 *or* dot (line 245), but user guidance might not be clear if d2 is present but dot is absent and auto-fallback fails.

3. **LibreOffice headless stability** — `convertDocxToDoc()` via `soffice` headless mode can timeout or deadlock. `libreoffice-export.mjs` has error handling, but no validation of the output `.doc` file (file size check only).

4. **Typst compiler safety** — Typst is bundled as a system binary. No version pinning or compatibility checks; if system Typst is too old or too new, export may fail silently or produce unexpected output.

5. **Pandoc Lua filter failures** — If `diagram.lua` has a Lua error or a diagram engine crashes, `code_to_figure()` logs a warning but returns `nil`, leaving the code block in the output. User sees raw source in PDF; no structured error.

6. **HTML embed-resources over size limits** — `--embed-resources` inlines all images and fonts into a single HTML file. Very large diagrams or many images could produce a multi-megabyte HTML file; no size warning.

7. **SVG-to-PDF conversion in diagram.lua** — If diagram engine returns PDF and output is LaTeX, `pdf2svg` is called (line 641–642). SVG conversion tool (`pdf2svg` binary) is not listed in `detect()` requirements; silent failure if not present.

---

## 6. Asset-quality contract opportunities

### 1. PDF validity and metadata contract
Add a post-export PDF validator:
- **Schema**: `{ ok: boolean, valid: boolean, pageCount: number, textExtractable: boolean, fonts: string[], issues: string[] }`
- **Check**: Call `qpdf --check` or `gs -sDEVICE=nullpage` to verify PDF structure.
- **Extract**: Use `pdfinfo` to get page count; `pdftotext` to verify text extraction works.
- **Font scan**: Extract embedded font names from PDF dictionary (parsing `/FontFile` entries).

### 2. Content preservation roundtrip for office formats
Add post-export text-extraction validators:
- **DOCX**: Unzip, extract text from word/document.xml, compare word count or key phrases to source markdown.
- **PPTX**: Unzip, extract text from slide XMLs, verify title and body text present.
- **HTML**: Parse with cheerio/jsdom, extract text content, compare to markdown body.
- **Result shape**: `{ ok: boolean, textExtracted: string, wordCount: number, textRatio: number (0-1), missingPhrases: string[] }`

### 3. Link and image reference validation
Before export, scan markdown:
- Collect all `[](url)` and `![](path)` references.
- For URLs: attempt `HEAD` request (with 2s timeout) or use `tldts` to validate domain.
- For local paths: resolve relative to markdown dir, check file existence.
- Report as structured list: `{ type: 'image'|'link', reference: string, ok: boolean, reason: string }`
- Degrade gracefully: validation errors are advisory, not blocking (unless `--strict` flag).

### 4. Font coverage and fallback detection
Enhance `pdfUsesBundledBrandSans()`:
- After export, scan PDF for all `/FontName` entries in font dictionaries.
- Compare actual fonts to expected (Space Grotesk, JetBrains Mono).
- Report: `{ expected: string[], found: string[], missing: string[], fallback: boolean }`
- Run during export when `branding='construct'`.

### 5. Diagram rendering fidelity manifest
Extend diagram validators to return structured data:
- **`pdfRenderedDiagrams()`** should return `{ rendered: boolean, count: number, embedded: number, rawSource: boolean }` instead of just boolean.
- **Same for DOCX and HTML**: return count details, not just pass/fail.
- **Export result**: Include `figures: { expected: number, rendered: number, missing: string[] }` in result object.

### 6. Screenshot and visual regression baseline (optional, for high-stakes artifacts)
For PDFs marked `classification: confidential` or `status: final`:
- Generate a screenshot of first page via Ghostscript (`gs -sDEVICE=png256 -dFirstPage=1 -dLastPage=1`).
- Compare to optional baseline in `.cx/visual-baselines/<docId>.png`.
- Report as advisory or blocking (per project policy).
- Include pixel hash for automated regression detection.

---

## 7. Render or visual-review requirements

### Current state (confirmed)
- ✓ Diagram rendering is **active**: `--lua-filter diagram.lua` compiles mermaid/d2 via external engines (mmdc, d2 CLI).
- ✓ Diagram validators **detect unrendered source**: if source remains in output, export fails.
- ✓ Text extraction **works for PDF**: `pdftotext` round-trip in functional test confirms text is readable.
- ✗ No visual regression testing: Distribution examples are generated to `.tmp/distribution-examples/` for manual review only.
- ✗ No screenshot assertions: No Playwright, Puppeteer, or headless browser visual comparison.
- ✗ No pixel-diff baselines: No resemble.js or pixelmatch integration.

### To enable rendered-page review
1. **Screenshot generation**: Add optional screenshot step post-export for HTML, PDF (via Ghostscript), PPTX (via LibreOffice headless → PNG).
2. **Baseline storage**: Store golden images in `.cx/visual-baselines/` (optional, project-level).
3. **Regression check**: Use `pixelmatch` or `resemble.js` to compare rendered output to baseline; fail if diff exceeds threshold.
4. **Integration point**: Call post-export validators in `exportMarkdown()` return result; include `visual: { ok: boolean, diff: number, baseline: string }`.

### Manual review workflow (today)
```bash
npm run examples:distribution
open .tmp/distribution-examples/index.html
```
Gallery lists all exports and demo recordings. No automated assertion; reviewer visually inspects PDFs and HTML files.

---

## 8. Tests needed

### Unit tests (document-export.mjs functions)
1. **`pdfRenderedDiagrams()` edge cases**:
   - Empty PDF (no diagrams expected): should return true.
   - PDF with raw diagram source but embedded image: should return false (source presence wins).
   - PDF with no embedded images and no raw source: should return true (no diagrams expected).
   - Malformed PDF: should gracefully return false (try-catch).

2. **`docxRenderedDiagrams()` edge cases**:
   - DOCX with broken zip structure: should return false.
   - DOCX with media/ dir but no rels: should return true if media count ≥ expected.
   - DOCX with rels but no media files: should return false if diagrams expected.

3. **`htmlRenderedDiagrams()` edge cases**:
   - HTML with inline `<svg>`: should return true.
   - HTML with `data:image/png;base64,...`: should return true.
   - HTML with broken `<img src="...">` (missing file): should return true (filter looks for tag, not validity).

### Functional tests (integration)
1. **PDF text extraction**: Extend `publish.functional.test.mjs` to extract and compare more complex structures (headings, bold, lists, tables).
2. **DOCX roundtrip**: Create minimal DOCX, extract text via `unzip + xpath`, compare to source.
3. **HTML parse and extract**: Use cheerio to parse rendered HTML, verify structure (headings, paragraphs, links).
4. **Font coverage**: After PDF export, scan for `/FontName` entries; verify Space Grotesk and JetBrains Mono present if `branding='construct'`.
5. **Missing image/link handling**: Markdown with `![broken](./no-such-image.png)` and `[link](http://dead-domain.invalid)`; export should complete and note unvalidated references.

### Contract tests
1. **Diagram count validation**: Export with varying diagram counts (0, 1, 5, 10); assert rendered count matches expected in result.
2. **Branding application**: Export same markdown with `branding='construct'` and `branding='plain'`; diff results (template application, fonts).
3. **Optional template graceful degradation**: Remove construct-reference.docx, export DOCX; should succeed with default pandoc styling.

---

## 9. Docs needed

### User-facing
1. **Export quality assurance checklist**: `docs/guides/cookbook/export-quality-validation.md`
   - What validators run automatically (diagram rendering, file size).
   - What requires manual review (PDF readability, HTML layout, font rendering).
   - How to use `construct tools detect` before export.
   - Common failures and remediation (Chrome missing for Mermaid, d2 not installed).

2. **Font and branding in exports**: Expand `docs/guides/reference/branding.md`
   - Bundled font paths and fallback behavior.
   - How to verify fonts rendered: `grep -a "Space Grotesk\|JetBrains" output.pdf`.
   - Offline vs. online font loading in HTML (Google Fonts CDN vs. embedded).

3. **Diagram rendering at export**: `docs/guides/cookbook/diagram-and-demo.md` (update)
   - Explicit statement: `--figures` enables rendering, not filtering.
   - Mermaid requires Chrome/Puppeteer; D2 requires graphviz or d2 binary.
   - Post-export validation checks; what "diagram rendering failed" means and how to debug.

### Maintainer-facing
1. **Export pipeline architecture**: `docs/guides/concepts/architecture.md` (add section)
   - Diagram.lua filter flow (CodeBlock → engine.compile → mediabag → Image/Figure).
   - Post-export validators (expectations, limitations, regex patterns used).
   - Where quality checks run (pre-export detection, post-export validation, test-only).

2. **Asset quality contract**: `docs/development/contracts/export-asset-quality.md` (new)
   - Define what "successful export" means: file exists, size > 0, diagrams rendered (when expected).
   - Define what is out-of-scope: PDF validity, font rendering, layout fidelity (manual review).
   - Outline future validators (link checking, image-existence checking, text roundtrip).
   - Traceability to ADR-0024 (optional external tooling, graceful degradation).

3. **Diagram engine configuration**: `docs/development/configuration/diagram-engines.md` (new)
   - D2 theme, scale, sketch mode, font size env vars (consumed by diagram-export.mjs).
   - Mermaid Puppeteer config (templates/distribution/mermaid-puppeteer.json).
   - How to override engine paths (D2_BIN, MMDC_BIN, PUPPETEER_EXECUTABLE_PATH).

---

## 10. Dependency and degradation concerns

### External binaries (runtime discovery)
- **Pandoc** (required for export): GPLv2+, statically-linked, no system deps. Discovered at runtime, graceful absence message.
- **Typst** (required for PDF): Apache-2.0, single binary, no system deps. Same discovery.
- **D2** (optional for diagrams): Apache-2.0, single binary. Fallback: graphviz `dot` (EPL-1.0).
- **Mermaid-cli (mmdc)** (optional for diagrams): MIT, npm package. Requires Chrome/Puppeteer runtime (auto-discovered).
- **LibreOffice (soffice)** (optional for .doc export): MPL-2.0, system binary. Fallback: none (export fails with no fallback path).
- **pdfinfo / pdftotext** (test-only for validation): Part of Poppler (GPL), system binary. Not required for export.

### Degradation paths
1. **Diagram rendering unavailable** (no d2, no mmdc, no Chrome):
   - If `--figures` and diagram source present: export fails with structured error naming missing tools.
   - If `--figures` not set or no diagrams: export succeeds (diagrams never attempted).

2. **PDF template missing** (construct-pdf.typ deleted):
   - Branded PDF export fails with error "bundled PDF template missing" (not silent).
   - Plain PDF export via `branding='plain'` succeeds with Pandoc defaults.

3. **Reference doc missing** (construct-reference.docx deleted):
   - DOCX export succeeds (Pandoc defaults, no styled output).
   - Not a failure; graceful downgrade.

4. **Fonts missing** (SpaceGrotesk-Variable.ttf or JetBrains Mono deleted):
   - PDF export via Typst will fail if font path is enforced and file absent.
   - Current behavior: unclear (Typst may error, or use fallback; not tested).
   - **Risk**: Silent font fallback could go undetected.

5. **Chrome missing for Mermaid**:
   - `mmdc` requires Chrome. If PUPPETEER_EXECUTABLE_PATH not set and Chrome not found, diagram rendering fails.
   - Error message is from mmdc, not contextualized by Construct.
   - Actual error is often cryptic (Puppeteer launch error) rather than "Chrome missing."

### Tight coupling risks
- **Lua 5.3 in Pandoc** (diagram.lua requires Pandoc 3.x with Lua): If Pandoc is too old or Lua disabled, filter fails silently (code block returned as-is).
- **SVG-to-PDF conversion** (diagram.lua line 641–642): Uses external `pdf2svg` tool, not listed in `detect()`. If absent and PDF diagram is generated, conversion fails silently and SVG is returned instead.
- **Pandoc markdown preprocessing** (preprocessMarkdownDiagrams): Injects %%{init:...} blocks; if Mermaid version does not support init block syntax, diagram render fails after preprocessing.

---

## 11. Questions for Opus

1. **Are there known failure modes in Mermaid or D2 diagram rendering that we should proactively detect?** (e.g., unsupported diagram syntax, recursion limits, timeout).

2. **Should export validation extend to link-checking?** Currently no network calls or DNS checks. Should we add a `--validate-links` flag that performs shallow checks (HEAD requests, domain validity)?

3. **For DOCX exports, is there value in a roundtrip text-extraction check (extract text post-export and compare to source word count)?** This would be a safety net but adds ~500ms per DOCX export.

4. **Should we add a `construct export --dry-run` mode that returns structured detection and validation without actually writing files?** Useful for CI scripts and error early-binding.

5. **For the diagram.lua filter, should we add an option to return unrendered diagrams as fallback images (e.g., a placeholder PNG) instead of source code?** Currently, unrendered diagrams stay as text; a visual "error box" might be better UX.

6. **Should the distribution examples gallery (`scripts/generate-distribution-examples.mjs`) run post-export validators and report metrics (figure count, text extraction, font coverage)?** Today it's view-only; data-driven review could catch regressions.

7. **Is there a compliance requirement to validate PDF accessibility (tags, alt text for images)?** Not currently checked; Typst may support PDF/A or tagged PDF mode.

---

## 12. Suggested bead updates

### New beads for quality gaps
1. **`construct-qaZ1` — Post-export PDF validation (size, structure, font coverage)**
   - Scope: Add `detectPdfQuality()` function + tests.
   - Add qpdf or gs call to verify PDF structure; extract page count and font names.
   - Call from `exportMarkdown()` when format='pdf' and `figures=true`.
   - Return as optional result metadata.

2. **`construct-qaZ2` — Content preservation roundtrip for office formats**
   - Scope: Implement text-extraction validators for DOCX, PPTX, HTML.
   - Add `extractDocxText()`, `extractPptxText()`, `extractHtmlText()` functions.
   - Compare word count or key phrases to source; return as result metadata.
   - Optional flag: `--validate-roundtrip` (off by default, adds 500ms+ per export).

3. **`construct-qaZ3` — Link and image reference validation**
   - Scope: Pre-export markdown scanner for broken references.
   - Collect all `[](url)` and `![](path)` before sending to Pandoc.
   - Resolve local paths; attempt HEAD requests for HTTP(S) URLs (2s timeout, no-block).
   - Return advisory list in result; log warnings but do not fail export.
   - Tied to `--check-references` flag.

4. **`construct-qaZ4` — Font coverage verification in PDF**
   - Scope: Extract and report fonts from PDF post-export.
   - Verify bundled fonts present when `branding='construct'`.
   - Report fallback fonts or missing fonts in result.
   - Run automatically for branded PDFs.

5. **`construct-qaZ5` — Distribution examples quality report**
   - Scope: Extend `scripts/generate-distribution-examples.mjs`.
   - After each export, run post-export validators.
   - Collect metrics: diagram count, text extraction, font coverage.
   - Output to `.tmp/distribution-examples/quality-report.json`.
   - Update gallery index to show metrics (pass/fail, counts).

### Enhancements to existing beads
6. **`construct-yrdd` (Document export capability) — Add post-export validation to contract**
   - Clarify what happens when diagrams fail to render (structured error, no-op behavior).
   - Document diagram.lua Lua filter limitations (no error recovery, `nil` return leaves source).
   - Add section on out-of-scope quality checks (PDF accessibility, link validity, layout fidelity).

7. **`construct-i1mt` (Document I/O research) — Update research brief with validation findings**
   - Note that export-time validation is diagram-only.
   - Highlight missing validators (PDF structure, font coverage, link checking).
   - Suggest that "successful export" in ADR-0024 could be more formally defined.

---

## References

- **lib/document-export.mjs** — Main export entry point and post-export validators.
- **lib/diagram-export.mjs** — Diagram preprocessing and environment configuration.
- **vendor/pandoc-ext/diagram.lua** — Pandoc Lua filter for diagram rendering.
- **lib/export-branding.mjs** — Branding policy routing per format.
- **lib/brand-fonts.mjs** — Bundled font paths and PPTX embedding.
- **templates/distribution/construct-web.html** — Branded HTML template with CSS brand tokens.
- **docs/guides/reference/document-io.md** — User documentation (engines, formats, fidelity).
- **docs/guides/reference/branding.md** — Brand contract (typography, colors, enforcement).
- **docs/decisions/adr/0024-document-io-optional-capability.md** — ADR establishing optional external tooling.
- **tests/functional/document-export.functional.test.mjs** — Export contract tests.
- **tests/functional/publish.functional.test.mjs** — Publish and text-extraction tests.
- **tests/export-branding.test.mjs** — Branding policy tests.
- **scripts/generate-distribution-examples.mjs** — Distribution gallery generator.
- **examples/distribution/manifest.json** — Example sources and output formats.
