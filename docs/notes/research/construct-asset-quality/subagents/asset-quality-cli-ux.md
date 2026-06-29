---
intake: none
---

# Subagent Evidence Report: Asset-quality CLI & UX

**Agent:** K (Asset-quality CLI & UX)  
**Audit date:** 2026-06-29  
**Focus:** User-facing validation/quality commands; confirmation that CLI success output honestly states what was actually checked.

---

## 1. Summary

The construct CLI exposes three validation/publication surfaces: `publish` (artifact release gate + export), `artifact validate` (structure/citation/reviewer checks), and `certify` (scenario-based certification). All three **correctly state what they checked** in output and/or error messages. However, a critical gap exists: **no visual/render inspection is automated** — users cannot discover rendering failures at publish-time without separate manual review. The `publish` command exports PDFs and checks diagram embedding mathematically (via regex/zip inspection), but a user cannot run a visual check CLI subcommand. Publish output accurately reflects this limitation by stating success only when export completes, not when a hypothetical visual review passes. No false claims of "visual verification" were found; the UX is honest about scope, but the scope itself is narrow.

**Confidence:** High (read source, traced execution paths, examined test cases)

---

## 2. Evidence table

| Finding | Evidence file | Evidence | Confidence |
|---------|---------------|----------|------------|
| **`publish` runs release gate by default; gate checks structure, citations, prose, reviewer sign-off** | `lib/artifact-release-gate.mjs:1–122` | `validateArtifactBodyCore()` performs structure lint, citation counting, prose minimum checks, and missing-reviewer warnings. Returns `{ ok, errors, warnings }`. Frontmatter allows `releaseGate: { structuralLint, citationLint, proseMinimum, requiredReviewers }`. | High |
| **`publish` export does NOT include visual rendering inspection** | `lib/document-export.mjs:80–150` | Functions `pdfRenderedDiagrams()`, `docxRenderedDiagrams()`, `htmlRenderedDiagrams()` exist and check embedded image/SVG counts and raw diagram source patterns. But they are **only called during testing** (not during publish CLI flow). No function call from `runPublish()` to these checkers. | High |
| **`publish` success output honestly states what was exported, not what was "verified"** | `lib/publish.mjs:160–171` | Return message is `"Published <path>"` or `"Publish source-only complete"`. No claims like "visually reviewed" or "rendering verified". Gate failures are clearly attributed: `"Publish blocked: artifact release gate failed"`. | High |
| **Diagram rendering is checked mathematically, not visually** | `lib/document-export.mjs:93–106, 126–136, 138–150` | `pdfRenderedDiagrams()` counts `\Subtype\Image` and `\Subtype\Form` entries in PDF binary + tests for raw d2/mermaid source patterns left behind. Works offline, no browser/render engine. Same for DOCX (zip inspection). | High |
| **`artifact validate` subcommand exists; performs structure + citation + reviewer checks** | `lib/cli-commands.mjs:651` | Command definition: `{ name: 'validate', desc: 'Run manifest structure, citation, and reviewer checks' }`. Implementation in `lib/artifact-release-gate.mjs`. | High |
| **`certify` command runs scenario-based certification; claims "release candidate gate"** | `lib/cli-commands.mjs:627–644` | Subcommand `gate`: `'Release candidate gate — stale or failing release-critical certification evidence blocks'`. Lives in `.cx/certification/` directory structure. Scenarios include model tier and live/paid flags. | High |
| **NO CLI subcommand for visual/browser/render inspection** | `bin/construct` (full grep) + `lib/cli-commands.mjs:1–1200` | Searched for "view", "screenshot", "render", "preview", "browser", "inspect", "visual" in command definitions. Only `diagram` (render via d2/graphviz) and `demo` (record terminal/playwright) exist. No standalone visual-review command. | High |
| **`publish --no-gate` is an "escape hatch" for maintainers, not recommended** | `lib/publish.mjs:175–186` | Help text: `"--no-gate\n    Skip artifact release gate (maintainer escape hatch)"`. In `runPublish()` logic: gate is skipped when `gate: false` but not by default. Default is `gate: true`. | High |
| **Tooling detection (`construct tools detect`) is separate; reports missing binaries** | `lib/publish-tooling.mjs` + `lib/cli-commands.mjs:361–371` | Command: `{ name: 'tools', emoji: '🔧', ... description: 'Detect optional publish pipeline binaries (Pandoc, D2, VHS, Playwright)' }`. Returns `{ present, missing[], message }`. Consumed by `--strict` logic in `runPublish()`. | High |
| **Release gate failures provide actionable remediation** | `lib/publish.mjs:21–41` | `formatGateFailureMessage()` includes suggested fix: `construct artifact validate <rel> --type=<type>`. Points to `skills/docs/prd-workflow.md`. | High |
| **No render/screenshot/preview capability mentioned in README or CLI reference** | `README.md:126–265` + `docs/guides/reference/cli/work.md` | Core publish command listed; no parallel "visual review" or "preview" command. `construct export` does PDF/DOCX export, no preview mode. | High |
| **MCP tools do not include render/browser inspection** | `docs/guides/reference/mcp-tools.md:1–100` | Core tools: `document_export`, `ingest_document`, `extract_document_text`. No `render_preview`, `visual_inspect`, or `browser_screenshot` tool listed. | High |
| **Artifact-gate-notice shows structure/visual issues but does NOT render** | `lib/artifact-gate-notice.mjs:1–39` | `checkArtifactGateNotice()` calls `lintDocStructure()` and `lintDocVisuals()` (structure checks), then formats as text notice. No rendering engine invoked. | High |
| **Visual requirements are defined in manifest, checked via postconditions contract** | `lib/templates/visual-requirements.mjs:1–94` | `lintDocVisuals()` returns postconditions from `VISUAL_REQUIREMENTS[type]` passed to `validateArtifactPostconditions()`. These are **structural checks** (e.g., "must have heading", "must have image tag"), not visual rendering checks. | High |
| **PDF diagram embedding is verified via regex; no actual PDF viewer** | `lib/document-export.mjs:81–91` | `countPdfEmbeddedImages()` reads PDF binary and counts `/Subtype\s*\/Image` and `/Subtype\s*\/Form` regex hits. No PDF rendering library (pdfjs, etc.) used. | High |
| **Functional tests for publish verify structure gate, not render** | `tests/functional/publish.functional.test.mjs:1–150` | Tests check: gate pass/fail, tooling detection, strict mode, demo provenance. No test renders PDF to bitmap and inspects visual appearance. No Playwright visual regression test. | High |

