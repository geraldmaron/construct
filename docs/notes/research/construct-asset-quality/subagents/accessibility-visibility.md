---
intake: none
---

# Subagent Evidence Report: Accessibility & visibility

## 1. Summary

Construct applies **structured accessibility guidance** through skills (designer.accessibility.md, frontend-design accessibility.md) and enforces one binary postcondition that designers must document accessibility checks. However, **no automated checks run on generated artifacts** (PDFs, DOCX, PPTX, HTML, deck) for contrast, alt text, font size, heading hierarchy, or screen-reader accessibility. Guidance documents are human-facing; enforcement is postcondition-only (document that you checked). Visual requirements in artifact-manifest are diagram-only (mermaid presence, table structure). Tests verify layout overflow and bounds but not readability, visibility, or assistive-tech compatibility.

## 2. Evidence table

| Finding | Evidence file | Evidence | Confidence |
|---------|---------------|----------|------------|
| Accessibility guidance exists but is not automated | skills/roles/designer.accessibility.md, skills/frontend-design/accessibility.md | ~55 lines each covering WCAG 2.1 AA, keyboard, screen readers, contrast, motion, semantic HTML, ARIA rules | High |
| Alt-text check exists for markdown source only | lib/templates/doc-presentation.mjs:49 | `if (/!\[\s*\]\(/.test(body)) errors.push('image missing alt text');` — checks markdown ![](url) syntax for empty alt | High |
| No contrast ratio enforcement on generated artifacts | lib/document-export.mjs, lib/deck-export-pptx.mjs | No mention of contrast, wcag, APCA, or color ratio checks; doc-presentation linter does not validate rendered PDFs or PPTX | High |
| No font-size minimum enforcement in exports | lib/deck-export-pptx.mjs:45–60, construct-web.html:28–75, construct-deck.html:27–78 | Font sizes hardcoded (slideTitle=20pt, h1=40px, body=22px) but no audit checks that they meet WCAG AA minimum (12px for body text, 14pt bold) | High |
| Heading hierarchy not validated in exports | lib/templates/doc-presentation.mjs, construct-web.html, construct-deck.html | Markdown structure checked for h1 count and blank lines before h2; no checks on rendered heading order, nesting, or semantic hierarchy post-export | High |
| Table accessibility has structure checks only | specialists/artifact-manifest.json: visualRequirements for prd/adr/rfc include `artifact-table-has-columns` | Checks table presence and column names exist; no checks on table headers, scope attributes, row/col association, or readability (cell density, line wrap) | High |
| Reading order not verified in PDFs/PPTX/HTML | lib/document-export.mjs, lib/deck-export-pptx.mjs | No reading order audit, tab order test, or logical flow verification in generated formats | High |
| Screen-reader output not tested | tests/, tests/functional/ | No imports of screen-reader libraries (NVDA, JAWS, VoiceOver simulators); no aria-label, aria-describedby, aria-live, or alt text validation | High |
| ARIA and semantic HTML usage not enforced | lib/deck-export-pptx.mjs, construct-web.html, construct-deck.html | Templates emit standard HTML5 (header, main, section, table, figure, figcaption) but no audit that ARIA is not over-applied and semantics are preferred | Medium |
| Image visibility (opacity, clipping, overflow) not checked | lib/deck-export-pptx.mjs:1002–1019 (image display), construct-web.html:68–71 (figure styling), construct-deck.html:70–71 | Images displayed with max-width/max-height and object-fit, but no audit of: (a) rendered dimensions, (b) edge clipping, (c) alt text presence for each image, (d) visibility against background | Medium |
| Animated content (prefers-reduced-motion) not enforced in exports | construct-web.html, construct-deck.html | No CSS media query for `prefers-reduced-motion` in templates; deck HTML uses CSS transitions and animations but doesn't respect reduced-motion preference | Medium |
| Hidden/clipped text not detected in exports | lib/deck-export-pptx.mjs:103–112 (clampBox), lib/deck-export-pptx.mjs:373–396 (bounds audit) | Post-export audit (`auditPptxFile`) flags horizontal/vertical overflow but does not check for deliberately hidden text (aria-hidden, visibility:hidden, clip-path without disclosure) | Medium |
| Cognitive load (plain language, consistent navigation) not validated in artifacts | lib/artifact-release-gate.mjs, skills/frontend-design/accessibility.md | Skills document cognitive load best practices (grade 8 reading level, predictable behavior, clear errors); release gate checks prose count and structure but not readability or language complexity | Low |
| Color-only meaning not flagged | lib/templates/doc-presentation.mjs, construct-brand.typ, brand-tokens.mjs | No check that information is not conveyed by color alone; brand uses ink-ramp tokens but no audit that contrasting shapes/patterns/text accompanies color coding | Low |

