# Subagent Evidence Report: Branding, typography, spacing

## 1. Summary

Construct maintains a **centralized, well-documented monochrome branding system** with Space Grotesk and JetBrains Mono fonts. Brand tokens are declared in a single source of truth (`lib/brand-tokens.mjs`, `templates/distribution/construct-brand.typ`) and flow consistently into PDF, HTML, and PPTX exports through templated systems. Font bundling is correct and testable. **Six gaps exist**: (1) no testable contrast-ratio verification (WCAG AA colors declared but unverified), (2) no type-scale integrity test (sizes and line-heights are declared but not validated for legibility), (3) spacing scale lacks centralized declaration (Typst and CSS use hard-coded em/px values rather than a reusable scale), (4) no dark-mode contrast test (CSS variables support dual themes but readability is unaudited), (5) no visual regression test for branding drift in rendered templates, (6) no documentation of the design system maturity or component lifecycle. The system is mature enough to ship; these gaps are about preventing future drift and ensuring design decisions remain auditable.

## 2. Evidence table

| Finding | Evidence file | Evidence | Confidence |
|---------|-------|----------|------------|
| Brand tokens are centralized in a single module | `lib/brand-tokens.mjs` | Lines 9–93. BRAND_TOKENS object exports ink ramp (default/strong/body/muted/faint), line ramp (hairline/hairlineStrong), surfaces, navy accent, typography (fontSans/fontMono/weights/sizes), and layout config. Export used by brand-prose linter, publish pipeline, and PPTX embed. | high |
| Monochrome system adopted (no color for page furniture) | `templates/distribution/construct-brand.typ` | Lines 1–53. Comment: "The system is monochrome: black, white, and a grey ink ramp carry all document chrome and accents, so printed artifacts read as one consistent family regardless of type. Color belongs to diagrams, not to the page furniture." Font stack references numeric weights only (400/500/600/700). Status pills use monochrome strokes/fills. | high |
| Space Grotesk is sole sans/display font, JetBrains Mono is sole monospace | `lib/brand-fonts.mjs` lines 19–25; `brand-tokens.mjs` lines 54–56 | BRAND_SANS_FAMILY = 'Space Grotesk'; BRAND_MONO_FAMILY = 'JetBrains Mono'. Font stack: `"'Space Grotesk', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"` with fallback chain. Prior typefaces marked as retired (see `lib/brand-prose.mjs` RETIRED_FONT_RE). | high |
| Bundled fonts are distributed offline | `templates/distribution/fonts/README.md` | SpaceGrotesk-Variable.ttf (weight axis 300–700) and three JetBrains Mono cuts (Regular/Medium/SemiBold) pinned to repo. Typst export passes `--font-path`, `--ignore-system-fonts`, `--ignore-embedded-fonts` so no serif fallback. | high |
| Font paths are testable | `tests/brand-fonts.test.mjs` lines 20–44 | Test suite validates: BRAND_SANS_FAMILY is 'Space Grotesk', BRAND_MONO_FAMILY is 'JetBrains Mono', bundledSansFontPaths returns 1 TTF, bundledMonoFontPaths returns 3 TTF. PPTX embed capability is checked. | high |
| Type scale is declared | `lib/brand-tokens.mjs` lines 64–75; `construct-brand.typ` lines 65–74 | Sizes: micro (8pt), small (8.5pt), meta (9pt), body (10pt), h4 (8.5pt), h3 (11pt), h2 (13pt), h1 (17pt), subtitle (11.5pt), title (24pt). Parallel in Typst: fs-micro through fs-title. No single reusable scale constant. | high |
| Line-height and paragraph spacing are hardcoded, not centralized | `construct-brand.typ` lines 220–221, 295–297 | Callout: `leading: 0.66em, spacing: 0.72em`. Body prose: `leading: 0.9em, spacing: 1.24em`. Lists/enum: `spacing: 1.02em`. Each block resets independently; no "leading scale" or "spacing scale" token. | high |
| HTML/deck exports use CSS variables for brand tokens | `templates/distribution/construct-web.html` lines 20–25 | `:root { --ink, --ink-strong, --ink-body, --muted, --faint, --hairline, --hairline-strong, --surface, --surface-alt, --paper, --sans, --mono }`. Same RGB values as Typst. | high |
| Dark-mode CSS is declared but unverified for contrast | `packages/cx-ui/styles/theme.css` lines 8–37, 39–50 | `:root` and `[data-theme="light"]` define two full palettes. Dark: --ink: #ededed on --bg: #000. Light: --ink: #0a0a0a on --bg: #fff. No WCAG AA ratio verification in tests. | high |
| Spacing variables exist in the dashboard UI | `packages/cx-ui/styles/theme.css` lines 31–36 | --row-y: 14px (10px compact); --section-gap: 28px (20px compact); --content-max: 880px; --page-max: 1180px; --side-w: 272px; --header-h: 56px. These are used ad hoc but not formalized as a canonical spacing scale. | high |
| Color is validated only for naming/voice drift, not contrast | `lib/brand-prose.mjs` + `scripts/audit/03d-brand.mjs` | Brand linter scans for retired fonts, marketing voice, and naming. No contrast-ratio or WCAG validator in the lint or audit pipeline. Marketing voice allowlist mentions WCAG in comments (line 74) but doesn't validate. | high |
| Export branding policy is centralized | `lib/export-branding.mjs` | EXPORT_BRANDING_CAPABILITIES object maps format (pdf, html, deck, pptx, docx, etc.) to capability, mechanism, and asset. resolveExportBranding() enforces that styled formats get 'construct' branding by default, source formats get 'none'. | high |
| Visual rendering is tested for font coverage, not contrast | `tests/functional/publish-template.functional.test.mjs` lines 32–94, 142–180 | Tests verify: BRAND.accent is monochrome, masthead/heading styles use Space Grotesk, diagram preprocessing injects brand theme with Mermaid handDrawn aesthetic and Caveat font for labels, PDFs preserve list numbering. No visual regression test; no rendered contrast check. | high |
| Design principles are documented but not enforced | `specialists/prompts/cx-designer.md` + `skills/roles/designer.md` | Designer role guidance covers states, hierarchy, hierarchy, contrast, and accessibility baseline (WCAG AA, keyboard, visible focus). Skills/brand/output-vibe.md prescribes monochrome ink ramp, prose rhythm, and diagram aesthetics. No test validates that shipped artifacts follow these principles. | high |
| Construct naming is linted for consistency | `lib/brand-prose.mjs` lines 118–143 | lintConstructNamingLine() flags miscapitalized CLI (Construct doctor) and unbackticked CLI in lists. Test suite at `tests/brand-prose.test.mjs` covers these cases. | high |
| Masthead and callout components enforce visual hierarchy | `construct-brand.typ` lines 169–206, 212–227 | masthead() produces title, subtitle, byline with hierarchy via size/weight/color. Callout components (at-a-glance, note, decision) use consistent left bar and label treatment. No layout variants; structure is rigid. | high |
| Status pills use monochrome only, never color-coding | `construct-brand.typ` lines 107–123 | Status pill logic: settled states (approved/shipped) render as solid black; active states as black outline; others as faint outline. Text color varies (white on black, black on white, grey on white). "Color is never used to encode status." | high |
| Font embedding in PPTX is optional but supported | `lib/brand-fonts.mjs` lines 46–80 | createPptxGenerator() wraps pptxgenjs with optional pptx-embed-fonts; fallback to unembedded if unavailable. embedBundledSansInPptx/embedBundledMonoInPptx() read bundled TTF and call pptx.addFont(). | high |
| Retired fonts are flagged in audit | `scripts/audit/03d-brand.mjs` lines 50–54 | retiredFontDriftFromScan() filters brand-prose hits for 'retired-font' kind. Audit runs `construct audit` to scan docs/, skills/, specialists/ for references to deprecated typeface names (see `lib/brand-prose.mjs` RETIRED_FONT_RE). | medium |
| No WCAG contrast-ratio test exists | (no file) | Searched tests/ and lib/ for 'contrast\|WCAG.*ratio\|wcag.*aa'. Found no automated contrast checker. CSS variables declare colors but no unit test verifies #ededed on #000 or #0a0a0a on #fff meet WCAG AA. | high |
| No type-scale legibility test exists | (no file) | Searched for 'type.*scale\|leading.*test\|line.*height.*test'. Found functional test of leading/spacing values in construct-brand.typ (lines 295–297) but no test that validates sizes are legible at declared leading (e.g., 10pt body at 0.9em leading). | high |
| Spacing scale not formalized as a reusable token | (no file) | `construct-brand.typ` uses inline em values (0.66em, 0.72em, 0.9em, 1.24em, etc.) and `packages/cx-ui/styles/theme.css` uses px values (14px, 28px, 10px, 20px). No canonical spacing scale (8px, 12px, 16px, 24px, etc.) exists as a single source. | high |
| Dark-mode contrast is undocumented and unverified | `packages/cx-ui/styles/theme.css` lines 39–50 | Light mode values exist (--ink: #0a0a0a, --bg: #fff) but no test validates contrast ratios. Dark mode uses #ededed on #000. No explicit guidance on which text colors (--ink, --ink-soft, --muted, --faint) meet AA on dark backgrounds. | high |
| Design system maturity level not documented | (no file) | Searched docs/guides/ for design-system maturity, component lifecycle, or rung classification. Found role guidance (designer.md) but no artifact stating whether Construct is at "ad hoc" / "shared components" / "governed system" stage. | medium |
| Prose rhythm guidance is documented | `skills/brand/output-vibe.md` lines 18–22 | Prescribes: lead with short declarative, use headings/tables/selective bullets, avoid bullet walls (>7 without prose bridge), rare em dashes. No test enforces this. | medium |
| Diagram aesthetic is specified | `skills/brand/output-vibe.md` lines 24–36 | Hand-drawn/sketch aesthetic preferred. Mermaid uses sketch theme. Flowcharts show at least one non-happy path. No embedded icons or clipart. | medium |

## 3. Existing mechanisms

1. **Brand token centralization** (`lib/brand-tokens.mjs`): Single source for INK ramp, FONTS stack, STATUS colors (unused in Construct itself), and BRAND_TOKENS export. Re-exported and used by:
   - `lib/brand-fonts.mjs`: Font family names and bundled paths.
   - `templates/distribution/construct-brand.typ`: Typst module that imports brand values and applies them to headings, callouts, tables, figures via `#show` and `#set` rules.
   - `templates/distribution/construct-web.html`: CSS variable mirrors (--ink, --surface-alt, etc.).
   - `lib/export-branding.mjs`: Declares which output formats are brand-capable; resolveExportBranding() defaults to 'construct' branding.

2. **Font bundling and Typst export hardening** (`lib/brand-fonts.mjs`, `templates/distribution/fonts/`):
   - Space Grotesk-Variable.ttf and three JetBrains Mono cuts shipped offline.
   - PDF export runs Typst with `--font-path=templates/distribution/fonts`, `--ignore-system-fonts`, `--ignore-embedded-fonts` to guarantee brand faces render (no fallback to default serif).
   - PPTX embedding via optional `pptx-embed-fonts` library.
   - Paths validated by `tests/brand-fonts.test.mjs`.

3. **Lint gates** (`lib/brand-prose.mjs`, `lib/hooks/brand-prose-lint.mjs`, `scripts/audit/03d-brand.mjs`):
   - `lintMarketingVoiceLine()`: Flags marketing-voice tokens (see MARKETING_VOICE_RE regex) in governed prose paths.
   - `lintRetiredFontLine()`: Scans for deprecated typeface patterns (see RETIRED_FONT_RE constant).
   - `lintConstructNamingLine()`: Flags unbackticked or miscapitalized CLI invocations.
   - Scans docs/, skills/, specialists/, personas/, templates/, rules/ on paths governed by HOOK_SCOPED regex.
   - Audit script (`scripts/audit/03d-brand.mjs`) runs full repo scan and produces JSON report.

4. **Monochrome design principle** enforced in templates:
   - `construct-brand.typ` lines 7–8, 105–113: Status pills and callouts use ink/surface swaps, never red/green/yellow.
   - Monochrome ink ramp (ink, ink-strong, ink-body, muted, faint, hairline) carries all hierarchy.
   - Diagrams (Mermaid, D2) get Construct brand theme via `injectMermaidBrandTheme()` (uses #0a0c10 accent, hand-drawn aesthetic).

5. **Template structure** ensures consistency across artifact types:
   - `construct-masthead()`: Unified cover block for title, byline, metadata chips, editorial line.
   - `construct-callout()`: Unified aside block (at-a-glance, note, decision).
   - `construct-key-metrics()`: Bordered card for metrics tables.
   - `construct-running-header()` / `construct-running-footer()`: Page furniture on pages 2+.
   - Single `construct-theme()` function applied to all body prose.

6. **Dark/light CSS support** (cx-ui theme):
   - `:root` declares dark-mode palette (--bg: #000, --ink: #ededed).
   - `[data-theme="light"]` declares light palette (--bg: #fff, --ink: #0a0a0a).
   - `[data-motion="reduce"]` disables animations for a11y.
   - Density toggle: `[data-density="compact"]` tightens --row-y and --section-gap.

7. **Functional tests** verify template structure:
   - `tests/functional/publish-template.functional.test.mjs`: Validates masthead structure, font coverage (Space Grotesk, JetBrains Mono in PDFs and HTML), list numbering preserved, Mermaid injection, diagram env vars.
   - `tests/brand-fonts.test.mjs`: Validates family names and bundled paths.
   - `tests/export-branding.test.mjs`: Validates branding policy resolution.

## 4. Confirmed gaps

1. **No WCAG AA contrast-ratio validator** (severity: medium, tier: mechanical).
   - INK colors are declared: #0a0c10 (near-black), #16191f, #23272e (body), #565c66 (muted), #9499a2 (faint).
   - CSS dark mode: #ededed on #000 (light text on dark bg).
   - CSS light mode: #0a0a0a on #fff (dark text on light bg).
   - No automated test verifies these combinations meet WCAG AA (4.5:1 for body, 3:1 for UI components).
   - Unverified: Does #9499a2 (faint) on #fafafa (surface) meet 3:1? Does #ededed on #000 in dark mode exceed AA threshold?

2. **Type-scale legibility not verified** (severity: low, tier: judgment).
   - Sizes declared: 8pt (micro/h4), 8.5pt (small), 9pt (meta), 10pt (body), 11pt (h3), 13pt (h2), 17pt (h1), 24pt (title).
   - Line-heights set: body at 0.9em (11.7pt leading for 13pt line height at 10pt size), callouts at 0.66em (tighter for sidebar content).
   - No test validates that declared size+leading combinations produce legible lines, maintain consistent rhythm, or avoid orphan/widow breakage.
   - Unverified: Is 8pt micro readable as body text? Is 10pt body at 0.9em leading sufficient for sustained reading?

3. **Spacing scale not centralized** (severity: medium, tier: mechanical).
   - Typst: hardcoded em values (0.66, 0.72, 0.9, 1.24, 1.02, 1.05, 1.15, 1.2, 1.65 em).
   - CSS: hardcoded px values (14px row-y, 28px section-gap, 10px row-y compact, 20px section-gap compact, 4px, 6px, 10px, 12px, 18px, 22px hardcoded in gaps).
   - No canonical 8px-based scale (8, 12, 16, 24, 32, …) exists as a single source.
   - Each surface (Typst, CSS, HTML templates) uses ad hoc values; changes require three edits.

4. **Dark-mode contrast undocumented** (severity: medium, tier: judgment).
   - CSS variables support dark mode (--bg: #000, --ink: #ededed) and light mode (--bg: #fff, --ink: #0a0a0a).
   - No guidance on which CSS variables (--ink, --ink-soft, --muted, --faint) are safe to use on dark vs. light backgrounds.
   - No test enforces that dark-mode text color + dark-mode bg color meet AA.
   - Risk: A component may use --muted (#8a8a8a or #6b6b6b) on --bg without knowing the contrast ratio.

5. **No visual regression test for branding drift** (severity: low, tier: mechanical).
   - Functional tests verify structure (masthead exists, fonts embedded) but not rendering.
   - No screenshot test, PDF visual hash, or Mermaid rendering test to catch when spacing, font size, or color shifts unintentionally.
   - Unverified: If someone edits construct-brand.typ and changes heading size from 13pt to 12pt, would CI catch it?

6. **Design system maturity and component lifecycle not documented** (severity: low, tier: judgment).
   - Designer role guidance exists (skills/roles/designer.md) but no artifact states: "Construct is at [ad hoc | shared components | governed system] maturity."
   - No lifecycle (discover → frame → architect → validate → promote) documented for new design tokens or components.
   - No contribution rules for adding new tokens to brand-tokens.mjs.
   - Risk: New contributors don't know whether to add a token to brand-tokens.mjs or declare it locally.

## 5. Unconfirmed concerns

1. **Font fallback chain adequacy** (confidence: medium).
   - Font stack ends with generic `sans-serif` / `monospace`. If Typst --ignore-system-fonts takes effect but font-path is unavailable, what serif does Typst render?
   - Evidence: `templates/distribution/construct-brand.typ` line 54: `construct-font-sans = ("Space Grotesk",)` — only Space Grotesk in the tuple, no fallback.
   - Unverified: Does this mean PDFs fail if SpaceGrotesk-Variable.ttf is missing, or does Typst gracefully fall back to a default serif?

2. **CSS font-family fallback chain in exported HTML** (confidence: medium).
   - HTML template uses `--sans: 'Space Grotesk', ui-sans-serif, system-ui, -apple-system, sans-serif`.
   - Google Fonts link is included: `css2?family=Space+Grotesk:wght@400;500;600;700`.
   - Unverified: If Google Fonts is unreachable, does the fallback chain guarantee legibility? Will `ui-sans-serif` render as Space Grotesk on a system without it?

3. **Muted color safety on light surfaces** (confidence: medium).
   - `--muted: #565c66` in light mode (#0a0c10 body on #fafafa surface).
   - Ratio: (#565c66 / #fafafa) ≈ 3.5:1 — passes 3:1 for UI, but close.
   - Unverified: Is #565c66 on #f3f4f6 (surface-alt, slightly darker) still AA-safe? Needs WCAG validator.

4. **Faint color safety in callouts and labels** (confidence: medium).
   - `--faint: #9499a2` on `--surface: #fafafa`.
   - Ratio: (#9499a2 / #fafafa) ≈ 2.2:1 — below 3:1, probably fails for body text.
   - Usage: Faint is used for separators (dots), helper text, and disabled states. May not need AA (depends on context).
   - Unverified: Does Construct document which text roles (primary, helper, disabled) are allowed to use --faint?

5. **HTML export contrast on embedded images** (confidence: medium).
   - `templates/distribution/construct-web.html` line 69: `figure img { border: 1px solid var(--hairline) }`.
   - Hairline (#e3e4e8) on white (#fff) is very light. If an image is light-colored, does the border provide sufficient contrast?
   - Unverified: Should embedded images in exported HTML have a stronger border or shadow for visual separation?

6. **Spacing consistency between Typst and CSS** (confidence: medium).
   - Typst uses em-based spacing (0.9em, 1.24em, etc.).
   - CSS uses px-based spacing (14px, 28px, etc.).
   - If a user edits one surface (e.g., changes Typst body spacing from 1.24em to 1.3em), the CSS version stays at 28px, causing drift.
   - Unverified: Is there a process to keep spacing in sync, or is drift expected?

## 6. Asset-quality contract opportunities

1. **Establish WCAG AA contrast baseline** (tier: mechanical, effort: low).
   - Add `lib/brand-contrast.mjs` with contrast-ratio calculator.
   - Export color pairs (ink + surface, faint + surface, etc.) as constants.
   - Add `tests/brand-contrast.test.mjs` that validates each pair meets 4.5:1 (body text) or 3:1 (UI).
   - Extend audit script to include contrast checks: `node scripts/audit/03d-brand.mjs --report=contrast`.
   - Evidence: WCAG 2.1 Level AA standard, existing color values in `lib/brand-tokens.mjs`.

2. **Formalize spacing scale** (tier: mechanical, effort: medium).
   - Define `SPACING_SCALE` in `lib/brand-tokens.mjs`: `{ xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }` (in px).
   - Convert `construct-brand.typ` em-based spacing to scale references: `spacing(md)` instead of `1.24em`.
   - Update CSS variables: `--spacing-xs: 4px, --spacing-sm: 8px, …`.
   - Add test: `tests/brand-spacing.test.mjs` validates that Typst, CSS, and templates use consistent scale.
   - Evidence: Existing hardcoded values scattered across `construct-brand.typ` and `theme.css`.

3. **Add type-scale legibility guidance** (tier: judgment, effort: low).
   - Document in `docs/guides/reference/branding.md` § "Type scale": which sizes are intended for which contexts (micro for labels/metadata, body for sustained reading, h1/h2 for headers), recommended leading per size, line-length constraints.
   - Evidence: Sizes are declared in `lib/brand-tokens.mjs` lines 64–75, but purpose and context are not documented.

4. **Document dark-mode color safety** (tier: judgment, effort: low).
   - Add section to `docs/guides/reference/branding.md` § "Dark mode": which CSS variables (--ink, --muted, --faint) are safe for body text, helper text, disabled state on dark bg.
   - Cite contrast ratios for each pair.
   - Evidence: Dark-mode CSS exists in `packages/cx-ui/styles/theme.css` lines 39–50, but no guidance on usage.

5. **Add visual regression test for exported templates** (tier: mechanical, effort: high).
   - Use Playwright or Puppeteer to render a golden markdown file to PDF and HTML.
   - Screenshot each export and compare against golden baseline.
   - Gate: `tests/functional/publish-template.functional.test.mjs` — add visual hash checks.
   - Catch unintended changes to font size, line-height, spacing, or color in renders.
   - Evidence: Functional tests exist (`publish-template.functional.test.mjs`) but are structure-only.

6. **Document design system maturity and contribution lifecycle** (tier: judgment, effort: low).
   - Add `docs/guides/concepts/design-system-maturity.md`: "Construct is at [maturity level] with [count] token families and [count] component shapes."
   - Link to `docs/guides/concepts/scope-lifecycle.md` for the discover → promote cycle.
   - Amend `CONTRIBUTING.md` § "Brand tokens": "To add a token, file a bead, use `construct scope create`, and follow the lifecycle; ad-hoc tokens are not promoted."
   - Evidence: Role guidance exists (`skills/roles/designer.md`) and scope lifecycle is documented (`docs/guides/concepts/scope-lifecycle.md`), but design-system-specific guidance is absent.

7. **Centralize font fallback strategy** (tier: judgment, effort: low).
   - Add section to branding.md: "Font fallback behavior": "Typst: Space Grotesk variable TTF is required (–ignore-system-fonts enforces this); no serif fallback. HTML: Google Fonts fallback to system ui-sans-serif if CDN unreachable."
   - Document what happens if fallback fails (PDF renders with default Typst serif; HTML uses system sans).
   - Evidence: Font strategy is scattered across comments in `brand-fonts.mjs`, `brand-tokens.mjs`, and `construct-brand.typ`, but not documented for users/operators.

## 7. Render or visual-review requirements

1. **Rendered PDF samples**: Run `node scripts/audit/03d-brand.mjs` and export a golden PRD to PDF; visually inspect masthead, heading hierarchy, callout styling, table alignment, and figure framing for drift.

2. **HTML export samples**: Export the same golden PRD to HTML; verify Space Grotesk renders via Google Fonts, code blocks are readable, tables are horizontally aligned, and links underline correctly.

3. **PPTX sample with embedded fonts**: Create a deck with the golden template and verify Space Grotesk embeds and renders in PowerPoint without fallback.

4. **Dark-mode contrast check**: Render an HTML sample with `[data-theme="dark"]` and measure contrast ratios of body text (#ededed on #000), muted text (#8a8a8a on #000), and faint text (#5a5a5a on #000) against AA thresholds.

5. **Type-scale legibility at actual size**: Print a golden PRD at full scale and read body text at declared 10pt size with 0.9em leading; check for eye strain or readability issues.

## 8. Tests needed

1. **WCAG AA contrast-ratio test** (file: `tests/brand-contrast.test.mjs`).
   - Validate INK ramp (ink, strong, body, muted, faint) + SURFACE ramp (default, alt, paper) combinations.
   - Validate dark-mode CSS variables (--ink on --bg, --muted on --bg, --faint on --bg).
   - Assert all body-text pairs ≥ 4.5:1, UI pairs ≥ 3:1.
   - Reference: `lib/brand-tokens.mjs` lines 9–21, `packages/cx-ui/styles/theme.css` lines 8–50.

2. **Spacing scale consistency test** (file: `tests/brand-spacing.test.mjs`).
   - Validate that `lib/brand-tokens.mjs` exports SPACING_SCALE constant.
   - Validate Typst uses scale references, not hardcoded em values.
   - Validate CSS `--spacing-*` variables match the scale.
   - Reference: `construct-brand.typ` lines 220–221, 295–297.

3. **Type-scale documentation test** (file: `tests/brand-typescale.test.mjs`).
   - Validate that `docs/guides/reference/branding.md` documents each size's purpose and leading.
   - Validate that `lib/brand-tokens.mjs` size exports match docs.
   - Reference: `lib/brand-tokens.mjs` lines 64–75.

4. **Dark-mode CSS safety test** (file: `tests/brand-dark-mode.test.mjs`).
   - Parse `packages/cx-ui/styles/theme.css` and extract `:root` and `[data-theme="light"]` color values.
   - For each CSS variable, compute contrast ratio against both dark and light bg.
   - Assert that variables marked "body" or "label" meet AA in their intended theme.
   - Reference: `packages/cx-ui/styles/theme.css` lines 8–50.

5. **Visual regression test for exports** (file: `tests/functional/publish-visual-regression.functional.test.mjs`).
   - Export golden fixture to PDF, HTML, and PPTX.
   - Render each with Puppeteer/Playwright; compute a visual hash (e.g., perceptual hash).
   - Compare against golden baseline; fail if the rendered hash diverges from it.
   - Reference: `tests/functional/publish-template.functional.test.mjs`.

6. **Font fallback resilience test** (file: `tests/brand-font-fallback.test.mjs`).
   - Verify Typst config (--ignore-system-fonts) is passed to export engine.
   - Verify HTML templates include Google Fonts link with proper weight list.
   - Verify PPTX font embedding is attempted if pptx-embed-fonts is available.
   - Reference: `lib/brand-fonts.mjs`, `templates/distribution/construct-web.html` lines 16–18.

## 9. Docs needed

1. **`docs/guides/reference/branding.md` § "Type scale"** (effort: low).
   - Document intended use of each size (8pt micro for metadata, 10pt body for sustained reading, 17pt h1 for chapter headers, 24pt title for cover).
   - Specify leading and line-length constraints per size.
   - Recommend max-width for body text (760px suggested).
   - Reference existing usage in `lib/brand-tokens.mjs` lines 64–75.

2. **`docs/guides/reference/branding.md` § "Dark mode"** (effort: low).
   - Document the two CSS themes (`:root` dark, `[data-theme="light"]` light).
   - List which variables are safe for body text, labels, disabled state in each theme.
   - Cite WCAG AA contrast ratios for each pair.
   - Reference `packages/cx-ui/styles/theme.css` lines 8–50.

3. **`docs/guides/reference/branding.md` § "Spacing and layout"** (effort: low).
   - Document the canonical spacing scale (8px, 12px, 16px, 24px, …).
   - Show examples of how to apply scale to padding, margin, gap in CSS and Typst.
   - Reference `lib/brand-tokens.mjs` (once formalized).

4. **`docs/guides/reference/branding.md` § "Font fallback"** (effort: low).
   - Document Typst export: Space Grotesk variable TTF is bundled at `templates/distribution/fonts/`; no fallback serif.
   - Document HTML export: Google Fonts CDN is used; fallback to system `ui-sans-serif` if unavailable.
   - Document PPTX export: fonts embed if `pptx-embed-fonts` library is available.
   - Reference `lib/brand-fonts.mjs` lines 82–93.

5. **`docs/guides/concepts/design-system-maturity.md`** (effort: medium).
   - Define Construct's design-system maturity level (e.g., "shared components with governed token set").
   - List all token families (color, type, spacing, layout).
   - List all component shapes (masthead, callout, key-metrics, running-header, etc.).
   - Link to contribution lifecycle and governance.
   - Reference `skills/roles/designer.md` and `docs/guides/concepts/scope-lifecycle.md`.

6. **Update `CONTRIBUTING.md` § "Brand tokens and components"** (effort: low).
   - Add guidance: "To add a new token or component, file a bead, follow the scope lifecycle (discover → frame → architect → validate → promote), and get approval before merging."
   - Reference `lib/brand-tokens.mjs` as the canonical token source.
   - Reference `templates/distribution/construct-brand.typ` as the canonical component source.

## 10. Dependency and degradation concerns

1. **Google Fonts CDN availability** (severity: low).
   - HTML exports rely on `https://fonts.googleapis.com/css2?family=Space+Grotesk…` for Space Grotesk and JetBrains Mono.
   - If CDN is unavailable or blocked, fallback is system `ui-sans-serif`, which may not render as Space Grotesk.
   - Mitigation: HTML export runs with `--embed-resources` (Pandoc); fonts could be self-hosted or embedded as data URIs.
   - Evidence: `templates/distribution/construct-web.html` line 18.

2. **Typst engine availability and font-path behavior** (severity: medium).
   - PDF export relies on Typst with `--font-path=templates/distribution/fonts` and `--ignore-system-fonts`.
   - If the ignore-system-fonts flag is not respected, system fonts may substitute for the bundled brand faces (see `lib/brand-fonts.mjs` line 7 comment).
   - If the bundled sans-serif variable TTF is corrupted or missing, PDF rendering may fail or use system fallback.
   - Mitigation: Test Typst font behavior in CI; validate font files on install.
   - Evidence: `lib/document-export.mjs` (referenced in `tests/functional/publish-template.functional.test.mjs` line 27).

3. **Optional pptx-embed-fonts library** (severity: low).
   - PPTX font embedding is graceful: if `pptx-embed-fonts` is not installed, fonts are not embedded, but the library doesn't error.
   - Risk: PowerPoint on a system without Space Grotesk may display with fallback font.
   - Mitigation: Document that pptx-embed-fonts is optional; recommend installation for production.
   - Evidence: `lib/brand-fonts.mjs` lines 48–52.

4. **CSS variable theme switching** (severity: low).
   - Dark/light mode switching depends on JavaScript setting `[data-theme]` attribute on root element.
   - If JavaScript is disabled or fails, the CSS theme does not switch; user sees default (:root) dark theme only.
   - Mitigation: Use CSS `@media (prefers-color-scheme: dark)` as a fallback instead of data attributes.
   - Evidence: `packages/cx-ui/styles/theme.css` uses `[data-theme="light"]` selector, not @media.

5. **Hardcoded spacing in component styles** (severity: medium).
   - If spacing scale is not centralized (current state), changing a spacing value requires edits to Typst, CSS, and potentially HTML templates separately.
   - Risk: Drift between surfaces if one is updated and others are not.
   - Mitigation: Formalize spacing scale (gap #6 above).
   - Evidence: `construct-brand.typ` lines 220–221, `theme.css` lines 31–36 both define spacing values independently.

## 11. Questions for Opus

1. **Spacing scale priority**: Should spacing be formalized as a canonical scale (8px, 12px, 16px, …) across Typst, CSS, and templates, or is current ad hoc em/px approach acceptable for now?

2. **Dark-mode guidance**: Is the dark-mode CSS color set (--ink: #ededed on --bg: #000) intended for production, or is it a work-in-progress? Should we add WCAG AA contrast verification?

3. **Component lifecycle**: Should new tokens and components follow the scope-lifecycle process (discover → promote), or is that over-scoped for small branding changes?

4. **Visual regression testing**: Is adding screenshot-based visual regression tests to `publish-template.functional.test.mjs` worth the maintenance cost, or is structural/content testing sufficient?

5. **Font fallback strategy**: If SpaceGrotesk-Variable.ttf is missing in Typst, should we error loudly with a helpful message, or allow Typst's default serif fallback?

## 12. Suggested bead updates

1. **`branding-contrast-baseline`**: Add WCAG AA contrast-ratio test coverage for INK + SURFACE pairs. (Tier: mechanical, effort: 4h, blocker: none).

2. **`branding-spacing-scale`**: Centralize spacing as a canonical scale token across Typst, CSS, and templates. (Tier: mechanical, effort: 8h, blocker: none).

3. **`branding-type-scale-docs`**: Document type-scale sizes, leading, and line-length constraints in branding.md. (Tier: judgment, effort: 3h, blocker: none).

4. **`branding-dark-mode-docs`**: Document dark-mode CSS variable safety and contrast ratios in branding.md. (Tier: judgment, effort: 3h, blocker: none).

5. **`branding-visual-regression-test`**: Add Puppeteer-based visual regression test to catch unintended changes in exported templates. (Tier: mechanical, effort: 12h, blocker: none).

6. **`branding-system-maturity-docs`**: Create design-system-maturity.md and formalize contribution lifecycle. (Tier: judgment, effort: 6h, blocker: none).

---

**Audit conducted:** 2026-06-29 by Subagent G (Branding, Typography, Spacing).

**Report confidence:** high for existing mechanism documentation; medium for unconfirmed concerns; low for visual rendering assessment (no screenshot review performed).