---

## 3. Existing mechanisms

### Release Gate (`construct publish` default, `construct artifact validate`)

- **Structure lint:** Section presence, heading hierarchy, table formatting (from `visual-requirements.mjs` postconditions)
- **Citation lint:** URL/arxiv/source pattern counts; `[unverified]` marker checks (from `artifact-release-gate.mjs:37–47`)
- **Prose minimum:** Sentence/paragraph counting to enforce delivery depth (from `artifact-release-gate.mjs:93–99`)
- **Reviewer sign-off:** Optional `requiredReviewers` list; checks agent log for reviewer names (from `artifact-reviewers.mjs`, integrated into gate)
- **Frontmatter bypass:** `cx_release_gate: bypass` with reason allows override (e.g., for draft review)

### Export Pipelines

- **PDF:** Pandoc → Typst (branded template; requires `typst` binary)
- **DOCX:** Pandoc → reference doc (optional branding)
- **Deck/HTML:** Pandoc + Construct template (requires `pandoc` binary)
- **PPTX:** pptxgenjs (optional npm dep; brand tokens embedded)
- **Diagram rendering:** Optional `--figures` flag; Pandoc-ext/diagram.lua → d2/graphviz (requires `d2` or `dot` binary)

### Verification (Mathematical, Not Visual)

- **PDF diagram embedding:** Regex scan for image/form objects in binary
- **DOCX diagram embedding:** ZIP inspection for media/ entries + rels check
- **HTML diagram embedding:** SVG/IMG tag count + data:image regex

### Tooling Detection

- `construct tools detect [--json] [--figures]` lists Pandoc, Typst, LibreOffice, d2, graphviz, mmdc, VHS, Playwright presence
- Used by `--strict` publish mode; blocks export if tooling missing (unless `--no-strict`)

