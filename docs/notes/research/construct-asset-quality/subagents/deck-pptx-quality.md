# Subagent Evidence Report: Deck / PPTX quality

## 1. Summary

Deck export via `lib/deck-export-pptx.mjs` implements a two-tier safety model: pre-export markdown layout audit (fail-closed) and post-export PPTX XML bounds audit. Pre-export checks vertical overflow, table cell wrap limits, and text density. Post-export checks slide dimensions, shape overflow (horizontal/vertical), and XML integrity. **No pre-export font-size floor check exists; no visual rendering or screenshot review is performed; text wrapping and callout/card density constraints are heuristic-only and lack explicit rubrics.** Footer/header clipping is partially guarded by bounds checks but no explicit guards for header-band overlap with content.

## 2. Evidence table

| Finding | Evidence file | Evidence | Confidence |
|---------|---------------|----------|------------|
| Pre-export audit runs on all deck exports | `lib/deck-export-pptx.mjs:1046` | `const layout = auditDeckMarkdownLayout(source, metadata);` blocks export if `layout.ok === false` | high |
| Pre-export audit checks vertical overflow | `lib/deck-export-pptx.mjs:308–313` | `if (y > SLIDE_CONTENT_BUDGET_IN + 0.02) { slideIssues.push({ code: 'vertical_overflow', ... })` | high |
| Pre-export audit checks table cell wrap | `lib/deck-export-pptx.mjs:277–282` | `if (lines > 5) { slideIssues.push({ code: 'table_cell_wrap_excess', ... })` | high |
| Pre-export audit checks text density paragraph | `lib/deck-export-pptx.mjs:288–292` | `if (block.type === 'text' && cellPlainLength(block.text) > 200) { slideIssues.push({ code: 'text_dense', ... })` | high |
| Pre-export audit checks ink-panel height | `lib/deck-export-pptx.mjs:298–305` | `if (layout.mode === 'ink-panel') { ... if (panelBottom > SLIDE_CONTENT_BUDGET_IN * 0.55) { slideIssues.push({ code: 'panel_tall', ... })` | high |
| Post-export audit runs after PPTX write | `lib/deck-export-pptx.mjs:338–403` | `export function auditPptxFile(pptxPath)` — reads unzipped PPTX XML and scans shapes for overflow | high |
| Post-export audit checks horizontal overflow | `lib/deck-export-pptx.mjs:390–391` | `if (right > safeRight + tol) { issues.push({ slide: slideNum, code: 'horizontal_overflow', ... })` | high |
| Post-export audit checks vertical overflow | `lib/deck-export-pptx.mjs:393–394` | `if (bottom > contentMax + tol) { issues.push({ slide: slideNum, code: 'vertical_overflow', ... })` | high |
| Post-export audit checks unresolved rich text | `lib/deck-export-pptx.mjs:365–367` | `if (xml.includes('[object Object]')) { issues.push({ slide: slideNum, code: 'unresolved_rich_text', ... })` | high |
| No pre-export font-size floor check | `lib/deck-export-pptx.mjs:49–60, 163–172` | Typography sizes defined (`T.micro: 8`, `T.body: 11`) but no pre-export audit enforces minimum; table font size floors at 9pt only at render time | high |
| No visual rendering or screenshot review | `lib/deck-export-pptx.mjs` entire file + `tests/deck-export-pptx.test.mjs`, `tests/functional/deck-export.functional.test.mjs` | No screenshot generation, no headless render to image, no pixel-level visual QA; tests assert only on file size, bounds, and markdown audit pass | high |
| Table font size calculation is heuristic | `lib/deck-export-pptx.mjs:163–173` | Font size picked by text length only (`maxLen > 72 → 9pt`); no explicit check for readability or column width adequacy | high |
| Callout/card density has no explicit rubric | `lib/deck-export-pptx.mjs:908–970` (addListCards) | Cards laid out greedily; `estimateListHeight` sums card heights but no check for bullet count, density per slide, or minimum spacing between cards | high |
| Line height and wrap estimation matches render | `lib/deck-export-pptx.mjs:99–100, 195–196` | Comment at line 195–196: "Single source of truth for row heights so the pre-export audit and the render agree." Formula: `fontSize * 1.45 / 72` inches | high |
| Footer band position is defined but not explicitly guarded in pre-export | `lib/deck-export-pptx.mjs:30–33` | `FOOT_Y = H - FOOT_BAR_H - 0.34` (footer at 5.2 in from top on 5.625 in slide); `CONTENT_MAX_Y = FOOT_Y - 0.1` (content must stop at 5.06 in) | high |
| Header band (title, rule) position is implicit | `lib/deck-export-pptx.mjs:32, 982–988` | `CONTENT_TOP = 1.02 in`; heading rule at `MY + 0.44 = 0.85 in`; no pre-export check prevents content overlap with heading region | medium |
| Text wrapping formula uses character-per-inch heuristic | `lib/deck-export-pptx.mjs:85–88` | `factor = mono ? 0.52 : 0.68` chars/point; no user-visible wrapping preview or line-break validation | high |
| Test fixtures pass post-export bounds audit | `tests/deck-export-pptx.test.mjs:57–58` | `const bounds = auditPptxFile(out); assert.equal(bounds.ok, true, ...)` on golden fixture | high |
| Oversized table is caught pre-export | `tests/deck-export-pptx.test.mjs:67–75` | Test "oversized table is rejected by the pre-export audit (fail-closed)" confirms vertical overflow detection | high |
| No explicit test for footer clipping | `tests/deck-export-pptx.test.mjs`, `tests/functional/deck-export.functional.test.mjs` | Tests assert `auditPptxFile(out).ok === true` but no specific test case for footer-band collision or header overlap | medium |
| No test for readability thresholds (font size, bullet density) | `tests/deck-export-pptx.test.mjs`, `tests/functional/deck-export.functional.test.mjs` | Tests do not verify minimum font sizes, maximum bullets per slide, or bullet readability metrics | high |
| Deck HTML export uses pandoc, not pptxgenjs | `lib/deck-export-pptx.mjs:1–2, 6–7; docs/guides/reference/document-io.md:88` | PPTX export is branded via pptxgenjs + brand-tokens; HTML deck is separate (Pandoc → construct-deck.html template) | high |

