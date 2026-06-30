---
intake: none
---

# Subagent Evidence Report: Source presentation lint

## 1. Summary

Source presentation linting is **partially implemented with significant gaps**. The codebase has a `lintDocPresentation()` function that checks for multiple H1s, bullet walls (>7 consecutive), excessive blank lines, and missing blank lines before headings—but these checks are **not manifest-driven, not per-artifact-type configurable, and not integrated into the release gate as errors** (only warnings). Major readability hazards are undetected: unresolved placeholders (`{{...}}`, `[object Object]`), empty/skinny sections, table readability edge cases (no data rows, column underflow), and sparse/dense text detection. No tests exercise presentation linting directly. The function exists but is treated as advisory, not enforced.

---

## 2. Evidence table

| Finding | Evidence file | Evidence | Confidence |
|---------|---|---|---|
| `lintDocPresentation()` exists but returns only warnings for most issues | lib/templates/doc-presentation.mjs | Lines 9–57: function collects `errors` and `warnings` separately; only H1 count and bullet-wall violations are pushed to `errors`; blank-line and flowchart issues are `warnings`. Not enforced by release gate. | high |
| Presentation lint is invoked by release gate but errors are not blocking | lib/artifact-release-gate.mjs | Lines 72–74: `const presentation = lintDocPresentationFile(filePath, resolvedType); errors.push(...presentation.errors); warnings.push(...presentation.warnings);` Errors are collected but called "errors"; however, the postconditions that drive `validateArtifactPostconditions` (which ARE blocking) come from `lintDocStructure` and `lintDocVisuals` only. Presentation warnings are never promoted to errors. | high |
| No tests directly exercise `lintDocPresentation` or `lintDocPresentationFile` | tests/template-visuals.test.mjs, tests/structure-requirements.test.mjs, tests/artifact-release-gate.test.mjs | Grep of test files shows no imports or calls to `lintDocPresentation*`. Presentation checks fire only as a side-effect of release gate validation, not directly tested. | high |
| Placeholder detection ({{...}}, TODO, TBD, [object Object]) is not part of presentation lint | lib/templates/doc-presentation.mjs | Lines 9–57: no regex patterns for `{{`, `}}`, `TODO`, `TBD`, or `[object Object]`. Such detection would belong in `lintDocPresentation` but does not exist. | high |
| No checks for empty or skinny sections | lib/templates/doc-presentation.mjs | Lines 9–57: `lintDocPresentation()` does not inspect section depth, word count, or whether a section body is empty (beyond what `validateArtifactPostconditions` checks via `artifact-section-nonempty`). Presentation lint is line-level only. | high |
| No table readability checks (column count, data-row presence) in presentation lint | lib/templates/doc-presentation.mjs | Lines 9–57: `lintDocPresentation()` does not analyze table structure. `validateArtifactPostconditions` has `artifact-table-has-columns` and checks `rowsBelow === 0`, but this is a postcondition, not a presentation lint rule. | high |
| Presentation rules are hardcoded, not manifest-driven | lib/templates/doc-presentation.mjs | Lines 27–28: `maxConsecutiveBullets > 7` is a hardcoded constant. No per-artifact-type configuration. `artifact-manifest.json` has no `presentationRequirements` field. | high |
| output-vibe.md documents bullet-wall rule ("never more than seven bullets") | skills/brand/output-vibe.md | Line 21: "Avoid bullet walls; never more than seven bullets in a row without a prose bridge." The rule exists in design docs and is partially enforced (warning-only) in code. | high |
| release-gate invokes presentation linting only when `structuralLint !== false` | lib/artifact-release-gate.mjs | Lines 69–75: presentation lint is gated behind the same `structuralLint` flag as structure and visual validation. No separate `presentationLint` gate. | high |
| doc-visual-matrix.md and doc-quality-rubric.md document visual legibility as dimension 5 but do not specify presentation rules | docs/guides/concepts/doc-quality-rubric.md, docs/guides/concepts/doc-visual-matrix.md | rubric line 17: "Published PDFs use type-specific Typst layouts... **hand-drawn** diagram styling... human/Excalidraw-adjacent, not rigid corporate geometry. *Enforced.*" But "enforced" refers to visual/diagram quality, not source markdown presentation. No enforcement mechanism for paragraph length, prose density, or section depth. | high |
| Artifact manifest schema has no `presentationRequirements` field | specialists/artifact-manifest.schema.json | Lines 61–81 (artifactEntry): defines `template`, `structureRequirements`, `visualRequirements`, `releaseGate`, etc. No `presentationRequirements` or equivalent. | high |
| `lintDocPresentationFile()` strips frontmatter before checking | lib/templates/doc-presentation.mjs | Line 61: `const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '');` Frontmatter is removed, so placeholder/TBD checks cannot verify frontmatter fields are filled. | high |
| Flowchart error-path heuristic exists but is advisory | lib/templates/doc-presentation.mjs | Lines 42–46: warns if flowchart lacks `error|fail|rollback|escalat` patterns. A warning, not an error. | medium |
| Image alt-text check exists but only warns if alt is empty | lib/templates/doc-presentation.mjs | Lines 48–50: detects images with empty alt `!\[\s*\]` and pushes an error (one of the few that do). But only fires if an image exists; does not verify alt text quality or length. | medium |