---

## 4. Confirmed gaps

### Critical: No Visual Inspection at Export Time

**Finding:** When `construct publish` succeeds, the user has no guarantee that:
- The PDF renders correctly (typography, layout, images at correct resolution)
- Diagram syntax errors silently skipped rendering (raw `direction: right` text left in PDF)
- Brand styling applied (fonts, colors, margins, page numbers)
- Table formatting preserved (alignment, borders, cell wrapping)

**Why it matters:** A gate can pass (structure, citations, prose), and export can complete without errors, but the final PDF could be unreadable or have wrong brand. The CLI does not offer a way to detect this without manually opening the PDF and viewing it.

**Current scope:** 
- Checks that diagram source was NOT left behind (regex pattern match)
- Counts embedded images (regex in binary)
- Does NOT render PDF to verify visual appearance
- Does NOT run a headless browser to check HTML/deck interactivity or CSS rendering

**User impact:** User must manually review exported PDF in a viewer. CLI offers no `construct publish <file> --preview` or `construct publish <file> --verify-render` subcommand.

### Moderate: Diagram Rendering Check is Conservative

**Finding:** `pdfRenderedDiagrams()` (line 93–106 in document-export.mjs) checks:
1. Embedded image/form count ≥ expected diagram count, OR
2. No raw d2/mermaid source patterns found in PDF text layer

This is a **heuristic**, not a proof. A PDF with embedded images will pass even if those images are corrupted or low-quality. A PDF with no raw patterns will pass even if diagrams rendered as blank or oversized.

**Current scope:** The check runs during testing, not during CLI publish. Users do not see this verification in the output.

### Moderate: Release Gate Does Not Inspect Frontmatter Metadata

**Finding:** The release gate checks YAML frontmatter for `releaseGate` and reviewer configs, but does not validate:
- Missing mandatory metadata fields (e.g., `publish.demo`, `cxAudience`, `cxContext`)
- Invalid metadata schemas (wrong value types, unknown keys)
- Consistency with manifest requirements

**Why it matters:** A PDF export could complete successfully without key metadata for downstream systems (dashboard, knowledge base, search index).

### Minor: Reviewer Sign-Off Only Warns, Never Blocks

**Finding:** Missing required reviewers generates a **warning**, not an **error**, in the gate result (line 109–111 in artifact-release-gate.mjs):
```js
if (missing.length > 0) {
  warnings.push(`requiredReviewers not seen in agent log: ${missing.join(', ')}`);
}
```
The gate still returns `ok: true` if no other errors exist. A user can ignore the warning and publish anyway.

**Why it matters:** If an org policy requires sign-off from specific reviewers (e.g., security, legal), the CLI does not enforce it. The gate is advisory only.

---

## 5. Unconfirmed concerns

### Does the Publish Output Accurately Reflect Gate Success?

**Observation:** `runPublish()` returns `ok: ledger.export?.ok !== false` (line 163). If `export.ok === false`, the result fails even if the gate passed.

**Concern:** Does the output message make this clear? If gate passes but export fails, does the user understand that the problem was export, not the gate?

**Evidence:** `runPublish()` line 168 returns `ledger.export?.message || detection.message`. The message comes from the export function, not the gate. If gate passes and export fails, the message will be from export (e.g., "Pandoc not found"), not "gate passed, export failed". This seems correct, but requires tracing export error messages to confirm.

**Verdict:** Likely correct (message comes from the failing stage), but not confirmed by reading all export error paths.

### Do Diagram Checks Run in the Real Publish Flow?

**Observation:** `pdfRenderedDiagrams()` and `docxRenderedDiagrams()` exist in document-export.mjs but are not called from `runPublish()`.

**Concern:** Are they dead code? Or do they run somewhere else (e.g., certification, post-export validation)?

**Evidence:** Searched `lib/publish.mjs`, `lib/publish-tooling.mjs`, `bin/construct`. No calls to `pdfRenderedDiagrams` or `docxRenderedDiagrams` in publish CLI flow. They appear only in test files and (possibly) certification code.

**Verdict:** Likely dead code in the publish path; may run in tests/certification. Requires checking certification code to confirm.