## 3. Existing mechanisms

1. **Pre-export markdown layout audit** (`auditDeckMarkdownLayout`, lines 249–320):
   - Parses markdown into blocks (heading, text, bullet, number, table).
   - Estimates block heights using wrapping and line-height formulas.
   - Checks vertical overflow (total estimated height vs. `SLIDE_CONTENT_BUDGET_IN = 3.27 in`).
   - Checks table cell wrap (lines per cell; flags if > 5).
   - Checks text paragraph density (flags if > 200 chars plain).
   - Checks ink-panel height (special layout mode for branded slides).
   - Returns `{ ok, issues, slides }` and **blocks export if `ok === false`**.

2. **Post-export PPTX XML bounds audit** (`auditPptxFile`, lines 338–403):
   - Unzips exported PPTX file.
   - Reads `ppt/presentation.xml` to extract slide dimensions.
   - Scans `ppt/slides/slide*.xml` for shape boxes (via regex `<p:sp>` elements).
   - Checks slide size matches expected 16:9 (10 in x 5.625 in).
   - Checks for unresolved rich text (`[object Object]` in XML).
   - Checks for native table elements (notes they lack cell wrap).
   - Checks shape bounds for horizontal/vertical overflow (tolerance: 0.03 in).
   - Skips shapes outside content band (header above `CONTENT_TOP - bandPad`, footer above `FOOT_Y - bandPad`).

3. **Rendering logic** (lines 972–1020, addContentSlide):
   - Parses blocks and lays out shapes via pptxgenjs API.
   - Adds title, heading rule, callout cards, list cards, tables.
   - Uses pre-computed widths and heights to avoid overflow.
   - `clampBox` enforces bounds at render time (lines 103–112).

4. **Font sizing logic**:
   - Typography size tokens defined from brand-tokens (line 49–60).
   - Table font size function (lines 163–173) picks 9pt for long cells.
   - List item font size (lines 827–832) picks small (T.small) for long items.
   - **No floor enforcement** on minimum point size in pre-export.

5. **Height estimation functions** (lines 114–243):
   - `textBoxHeight(text, widthIn, fontSize, padding)` — estimates box height for wrapped text.
   - `lineHeightIn(fontSize)` — line spacing formula `fontSize * 1.45 / 72`.
   - `wrappedLineCount(text, colWidthIn, fontSize, mono)` — estimates line count based on char-per-inch heuristic.
   - `estimateBlockHeight(block, layout)` — sums up total height per slide.

## 4. Confirmed gaps

1. **No pre-export minimum font-size validation**: Typography sizes down to 8pt (T.micro) are defined but never checked for readability. Table font size can only be 9–11pt based on content length, but a markdown audit could enforce "no font below Xpt" as a policy constraint.