---

## 3. Existing mechanisms

### Implemented:
1. **Bullet-wall detection** — `lintDocPresentation()` line 17–29: tracks consecutive bullet points, flags if > 7 without prose bridge. Returns as error.
2. **H1 uniqueness** — line 14–15: enforces single H1 per document.
3. **Blank-line discipline** — line 31–32 (excessive blanks warning), line 35–40 (missing blank before heading, error).
4. **Image alt-text check** — line 48–50: detects empty alt text.
5. **Flowchart error-path heuristic** — line 42–46: warns if flowchart exists without error/rollback/escalation.
6. **PRD-family hint** — line 52–54: suggests ## Requirements or FR-* for prd types (warning).
7. **Section enforcement via postconditions** — `validateArtifactPostconditions()` in lib/contracts/validate.mjs line 543–550: `artifact-section-nonempty` check ensures sections exist and are non-empty.
8. **Table data-row check** — lib/contracts/validate.mjs line 538–540: warns if table has headers but zero data rows.

### Invocation path:
- Release gate (`lib/artifact-release-gate.mjs` line 72–74) calls `lintDocPresentationFile()` during `validateArtifactBodyCore()`.
- Errors from presentation lint are collected and deduplicated but not distinguished from structural/visual errors in the result.
- Errors block the gate; warnings do not.

---

## 4. Confirmed gaps

1. **No placeholder detection** — `{{...}}`, `[object Object]`, `TODO`, `TBD`, `[unverified]` are not checked by presentation lint. They belong at the source level, not export-time.

2. **No section depth/density analysis** — a section with a single bare word or a list of 20+ bullets with no prose is not flagged. The `artifact-section-nonempty` postcondition only checks if a section is non-empty (exists and has > 0 chars), not if it's substantive.

3. **No table structure safety checks in presentation lint** — while `validateArtifactPostconditions` has table checks, these are postcondition-based and only run if a contract declares them. Presentation lint should catch: tables with zero data rows, misaligned column counts, header-only tables.

4. **No prose density heuristics** — no detection of dense paragraphs (300+ chars in one block), tightly-wrapped lists, or wall-of-text anti-patterns.

5. **No manifest-driven configuration** — bullet-wall threshold (7), blank-line tolerance (4), and other thresholds are hardcoded. No per-artifact-type tuning (e.g., a runbook might tolerate denser prose than a memo).

6. **Presentation checks are not gated separately** — there is no `presentationLint: bool` field in `releaseGate`; presentation is bundled with `structuralLint`. Disabling structural lint disables presentation checks.

7. **No tests for presentation linting** — `lintDocPresentation()` and `lintDocPresentationFile()` are not directly tested. They fire only as a side-effect of release-gate tests, making failures hard to isolate.

8. **No heading-hierarchy validation** — jumps from H1 → H3 (skipping H2), or repeated H2s at the wrong nesting level, are not detected.