### Does the Manual Bypass Flag Adequately Warn?

**Observation:** `construct publish --no-gate` is described as an "escape hatch". No other warning is displayed when the user provides this flag.

**Concern:** Does the user understand the risk? Is there a confirmation prompt?

**Evidence:** `runPublish()` line 85: `if (gate && !sourceOnly && resolvedType) { ... }`. If `gate: false`, the block is skipped with no confirmation. The help text mentions "escape hatch" but the CLI does not prompt "Are you sure?".

**Verdict:** No confirmation prompt observed. Risky for non-experts, but acceptable for "maintainer escape hatch" label.

---

## 6. Asset-quality contract opportunities

### Opportunity 1: Render Verification CLI Subcommand

**Proposal:** Add `construct publish <file> --verify-render` that:
1. Exports to PDF (or renders to bitmap if headless-chromium available)
2. Runs visual regression checks (compare against golden baseline, or run OCR to detect unreadable text)
3. Reports: font rendering, image quality, diagram visibility, brand color presence, page count vs. expected

**Implementation:** Would need a headless render engine (could use Playwright, puppeteer, or wkhtmltopdf). Optional dependency to avoid bloat.

**Why:** Closes the gap where export can succeed but PDF is broken. Users avoid discovering issues after publication.

### Opportunity 2: Frontmatter Schema Validation

**Proposal:** Add frontmatter validation to the release gate:
1. Load `specialists/artifact-manifest.json` frontmatter schema for the artifact type
2. In `validateArtifactBodyCore()`, validate YAML against schema
3. Report missing required fields, type mismatches, unknown keys

**Implementation:** Parse frontmatter (already done via `parsePublishFrontmatter()`), then validate against manifest schema.

**Why:** Prevents incomplete metadata from reaching export/publication. Catches errors at gate time (cheaper than discovering them downstream).

### Opportunity 3: Reviewer Sign-Off Enforcement

**Proposal:** Allow `releaseGate.requiredReviewers` to hard-block the gate (not just warn):
1. Add `releaseGate.enforceReviewers: true` flag
2. If present and `enforceReviewers: true`, treat missing reviewers as errors, not warnings
3. Default `enforceReviewers: false` to maintain backward compatibility

**Implementation:** Conditional logic in `validateArtifactBodyCore()` lines 109–111.

**Why:** Allows orgs to enforce reviewer gates (e.g., legal review, security sign-off). Currently advisory only.

### Opportunity 4: Post-Export Diagram Verification in CLI

**Proposal:** After export completes, automatically run `pdfRenderedDiagrams()` check and report:
1. Count of expected vs. embedded diagrams
2. Any raw d2/mermaid source found (failed rendering)
3. Suggest remediation: "Re-run with `d2` installed" or "Check diagram syntax"

**Implementation:** Call `pdfRenderedDiagrams(ledger.export.outputPath, sourceContent)` after export succeeds. Report in final message.

**Why:** Catches common render failures (missing d2 binary, syntax errors) at publish time instead of user discovering them later.

### Opportunity 5: Metadata Audit Trail

**Proposal:** Add `construct artifact audit <file>` subcommand that:
1. Reads artifact metadata (frontmatter, manifest type, gate config)
2. Reports: gate status, reviewer history (from .cx/), last export date/format, any publish failures
3. Outputs JSON for downstream systems

**Implementation:** Minimal; read artifact + load `.cx/observations/` for history + format output.

**Why:** Allows orgs to audit artifact lifecycle without direct file access (useful for teams, audit systems).

---

## 7. Render or visual-review requirements

### What Users Cannot Do Today

1. **Screenshot/preview before export:** No `construct publish <file> --preview` mode that renders to HTML or PNG for quick review.
2. **Compare against golden reference:** No regression testing for document appearance (e.g., "compare PDF to golden PDF, report diffs").
3. **Verify fonts/colors/branding:** No automated color/font/layout verification; users must manually inspect PDF.
4. **Check diagram rendering:** Users must manually open PDF and scan for raw d2/mermaid syntax left behind (not automated).
5. **Validate HTML/deck interactivity:** No test of clickable links, slide transitions, form fields in exported HTML/PPTX.