2. **No visual rendering / screenshot review**: The export pipeline generates a PPTX binary and validates its XML bounds, but never renders slides to an image for human review or pixel-level QA. This means visual alignment issues (e.g., kerning, baseline misalignment, anti-aliasing) are invisible to tests.

3. **No explicit bullet-density rubric**: Pre-export checks individual list item lengths but not total bullet count per slide or spacing between cards. A dense bullet slide could pass all checks and still be hard to read.

4. **Footer-band overlap detection is implicit**: Post-export bounds checks catch overflow past `CONTENT_MAX_Y`, but no pre-export check explicitly guards the 0.1 in buffer between content and footer bar (line 33). If a shape lands at exactly `CONTENT_MAX_Y`, it may be cut off or visually compressed.

5. **Header-band collision is not checked**: The heading region (title at `MY = 0.41 in`, rule at `MY + 0.44 = 0.85 in`) sits in a fixed area; if a rare custom layout places content within this band, there's no pre-export guard. Post-export bounds skip this band entirely (line 386), so collision would be silent.

6. **Text wrapping uses character-per-inch heuristic**: Formula assumes monospace = 0.52 chars/pt and sans = 0.68 chars/pt. This is a guess; actual wrapping depends on font metrics, kerning, and rendering engine. No visual validation confirms wrapping matches markdown expectations.

7. **No callout/card padding constraints**: Callouts and cards use fixed padding (e.g., `CARD_PAD = 0.11 in`), but no audit checks that padding is not too tight (leading to unreadable text) or cascades of cards are not too tall.

8. **Table readability constraints are weak**: `tableFontSize()` picks size by content length only; no check for column count (e.g., 6+ columns in 10 in width → insufficient space per column), minimum column width, or row-height uniformity.

9. **No regression test for visual fidelity**: Tests check file size, bounds, and markdown audit pass, but not that a "before and after" render of the same markdown yields identical layout. This means a refactor to height or width calculations could introduce subtle shifts without triggering tests.

## 5. Unconfirmed concerns

1. **Do callout clamping and card height estimation interact correctly?** The `addCallout()` function clamps height to `Math.min(1.35, textBoxHeight(...))` (line 838), but if the estimate is too high, the callout will be truncated visually. No test verifies callout content is never clipped.

2. **Does table row-height estimation match pptxgenjs cell rendering exactly?** The formula at line 195–196 is supposed to be a single source of truth, but pptxgenjs might apply different line spacing than `slide.addText(..., lineSpacing: Math.round(fontSize * 1.45))`. This could cause pre-export estimates to diverge from post-export reality.

3. **Are numbered list badges (`CARD_BADGE_W = 0.22 in`) guaranteed not to collide with text?** Line 956 sets `textX = box.x + CARD_BADGE_W + 0.2`, but if a badge is taller than expected, text could overlap.

4. **Does `fit: 'shrink'` in `textShapeOpts()` cause unexpected font size changes at render time?** Line 145 sets `fit: 'shrink'`, which tells pptxgenjs to shrink text if it doesn't fit. This is not reflected in the pre-export audit, so a slide that passes the audit might render with smaller fonts than estimated.

5. **Is the ink-panel layout mode fully specified?** Line 590–592 detects layout mode by title text ("branded", "what construct"), but this is fragile and not documented. The ink-panel check at line 298–305 uses hard-coded heights (0.28 + 0.05 + ...) which do not match the actual render in `addInkRampVisual()` (line 610–629).

6. **Are nested inline markdown runs parsed correctly?** Line 434–465 (`parseInlineRuns`) handles `**bold**` and `` `code` `` but not nested or escaped variants (e.g., `**bold *italic***` is not tested).

## 6. Asset-quality contract opportunities

1. **Pre-export font-size floor enforcement**: Add a check that no rendered text (body, callout, table, list) falls below a configurable minimum (e.g., 8pt for micro, 9pt for tables). Fail closed if violated.

2. **Bullet-density rubric**: Define max bullets per slide (e.g., 8 bullets of <= 60 chars each, or else spread to next slide). Enforce in pre-export audit.

3. **Visual regression testing**: Generate slide thumbnails (via headless Chromium or LibreOffice export-to-image) and diff against a golden baseline. Add to functional test suite.

4. **Explicit header/footer safety zones**: Document and test that no content block starts within `MY + 0.6 = 1.01 in` (header zone) or lands within `FOOT_Y - 0.1 = 5.06 in` (footer zone). Add pre-export checks.