## 3. Existing mechanisms

### Guidance (human-facing, not enforced)
- **skills/roles/designer.accessibility.md** (~55 lines): anti-patterns (visual-only, ARIA-as-patch, automated-only testing, motion without controls), methodology (test with real screen reader, keyboard-only, POUR principles, 2x zoom + reduced-motion)
- **skills/frontend-design/accessibility.md** (~155 lines): WCAG 2.1 AA baseline, semantic HTML, ARIA rules, keyboard navigation, contrast ratios (4.5:1 body, 3:1 large text / UI components), motion (prefers-reduced-motion), images/media, forms, cognitive load
- **templates/docs/accessibility-audit.md**: template for cx-accessibility specialist to document manually audited flows; has checklist but is a template, not enforcement

### Enforcement in authored markdown source
- **lib/templates/doc-presentation.mjs:49**: `lintDocPresentation()` flags `![](missing-alt)` (empty alt text in markdown)
- **lib/templates/doc-presentation.mjs:14–15**: flags multiple H1 headings
- **lib/templates/doc-presentation.mjs:36–39**: flags missing blank line before H2
- **lib/templates/doc-presentation.mjs:42–45**: warns on flowcharts without error/rollback path

### Enforcement in generated artifacts (export outputs)
- **lib/deck-export-pptx.mjs:249–319** (`auditDeckMarkdownLayout`): pre-export audit checks slide vertical budget (content fits in SLIDE_CONTENT_BUDGET_IN = 3.175 inches), warns on text >200 chars, flags table cells needing >5 wrapped lines
- **lib/deck-export-pptx.mjs:338–402** (`auditPptxFile`): post-export PPTX audit checks slide size, flags unresolved [object Object] in text, detects `<a:graphicData>` native tables, scans shape bounds for horizontal/vertical overflow past safe area
- **lib/document-export.mjs:126–136** (`docxRenderedDiagrams`): verifies diagrams were rasterized (checks for raw Mermaid/d2 source in output), counts media entries

### Postconditions (binary gate)
- **lib/specialists/postconditions.mjs**: `cx-designer` producer must set `accessibilityCheckRan: true` to pass; no details checked, only presence of flag
- **tests/postconditions.test.mjs:120–129**: tests the binary postcondition

### Contract/manifest visual requirements (diagram-only)
- **specialists/artifact-manifest.json** visualRequirements: PRD/ADR/RFC require mermaid diagrams (artifact-has-mermaid check) and tables with specific column names (artifact-table-has-columns check); no contrast, alt text, or heading hierarchy checks

### Templates (HTML/CSS, no a11y enhancements)
- **templates/distribution/construct-web.html**: semantic HTML5 (header, main, table, figure), but:
  - No skip-to-main link
  - No heading landmark roles
  - Figure images are width-capped and height-capped via CSS but have no alt-text validation
  - No lang attribute on html tag
  - No aria-label on masthead sections
  - Link underline visible but no focus outline enhancement
- **templates/distribution/construct-deck.html**: similar structure, no skip link, no aria-live for slide transitions, animations/transitions present but no prefers-reduced-motion media query

## 4. Confirmed gaps

1. **No automated contrast checking** on rendered PDFs, PPTX, DOCX, HTML, or deck outputs. Contrast ratios are mandated in guidance but never measured.
2. **No alt-text validation on rendered images**. Markdown source is checked for empty alt, but (a) alt text correctness is not validated, (b) rasterized diagrams in PDFs/PPTX/DOCX have no alt text assigned, (c) decorative-vs-informative classification is not checked.
3. **No font-size audit** in exports. Hardcoded sizes (slideTitle=20pt, h1=40px) are not verified to meet WCAG AA minimum.
4. **No heading hierarchy validation** post-export. Markdown h1/h2/h3 are checked in source but rendering/tag nesting in HTML/PDF is not audited.
5. **No screen-reader compatibility testing**. No accessible name, role, value assertions; no live-region checks; no form-label associations validated in output.
6. **No reading order audit**. Tab order, logical flow, and focus management not verified in generated artifacts.
7. **No prefers-reduced-motion support** in HTML/deck templates. CSS animations present without media query.
8. **No table accessibility checks** beyond column-name presence. Row/col scoping, header association, cell density not audited.

## 5. Unconfirmed concerns