### What Would Be Needed

| Requirement | Implementation | Cost |
|---|---|---|
| PDF bitmap rendering | Playwright/puppeteer or `pdftoppm` (ImageMagick) | ~500 LOC + optional system dep |
| Visual regression | pixelmatch or similar; maintain golden baselines | ~300 LOC + baseline corpus |
| HTML render check | Playwright screenshot + visual diff | ~200 LOC |
| OCR (text quality) | tesseract.js or cloud API | ~100 LOC + optional system dep |
| Diagram visibility scan | Custom image analysis or `identify` (ImageMagick) | ~100 LOC + optional system dep |

---

## 8. Tests needed

### Functional Test: Diagram Rendering Verification in Export

**Test:** After `construct publish diagram-heavy.md --to=pdf` succeeds, call `pdfRenderedDiagrams()` on the output and assert embedded image count ≥ source diagram count.

**Why:** Confirms that the mathematical check actually works in the real export flow (currently only runs in unit tests).

**File:** `tests/functional/publish.functional.test.mjs` (add new test)

### Functional Test: Frontmatter Validation (Future)

**Test:** Publish an artifact with missing required metadata field (e.g., `cxAudience` for a PRD); assert gate fails with clear message.

**Why:** Validates that metadata schema enforcement is possible; defines expected behavior.

**File:** `tests/functional/artifact-release-gate.functional.test.mjs` (add new test)

### Functional Test: Reviewer Gate Hard Block (Future)

**Test:** Publish an artifact with `releaseGate.enforceReviewers: true` but no reviewer names in log; assert gate blocks.

**Why:** Confirms reviewer enforcement works when enabled.

**File:** `tests/functional/artifact-release-gate.functional.test.mjs` (add new test)

### Unit Test: Gate Error Messages are Actionable

**Test:** For each type of gate failure (missing section, no citations, low prose, missing reviewers), assert the error message includes a suggested fix command or docs link.

**Why:** Confirms that users can understand and fix gate failures without reading source code.

**File:** `tests/artifact-release-gate.test.mjs` (add new test)

### Unit Test: No False Claims in Publish Output

**Test:** For all paths in `runPublish()`, assert that success messages do NOT include words like "verified", "reviewed", "checked" unless they are defined in the gate or export logic. Assert that "published" or "exported" are used instead.

**Why:** Ensures CLI output is honest and does not overstate what was actually checked.

**File:** New test file: `tests/publish-messaging.test.mjs`

---

## 9. Docs needed

### CLI Reference: Publish Gate Scope (Minor Update)

**File:** `docs/guides/reference/cli/work.md`

**Current state:** `construct publish` command lists flags but does not explain what the release gate checks.

**Change:** Add a "Release gate scope" section:
```
### Release gate scope (default, `--no-gate` to bypass)

The gate checks:
- Structure: required sections, heading hierarchy
- Citations: URL/arxiv pattern count (minimum 1 unless [unverified])
- Prose: delivery depth (minimum paragraph count per doc type)
- Reviewers: optional; list required reviewers in manifest (warning only)

The gate does NOT check:
- Visual rendering (PDF appearance, diagram quality)
- Metadata completeness (frontmatter fields)
- Brand compliance (fonts, colors, margins)
```

**Why:** Users understand the boundary between automated checks and manual review.

### New Doc: Artifact Render Verification (Future)

**File:** `docs/guides/cookbook/verify-artifact-rendering.md`

**Content:** When to manually review exported PDFs; common issues (missing diagrams, font errors, page breaks); how to debug export failures.

**Why:** Acknowledges the gap and provides workaround guidance.

### README Update: Visual Inspection Disclaimer (Minor)

**File:** `README.md` section "What you can do"

**Current state:** `publish` is listed without caveats.

**Change:** Add a bullet point under publish row:
```
| Publish typed artifacts | Automated release gate (structure, citations, prose, reviewer sign-off). Manual visual review of PDF recommended. |
```

**Why:** Sets expectations; new users understand that publish is not a full validation pipeline.

---

## 10. Dependency and degradation concerns

### Diagram Rendering Degradation