5. **Table readability rubric**: Enforce minimum column width (e.g., 0.8 in) and flag tables with > 4 columns (too dense). Enforce in pre-export audit.

6. **Callout/card padding audit**: Measure text-to-edge distance and flag if < 0.06 in (too tight) or if card height > 1.5 in (too tall).

7. **Line-spacing validation**: Test that estimated `lineHeightIn(fontSize)` matches pptxgenjs rendering by comparing expected vs. actual PPTX shape bounds post-export.

8. **Screenshot + manual sign-off for deck templates**: Require human visual review of any new deck layout mode before shipping (e.g., "what construct" mode, branded mode).

## 7. Render or visual-review requirements

- **No current visual rendering**: Deck export does not generate screenshots or images for review.
- **Post-export XML audit is text-only**: Bounds checks read XML; they do not verify visual alignment, kerning, baseline shifts, or anti-aliasing.
- **Pandoc HTML deck (separate from PPTX)**: `templates/distribution/construct-deck.html` is used for HTML deck export (not PPTX). No screenshot tests exist for HTML decks either.
- **Manual preview path**: `scripts/generate-deck-examples.mjs` (lines 20–54) writes golden PPTX and HTML to `.tmp/distribution-examples/` for manual local review. This is the only visual-review mechanism.
- **Recommendation**: Add headless Chromium export to PNG/PDF of golden decks and store as CI artifacts for inspection. Diff thumbnails on changes.

## 8. Tests needed

1. **Pre-export footer-band collision**: Markdown with content that reaches exactly `CONTENT_MAX_Y` should pass, but content reaching `CONTENT_MAX_Y + 0.05` should fail.

2. **Pre-export header-band overlap**: A slide with a very short title should not trigger issues; a test with manually crafted blocks placed in the heading region should fail (currently no guard).

3. **Font size floor enforcement** (new): Test that `tableFontSize()` never returns < 9pt; test that list item font size never goes below `T.body` (11pt) without explicit override.

4. **Bullet density limits** (new): A slide with 12 single-word bullets should fail a density check.

5. **Post-export callout clipping**: Export a markdown with a long callout text and verify the rendered PPTX does not clip (visual test, not XML-only).

6. **Post-export visual regression**: Generate thumbnails of golden PPTX before and after a refactor; assert pixel-level diff is < threshold.

7. **Table column width adequacy** (new): A 6-column table in a 10 in slide should fail (< 1 in per column).

8. **Wrap estimation accuracy**: Create a markdown slide with text that wraps to exactly N lines; export PPTX and measure actual shape height; assert estimated height is within 0.1 in.

9. **Badge-text collision** (new): Export numbered list with very long item text; verify badge and text do not overlap.

10. **Ink-panel height contract** (new): Verify `addInkRampVisual()` actual height matches the hardcoded 0.28 + 0.05 + ... estimate used in pre-export audit.

## 9. Docs needed

1. **Deck visual quality rubric**: Document minimum font sizes, maximum bullets per slide, minimum column width, ideal callout/card padding, footer buffer, header zone, and link to pre-export audit code.

2. **Deck layout modes**: Formally specify "default", "ink-panel", and "feature-grid" modes with expected heights and safe content zones.

3. **Text wrapping contract**: Document character-per-inch formula and warn that it's a heuristic; link to `wrappedLineCount()` source.

4. **Post-export audit reference**: Explain what `auditPptxFile()` checks and what it skips (header/footer bands); clarify tolerance thresholds (0.03 in).

5. **Footer and header zones**: Draw a diagram showing CONTENT_TOP (1.02 in), header rule (0.85 in), ink-panel region, CONTENT_MAX_Y (5.06 in), FOOT_Y (5.2 in), FOOT_BAR_H (0.045 in). Link from branding.md.

6. **Deck export troubleshooting**: Explain common failures (vertical_overflow, table_cell_wrap_excess, text_dense, panel_tall) and how to fix them (split slide, reduce list items, shorten table cells).

## 10. Dependency and degradation concerns

1. **pptxgenjs dependency**: PPTX export is optional (fails gracefully if not installed). Post-export audit requires unzip and regex parsing of XML; resilient to pptxgenjs changes.

2. **Brand tokens**: PPTX export uses `brand-tokens.mjs` and `brand-fonts.mjs` directly. If tokens change (e.g., typography sizes), pre-export audit formulas may become stale (e.g., `T.body: 11` → `T.body: 10`). **Recommendation**: Add a regression test that compares pre-export estimate to post-export actual bounds for golden fixtures after any brand-token change.