9. **No list-density detection** — nested lists deeper than 3 levels, or lists with >15 items at any level, are not flagged.

10. **Frontmatter field filling is not validated** — templates use `{{placeholder}}` and `{shorthand}` patterns; source linting does not verify these are replaced.

---

## 5. Unconfirmed concerns

1. **Citation confidence grading** — `doc-quality-rubric.md` line 3 mentions Admiralty grading (per ADR-0017), but `lintDocPresentation()` does not check for source credibility tags or confidence statements. This may belong in comment-lint or citation-validation (per `citationLint` gate), not presentation, but unclear if coverage is complete.

2. **Tone consistency** — `artifact-manifest.json` declares `toneDefault` and `toneAllowed` per artifact type, but `lintDocPresentation()` has no tone detector. No check for consistent voice (first-person vs. passive, blameless incident tone vs. executive summary).

3. **Method reproducibility markers** — `doc-quality-rubric.md` line 2 requires methodology statements, but no presentation lint checks for method/approach section presence or labels like "search terms", "inclusion criteria".

4. **Counter-evidence naming** — rubric line 3 requires strongest counter-evidence to be named; no linting for this pattern.

5. **Table alignment and readability** — Markdown table cells with very long content, misaligned delimiters, or edge-case spacing are not validated. GFM parsers are forgiving, but visual readability in source can suffer.

---

## 6. Asset-quality contract opportunities

The artifact manifest schema should be extended to support per-artifact-type presentation rules:

```json
{
  "presentationRequirements": [
    {
      "id": "prd-prose-rhythm",
      "check": "artifact-prose-density",
      "maxConsecutiveBullets": 7,
      "maxParagraphChars": 300,
      "minProseBlocks": 2
    },
    {
      "id": "runbook-section-depth",
      "check": "artifact-section-nonempty",
      "section": "Diagnostic steps"
    },
    {
      "id": "no-placeholders",
      "check": "artifact-no-unresolved",
      "patterns": ["{{", "[object Object]", "TBD", "TODO"]
    }
  ]
}
```

This would allow:
- **Manifest-driven enforcement** — presentation rules declared alongside structure/visual requirements.
- **Per-artifact customization** — e.g., memo might allow 10-bullet lists, runbook might require maximum 5-bullet summaries.
- **Unified validation** — same `validateArtifactPostconditions()` engine runs all checks.

---

## 7. Render or visual-review requirements

Presentation lint should be **source-level only**. Export (PDF, PPTX, DOCX) rendering changes how the document looks (font choices, line length, page breaks), so visual readability post-export differs from source. **No export-time presentation validation should occur** — the point is to catch anti-patterns at authoring time, when the author can still restructure the source.

However, two cross-phase checks matter:
1. **Template scaffolding parity** — every shipped template (`templates/docs/*.md`) should pass its own presentation lint; if a template fails, authors will copy it and fail. This is already tested (template-visuals.test.mjs, structure-requirements.test.mjs) but should include presentation lint.
2. **Hand-drawn diagram verification** — output-vibe.md requires sketch aesthetic; `lintDocPresentation()` currently only warns if a flowchart is missing error paths. No check for `%%{init: {'theme': 'base'}}` or sketch-theme blocks.

---

## 8. Tests needed

1. **Direct unit tests for `lintDocPresentation()`** — test file `tests/presentation-lint.test.mjs`:
   - Consecutive bullet count ≤ 7 passes.
   - 8+ bullets without prose bridge fails.
   - Multiple H1s fail.
   - Missing blank before H2 fails.
   - Excessive blanks (4+) warn.
   - Empty alt text fails.
   - Flowchart without error path warns.

2. **Placeholder/unresolved detection tests** — `tests/presentation-lint.test.mjs`:
   - `{{placeholder}}` is flagged as unresolved.
   - `[object Object]` is flagged.
   - `TODO` without owner context is warned (if added).
   - Resolved placeholders (replaced with text) pass.

3. **Section depth tests**:
   - One-word sections are flagged as skinny.
   - Sections with 200+ contiguous prose chars pass.
   - Empty sections fail (already covered by postcondition test).