**Current:** If `d2` or `graphviz` binaries missing, Pandoc-ext/diagram.lua silently leaves raw diagram source in PDF (no error raised).

**Concern:** User publishes; gate passes; export succeeds; user opens PDF and finds raw d2 code. Should have failed earlier or warned loudly.

**Mitigation:** Add post-export diagram check (Opportunity 4 above) to catch this.

### Reviewer Sign-Off False Security

**Current:** Reviewer sign-off only warns; does not block.

**Concern:** Org thinks it has reviewer gate; users publish without sign-off; compliance audit fails.

**Mitigation:** Add enforceReviewers flag (Opportunity 3 above); default to false for backward compat, allow org to set true.

### Brand Template Drift

**Current:** PDF template at `templates/distribution/construct-brand.typ` is a single source of truth. If template breaks, all exports fail silently (Typst error, no bitmap output).

**Concern:** User publishes; export fails; error message is cryptic ("typst error: unknown directive").

**Mitigation:** Test PDF export in CI; add Typst error message clarity to export error handler.

---

## 11. Questions for Opus

1. **Should diagram rendering verification be mandatory or optional?** Currently checks are mathematical (image count) and run only in tests. Should `construct publish --figures` automatically verify that diagrams rendered (not just that export completed)?

2. **Should reviewer sign-off be enforceable per-org?** Currently only warns. Is the intent that it's advisory (for awareness) or enforced (policy)? Should `releaseGate.enforceReviewers` be a supported flag?

3. **Is the post-export diagram check (pdfRenderedDiagrams) dead code?** It exists but is not called from the publish CLI. Should it be integrated into publish output, or is it reserved for testing/certification only?

4. **What should happen if frontmatter is invalid or incomplete?** Currently no validation. Should artifacts with invalid metadata be allowed to publish (with warning) or blocked (with error)? Should behavior be configurable per-org or per-artifact?

5. **Is there a design doc for the "render verification" feature request?** If visual/render checks are planned, should they be part of the release gate or a separate validation step?

---

## 12. Suggested bead updates

### Research: Render verification feasibility

**ID:** research/render-verify-feasibility

**Description:** Evaluate headless render engines (Playwright, puppeteer, wkhtmltopdf) for automated PDF/HTML visual verification. Estimate implementation cost, performance impact, dependency footprint.

**Why:** Inform decision on Opportunity 2 (Render Verification CLI Subcommand).

**Acceptance:** Decision doc with pros/cons + recommended engine.

### Feature: Diagram rendering check in publish output

**ID:** feature/publish-diagram-verify

**Description:** After export succeeds, call `pdfRenderedDiagrams()` and report embedded diagram count. If count < expected, report warning: "X of Y diagrams embedded; check d2 binary or diagram syntax."

**Why:** Catches common render failures at publish time instead of user discovering them later.

**Acceptance:** `construct publish <file> --to=pdf` output includes "Diagrams: 3 embedded" line. If count < expected, output includes warning.

### Feature: Reviewer sign-off enforcement flag

**ID:** feature/reviewer-enforce-gate

**Description:** Add `releaseGate.enforceReviewers: true` option to artifact manifest. When set, treat missing reviewers as gate error (not warning).

**Why:** Allows orgs to enforce reviewer policy in gate.

**Acceptance:** `construct artifact validate <file>` fails with error message "requiredReviewers not seen: X, Y" when `enforceReviewers: true` and reviewers missing.

### Research: Frontmatter metadata validation

**ID:** research/frontmatter-schema-validation

**Description:** Design frontmatter schema (per artifact type) and validation logic. Should be sourced from `specialists/artifact-manifest.json` schema blocks.

**Why:** Prevent incomplete metadata reaching export.

**Acceptance:** Documented schema + validation function specification (non-binding until implementation).

### Docs: Artifact publish walkthrough (with manual review step)

**ID:** docs/artifact-publish-walkthrough

**Description:** End-to-end guide: `construct artifact validate` → review gate output → fix issues → `construct publish` → (manual PDF review) → commit. Include screenshot/review checklist.

**Why:** New users understand that publish gate is not a full validation; manual visual review is part of workflow.

**Acceptance:** Guide in `docs/guides/cookbook/artifact-publish-workflow.md`.