3. **Markdown parsing fragility**: `slideBlocks()` (lines 484–565) is a custom parser. It does not handle edge cases well (e.g., tables with escaped pipes, lists with indentation, deeply nested formatting). **Risk**: Malformed markdown could be parsed incorrectly, causing audit estimates to be wrong.

4. **pptxgenjs line-spacing behavior**: The render loop uses `lineSpacing: Math.round(fontSize * 1.45)` (line 159), but pptxgenjs might apply this differently than estimated. No test verifies this contract holds across pptxgenjs versions.

## 11. Questions for Opus

1. **Visual rendering strategy**: Should deck visual QA be synchronous (run in CI, block merge if visual diff is > threshold) or asynchronous (generate, store as artifact, require human sign-off)? Cost/benefit of headless rendering (Chromium, LibreOffice) vs. manual review?

2. **Font-size floor policy**: Should the minimum font size be configurable per org/profile, or hard-coded? Should T.micro (8pt) ever appear in a slide, or only in special callouts?

3. **Bullet density limits**: Is there a target max bullets per slide? Should we enforce by count (e.g., 8 max) or by total height (e.g., max 2 in)?

4. **Header/footer safety**: Should we add explicit guards in pre-export for content in the title/rule region and footer buffer? Or is post-export overflow detection sufficient?

5. **Regression test strategy**: Golden PPTX fixtures are not stored in git (too large). Should we: (a) store compressed golden PNGs (thumbnails) and diff on changes; (b) re-generate goldens on each run and only flag visual regressions if they exceed a threshold; (c) manual review only?

6. **Ink-panel layout mode**: Is this layout fully specified, or does it need a refactor? The hardcoded heights (0.28 + 0.05 + ...) should match `addInkRampVisual()` — should we derive them from code or move to named constants?

7. **fit: 'shrink' behavior**: Should we disable `fit: 'shrink'` in `textShapeOpts()` to ensure estimated font sizes match rendered sizes exactly? Or is dynamic shrinking acceptable (and should be reflected in pre-export audit)?

## 12. Suggested bead updates

1. **Create bead for pre-export font-size floor validation**: Add a check to `auditDeckMarkdownLayout()` that no text block renders below a configurable minimum (default 8pt). Fail closed. Includes test case for table at 9pt min.

2. **Create bead for bullet-density rubric**: Define max bullets per slide and max chars per bullet. Add to pre-export audit. Includes test case with dense/sparse slides.

3. **Create bead for visual regression testing**: Set up headless export (Chromium or LibreOffice) to generate slide thumbnails. Store golden PNGs in git. Add CI step to diff and fail on regression > threshold. Includes initial goldens for golden-deck-platform.md.

4. **Create bead for explicit header/footer safety zones**: Add pre-export checks for content in title region and footer buffer. Document safe zones in branding.md. Includes test cases for boundary violations.

5. **Create bead for table readability rubric**: Enforce min column width and flag tables with too many columns. Add to pre-export audit. Includes test case for 6-column table in 10 in slide.

6. **Create bead for line-spacing validation**: Post-export test comparing estimated `textBoxHeight()` to actual PPTX shape bounds. Includes accuracy threshold (e.g., ±0.1 in).

7. **Create bead for deck layout mode specification**: Formalize "default", "ink-panel", "feature-grid" modes with expected heights and constraints. Document in new guide. Refactor hardcoded heights to named constants.

8. **Create bead for screenshot + manual sign-off template**: Add a process for new deck layout modes to require human visual review before merge. Document in CONTRIBUTING.md.

9. **Create bead for Markdown parser edge cases**: Add test cases for escaped pipes in tables, indented lists, nested inline formatting. Improve `slideBlocks()` parser or replace with a more capable alternative (e.g., remark, markdown-it).

10. **Create bead for pptxgenjs version pinning + regression test**: Pin pptxgenjs to a specific version and add a test that verifies line spacing and text shrinking behavior matches expectations. Alert on version upgrades.

11. **Create bead for golden PPTX fixture audit**: Run pre-export and post-export audits on all golden fixtures monthly. Create a dashboard showing audit status. Fail CI if new audits uncover issues.

12. **Create bead for deck export troubleshooting docs**: Write a guide explaining common errors (vertical_overflow, table_cell_wrap_excess, text_dense, panel_tall) and remediation steps. Link from error messages in CLI output.