1. **Color-only conveyance**: Brand ink-ramp uses color tokens exclusively; no audit that shapes, patterns, or text alternatives accompany color-coded information (e.g., if a chart uses red for "fail", is "fail" also written?). Unverified.
2. **Image clipping/overflow**: Deck export bounds audit flags horizontal/vertical overflow; unclear if images specifically are checked for partial rendering or if text-shape clipping alone is caught. Unverified.
3. **Complex images (charts, diagrams)**: Guidance mentions `aria-describedby` for complex images; unclear if mermaid/d2 diagram captions or long-descriptions are captured post-rasterization. Unverified.
4. **Form accessibility in PPTX**: No forms in PPTX; unclear if HTML decks with optional interactive elements would respect fieldset/legend/aria-required. Unverified.
5. **Cognitive load**: Guidance cites grade-8 reading level; release gate checks prose count only, not readability scores (Flesch-Kincaid, etc.). Unverified.

## 6. Asset-quality contract opportunities

1. **Rendered artifact contrast audit**: Post-export validation for PDF/PPTX/DOCX that scans foreground/background color pairs against WCAG AA thresholds (4.5:1 body, 3:1 large text, 3:1 UI components). Tool: pdfjs + APCA or axe DevTools rendering engine.
2. **Alt-text coverage and quality check**: For each image in rendered output, verify alt text is present and non-empty; optionally score quality (presence of descriptive nouns/verbs, not "image of"). Requires mapping markdown alt to rasterized images or embedding alt in diagram metadata.
3. **Font-size minimum enforcement**: Audit rendered PDFs and PPTX for text <12px (body) / <14px (large). Tool: PDF text-layer parsing or pptxgenjs metadata.
4. **Heading hierarchy and semantic validation**: Post-render check that h1 > h2 > h3 nesting is preserved, no skips (h1 → h3), and heading elements are not used for styling. Tool: pandoc/pptxgenjs metadata or DOM inspection for HTML.
5. **Screen-reader automation** (light touch): Validate HTML exports for:
   - All interactive elements have accessible names (aria-label or text content)
   - Form fields have associated labels (`<label for>` or aria-labelledby)
   - Images have alt text (enforced per #2)
   - Tables have `<thead>` and scope attributes
   - No important content hidden with aria-hidden or visibility:hidden
   - Live regions exist for dynamic content (not applicable to static exports, low priority)
6. **Reading order and focus management**: For HTML/deck exports, validate tab order matches visual order, no focus traps, no focusable elements without visible focus indicator. Tool: axe-core library.
7. **Prefers-reduced-motion support**: Add `@media (prefers-reduced-motion: reduce)` to HTML templates, disable animations for PPTX if user preference can be inferred (lower priority for static formats).
8. **Color-only meaning detection**: Heuristic check that color is not the only way to convey information; paired with shapes, patterns, or text labels. Tool: manual rubric or ML-based image analysis (high complexity).

## 7. Render or visual-review requirements

1. **Pixel-accurate contrast measurement**: Requires rendering at output resolution (96 dpi for screen, 300 dpi for print) and color-space–aware foreground/background sampling. APCA (Advanced Perceptual Contrast Algorithm) recommended over WCAG 2 formulas for accuracy.
2. **Alt-text OCR/caption extraction**: If diagrams are rasterized, alt-text must be embedded in image metadata (EXIF, PDF image XObject Dict) or reconstructed from source markdown. Current flow loses alt on diagram rasterization.
3. **Font-size rendering context**: pptxgenjs internal point sizes don't map 1:1 to rendered pixels; audit must measure actual rendered height in target format (PDF, PPTX).
4. **Screen-reader simulation**: Static exports cannot fully simulate screen-reader behavior (dynamic updates, focus management matter only for interactive artifacts). Audit should cover: accessible names, roles, values, and logical reading order only.

## 8. Tests needed

1. **contrast.test.mjs**: Sample PDFs at 96/150/300 dpi, extract text color and background, compute WCAG AA and APCA ratios, flag violations.
2. **alt-text-coverage.test.mjs**: Parse PDF/PPTX/HTML for images; verify alt text presence; for diagrams, cross-reference markdown source metadata.
3. **font-size-audit.test.mjs**: Measure rendered text height in PDFs and PPTX; flag pixels <12 (body) / <14 (large).
4. **heading-hierarchy.test.mjs**: Parse HTML/PDF heading tags; verify nesting (no skips), semantic ordering, and count per level.
5. **html-a11y-base.test.mjs**: Run axe-core on HTML exports; verify no violations (images, forms, landmarks, color contrast, focus).
6. **screen-reader-accessible-names.test.mjs**: Check all interactive elements have accessible names; form labels associated; tables have headers.
7. **prefers-reduced-motion.test.mjs**: Inspect HTML/CSS in templates; verify `@media (prefers-reduced-motion: reduce)` present and honored.

## 9. Docs needed

1. **docs/guides/concepts/asset-accessibility-and-visibility.md**: Overview of what accessibility checks run on authored markdown vs. generated outputs. Link to WCAG 2.1 AA baseline and Construct-specific thresholds (font sizes, contrast, heading hierarchy).
2. **docs/operations/quality/accessibility-audit-checklist.md**: Companion to templates/docs/accessibility-audit.md; manual walkthrough for cx-accessibility specialist: flows to test, tools to use (VoiceOver, NVDA, axe), what "pass" means per WCAG criterion.
3. **docs/guides/reference/export-accessibility-surface-area.md**: What accessibility checks are automated during export (layout, bounds, diagram rasterization) vs. manual (contrast, alt-text quality, screen-reader testing). Document gaps and remediation plan.
4. **Update skills/roles/designer.accessibility.md**: Add subsection "Construct-enforced checks" linking to asset-quality contract; clarify which anti-patterns are caught by automation vs. manual review.

## 10. Dependency and degradation concerns

1. **Diagram metadata loss**: When d2/mermaid diagrams are rasterized to PNG/SVG in PDF/PPTX/DOCX, source diagram metadata (flowchart direction, labels, connections) is lost. Alt-text generated from source markdown is not automatically embedded in rendered images. Manual fallback: embed alt text in Pandoc metadata or PPTX speaker notes.
2. **Font fallback**: Templates use Google Fonts (Space Grotesk, JetBrains Mono) via CDN; if CDN fails, browser falls back to system fonts. No test of fallback rendering or contrast in degraded scenario.
3. **PDF text-layer accuracy**: Typst-rendered PDFs must include a text layer for screen readers. Verify that Typst templates include text-layer output; some PDF engines can render visually but omit selectable text.
4. **PPTX screen-reader support**: pptxgenjs-generated PPTX files are readable by screen readers only if shapes have alt-text assigned. Current code does not set pptxgenjs shape alternative text. Regression risk if pptxgenjs versions change.
5. **HTML template updates**: construct-web.html and construct-deck.html are static templates filled by Pandoc; changes to templates require manual testing of rendered HTML in screen readers and contrast validators. No CI hook runs axe-core on the template output.

## 11. Questions for Opus

1. **Priority ranking**: Which gaps (alt-text, contrast, font-size, heading hierarchy, screen-reader compatibility) should be addressed first? Should we start with HTML exports (lower complexity, higher reach) or PPTX (highest user-facing impact)?
2. **Contrast tolerance**: Should we enforce WCAG 2.1 AA (4.5:1 body, 3:1 large) or adopt WCAG 2.2 AA AAA (7:1 body)? Construct brand inks may not meet 7:1; should we flag or adjust tokens?
3. **Diagram alt-text strategy**: For d2/mermaid → PNG flow: (a) embed source markdown alt in PNG EXIF/XML, (b) require manual caption in markdown, (c) generate captions from diagram AST (complex)? Recommend approach?
4. **Screen-reader testing scope**: Should we simulate VoiceOver/NVDA on HTML exports only, or include PPTX (lower priority)? Existing tools (axe-core, jest-axe, playwright a11y) cover HTML; PPTX testing is limited.
5. **Reduced-motion**: Should we disable animations in HTML templates for all users (simplest) or respect prefers-reduced-motion and ship two variants (more complex, better UX)? Recommendation?

## 12. Suggested bead updates

1. **Create audit/implement-artifact-contrast-checking**: Implement post-export contrast audit (PDF/PPTX/HTML). Estimate 2–3 weeks. Depends on contrast.test.mjs and decision on APCA vs. WCAG 2.
2. **Create audit/validate-alt-text-in-exports**: Map markdown alt to rasterized diagrams in PDF/PPTX/DOCX, verify presence. Estimate 1–2 weeks. Requires diagram metadata strategy.
3. **Create audit/enforce-minimum-font-size**: Measure rendered text height; flag <12px body, <14px large. Estimate 1 week.
4. **Create audit/heading-hierarchy-validation**: Parse rendered heading tags; verify nesting and order. Estimate 3–5 days.
5. **Create audit/html-export-a11y-baseline**: Run axe-core on HTML templates; fix violations (landmarks, focus, color contrast, images). Estimate 1–2 weeks.
6. **Create docs/asset-accessibility-and-visibility**: Write overview and checklist. Estimate 2–3 days.
7. **Create quality-gate/prefers-reduced-motion**: Add media query to HTML templates, wire to decorator. Estimate 2–3 days.

---

**Report compiled**: 2026-06-29 by Construct Accessibility & Visibility Audit Subagent (Agent H).