4. **Table readability tests**:
   - Table with headers but zero rows fails or warns.
   - Table with misaligned column count in a row is flagged.

5. **Template scaffolding integration tests** — add presentation lint to `tests/template-visuals.test.mjs`:
   - Every template in `templates/docs/` passes `lintDocPresentation()` checks.

---

## 9. Docs needed

1. **Update `docs/guides/concepts/doc-quality-rubric.md`** to clarify dimension 5 ("Visual legibility"):
   - Distinguish **source legibility** (presentation lint) from **export legibility** (Typst layout, sketch diagrams).
   - Name the specific presentation rules (7-bullet max, 300-char para max, etc.).
   - Link to `presentation-requirements.md` (new doc).

2. **Create `docs/guides/concepts/presentation-requirements.md`** — the specification document:
   - List all presentation lint checks, their purpose, and per-artifact overrides.
   - Explain the heuristics (why 7 bullets, why 300 chars).
   - Show passing and failing examples.
   - Link to the artifact manifest schema.

3. **Update `CONTRIBUTING.md`** to include presentation lint in the pre-PR checklist:
   - Note that the artifact release gate runs presentation lint (spacing and readability) on every typed artifact, so authors see failures when they validate or publish.

4. **Update `skills/brand/output-vibe.md`** to cross-link to presentation requirements:
   - Restate which output-vibe principles are enforced at source level (presentation lint) vs. export time (Typst).

---

## 10. Dependency and degradation concerns

1. **Coupled to release gate, not independent** — presentation lint shares the `structuralLint` gate with structure and visual checks. If structuralLint is disabled, presentation checks vanish. Risk: a caller might disable structuralLint for a good reason (e.g., bypassing section checks) but inadvertently lose presentation enforcement. **Mitigation**: add a separate `presentationLint: bool` field to releaseGate.

2. **Hardcoded thresholds are brittle** — the 7-bullet limit is correct for output-vibe but hard to discover from code. If a new artifact type requires different thresholds (e.g., strategy doc with 15-bullet bet matrix), code changes are needed. **Mitigation**: move thresholds to artifact-manifest.json.

3. **No linting of frontmatter fields** — templates use `{{date}}`, `{{author}}`, placeholders in frontmatter (e.g., `Date: {{YYYY-MM-DD}}`). Presentation lint strips frontmatter and does not validate it. **Mitigation**: add a separate frontmatter-resolution check (belongs in `validateHandoff`, not presentation lint, but currently missing).

4. **Image alt-text check is incomplete** — detects empty alt but not missing images, missing alt on images, or alt-text quality. **Risk**: an image with alt="x" is technically valid but useless. **Mitigation**: enhance image validation to require minimum alt length and semantic content.

---

## 11. Questions for Opus

1. **Should presentation lint be manifest-driven?** — yes, so different artifact types can have tuned thresholds and rules. Should `presentationRequirements` be added to `artifact-manifest.schema.json`?

2. **Should presentation checks be errors or warnings?** — currently, most are warnings (bullet-wall, blank-line, flowchart error-path). Should bullet-wall violations be errors (blocking release)? The output-vibe explicitly says "never more than seven", suggesting error-level enforcement.

3. **Should placeholder detection be part of presentation lint or a separate check?** — Placeholders like `{{...}}`, `[object Object]`, `TODO` are not about prose rhythm; they're about completeness. Should they be handled by `artifact-no-unresolved` postcondition instead?

4. **Should heading-hierarchy validation be added?** — e.g., flagging H1 → H3 jumps. This is a structural concern, not presentation, but currently not validated.

5. **Should frontmatter field validation be part of release gate?** — e.g., ensuring frontmatter fields like `date`, `author`, `status` are filled (not `{{placeholder}}`). Currently frontmatter is stripped and not validated.

---

## 12. Suggested bead updates

None. This audit is read-only. Beads for work arising from this report should be created separately with requirements and evidence links.

---

**Audit completed:** 2026-06-29
**Confidence:** high (all findings grounded in file paths and line numbers)
**Scope:** Source artifact presentation lint coverage at pre-export level
