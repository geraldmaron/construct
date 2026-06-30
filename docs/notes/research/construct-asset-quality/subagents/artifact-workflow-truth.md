---
intake: none
---

# Subagent Evidence Report: Workflow truth & completion state

## 1. Summary

Construct's artifact workflow deliberately refuses to fabricate specialist completion claims. The system distinguishes between **planned** steps (identified by policy), **executed** steps (where Construct itself performed local work), and **skipped** steps (where specialists/hosts own execution). Specialist-owned steps (review, rewrite, author, research) are never marked executed unless the host returns evidence. However, the completion-state vocabulary is minimal and asymmetric: **exported/branded artifacts are verified at export time**, but there is **no rendering or visual-review step** in the workflow to validate that PDF/deck branding actually renders correctly or that visual requirements are perceptually met by human eyes.

## 2. Evidence table

| Finding | Evidence file | Evidence | Confidence |
|---------|---------------|----------|------------|
| **State vocabulary exists but is minimal** | `lib/artifact-workflow.mjs:94,111,136,250` | Status values: `needs-classification`, `planned`, `validation-failed`, `export-failed`, `completed-local-steps`. No `reviewed`, `rendered`, `approved`, `visual-verified` states. | High |
| **Specialist steps never fabricated in proposal-only mode** | `lib/artifact-workflow.mjs:158-201` | Review/rewrite/author/research are **always** pushed to `skippedSteps` with reason `approval mode 'proposal-only' permits planning only`. Test confirms executedSteps=[] for planning-only runs. | High |
| **Specialist execution evidence must come from host** | `lib/artifact-workflow.mjs:185-191` | `pendingReason` = `specialist execution is host-owned; this local command has no specialist execution evidence`. Steps only move to executedSteps in `allow-durable-write` mode, and only for **local** operations (validate, export, brand). | High |
| **Brand step is deferred; evidenced by export result only** | `lib/artifact-workflow.mjs:217-246` | Branding step is marked skipped initially with reason: `branding is evidenced by the export result`. Only after export completes and produces `result.branding.applied`, is the brand step moved from skipped to executed. | High |
| **Export validates against observable file artifacts** | `lib/artifact-workflow.mjs:222-248` | Export step checks `sourcePath` exists, calls `exportMarkdown()`, and only marks executed if result is successful. Produces `{ path, format, branding }` metadata. | High |
| **Validation runs but does not test visual rendering** | `lib/artifact-release-gate.mjs:1-100`, `lib/templates/visual-requirements.mjs:71-80` | Release gate checks: structure (markdown headings), visual requirements (presence of fenced `d2`/`mermaid` blocks, table columns). Does NOT render diagrams or preview PDFs to verify fidelity. | High |
| **Visual requirements are declarative, not rendered** | `specialists/artifact-manifest.json:23-26, 44-45, 95-96` | PRD requires `artifact-has-mermaid` (check presence in fence) and `artifact-table-has-columns` (check table structure). ADR requires mermaid diagram. **No post-export screenshot/PDF rendering check.** | High |
| **Export result includes branding metadata but not render fidelity** | `lib/document-export.mjs:1-53`, `lib/artifact-workflow.mjs:240-246` | `exportMarkdown()` returns `{ ok, outputPath, branding, message }`. Branding object reports `{ applied, mechanism }` (e.g., `applied: 'construct'`). No image/screenshot/OCR data. | High |
| **Diagram rendering is attempted but not verified in workflow** | `lib/document-export.mjs:93-100`, `lib/publish.mjs:43-171` | `pdfRenderedDiagrams()` checks PDF content after export for `/Image` or `/Form` objects. `detectPublishPipeline()` probes for d2/mmdc availability. But diagram render fidelity is **not checked in artifact-workflow.mjs**. | Medium |
| **Approval mode is binary: proposal-only vs. durable-write** | `lib/artifact-workflow.mjs:166,185-200` | No intermediate approval state. Either host has no evidence (proposal-only) or all durable writes are allowed (allow-durable-write). No per-step approval workflow. | High |
| **No reviewer evidence required to pass release gate** | `lib/artifact-release-gate.mjs:15-68`, `lib/artifact-reviewers.mjs:57-68` | Manifest lists `requiredReviewers` (e.g., `cx-devil-advocate`). Gate checks for reviewers in `agent-log.jsonl`. **But gate pass does not require reviewers to be present** — gate only fails if they are required AND missing. If no required reviewers in manifest, gate can pass with zero review. | High |
| **Test confirms no specialist execution claims in report** | `tests/artifact-workflow.test.mjs:48-57, 59-67` | `runArtifactWorkflow()` always returns `executedSteps: []` for review/rewrite/author steps. Test `durable approval still marks specialist work skipped without host evidence` confirms even with `allow-durable-write`, specialist steps stay skipped. | High |
| **MCP result envelope maintains provenance distinction** | `tests/mcp-artifact-workflow.test.mjs:11-17`, `lib/mcp/tools/embedded-contract.mjs:62` | `artifactWorkflow()` MCP tool returns contract envelope with `data.executedSteps = []` for specialist steps. No forgery at MCP boundary. | High |
| **No persistent audit trail of who reviewed** | `lib/artifact-reviewers.mjs:15-27` | `readAgentLogReviewers()` reads from `.cx/agent-log.jsonl`, but this file is not written by the workflow system — it assumes an external agent populates it. **No built-in record of review** from Construct itself. | High |
| **Rendering occurs during export; no post-render validation loop** | `lib/publish.mjs:43-171` | `runPublish()` calls `validateArtifactRelease()` before export (structural/citation checks), then `exportMarkdown()` (renders PDF/deck), then optional VHS/Playwright demos. No step to visually inspect the rendered artifact. | High |

## 3. Existing mechanisms

**What Construct DOES verify:**

1. **Structural compliance** (`lib/artifact-release-gate.mjs`):
   - Markdown section headings (e.g., "## Problem" for PRD)
   - Citation patterns (URLs, arxiv IDs, source markers, access dates)
   - Prose paragraph count (at least 3 substantial paragraphs)
   - Comment lint (no fabrication markers like `[unverified]` must be documented)

2. **Visual requirement declarations** (`lib/templates/visual-requirements.mjs`):
   - Presence of fenced code blocks (`\`\`\`mermaid`, `\`\`\`d2`)
   - Table structure (markdown table with required columns)
   - **NOT** whether diagrams actually render or look correct

3. **Export operation validation** (`lib/artifact-workflow.mjs:222-248`):
   - Source file exists
   - Export binary available (Pandoc, Typst, pptxgenjs, LibreOffice)
   - Output file created and path recorded
   - Branding metadata captured (which template applied)

4. **Diagram rendering heuristics** (`lib/document-export.mjs:93-100`):
   - After export, checks PDF for embedded image/form objects
   - Counts `/Image` and `/Form` entries, compares to fence count
   - **Purpose: detect silent export failures**, not verify visual quality

5. **Specialist role tracking** (via external agent-log):
   - `agent-log.jsonl` consumed by `readAgentLogReviewers()`
   - Gate checks if required reviewers appear in log
   - **NOT generated by Construct**; requires host/external logging

## 4. Confirmed gaps

1. **No rendered visual-review step in the workflow**
   - The artifact-workflow enum includes: `research`, `review`, `author`, `validate`, `brand`, `export`
   - **Missing:** A step to open the rendered PDF/deck, inspect layouts, verify brand token application, check diagram rendering quality
   - **Why:** Host captures this; Construct cannot claim it happened

2. **Branding metadata does not include render fidelity evidence**
   - `export()` returns `{ applied: 'construct', mechanism: 'construct-brand.typ' }`
   - Does NOT return: screenshot, render log, error log from Typst, OCR of output, font fallback warnings
   - **Impact:** Cannot re-verify branding actually worked if Typst silently degraded fonts or diagrams

3. **Diagram rendering verification is heuristic, not semantic**
   - `pdfRenderedDiagrams()` counts image objects; never validates that the diagram content matches the `.d2` or `.mermaid` source
   - If d2 renders a syntax error as "invalid diagram" box, the heuristic still passes because an `/Image` object exists
   - **Unverified claim:** "Diagram was correctly rendered"

4. **Review step is declared but never executed locally**
   - Manifest lists `requiredReviewers: ["cx-devil-advocate"]`
   - Release gate checks if they appear in agent-log
   - **But:** No mechanism to wait for review, re-trigger on rejection, track review feedback, or link review evidence to the artifact
   - **Status:** Review is "skipped" with reason "host-owned"

5. **No "re-render" or "re-validate" loop after specialist feedback**
   - If host updates artifact after specialist review, there is no automated loop to re-validate and re-render
   - User must manually call `construct publish` again
   - **No completion state** tracks "pending specialist changes" or "awaiting re-export"

6. **Approval is binary, not granular**
   - `approvalMode` only recognizes `proposal-only` (no writes) or `allow-durable-write` (all writes allowed)
   - No per-step approval (e.g., "approve author, await review, then export")
   - **No intermediate states** like `awaiting-approval`, `partially-approved`, `review-failed`

7. **Agent-log reviewer evidence is not authenticated or role-verified**
   - `readAgentLogReviewers()` trusts whatever `agent` or `specialist` field appears in the log
   - No verification that the named reviewer is actually authorized to review that artifact type
   - **Impact:** A malicious entry could fake `"specialist": "cx-devil-advocate"` in the log

## 5. Unconfirmed concerns

1. **Whether publish pipeline validates diagram render success**
   - `lib/publish.mjs` calls `detectPublishPipeline()` to probe d2/mmdc availability
   - But `runPublish()` does not call `pdfRenderedDiagrams()` to verify render fidelity
   - **Unconfirmed:** Does `construct publish --figures` actually verify that diagrams rendered?
   - **Evidence location:** `lib/publish.mjs` (need full read to confirm)

2. **Whether exported PDF is ever opened or screenshotted for review**
   - Codebase includes Playwright demo recording (`lib/playwright-demo.mjs`)
   - But no tool called "open and screenshot exported PDF"
   - **Unconfirmed:** Do any downstream processes (CI/dashboard/QA) visually inspect exported files?
   - **Evidence location:** Tests or CI pipeline (not yet checked)

3. **Whether visual-requirements lint catches all forgeable claims**
   - A PRD could include `## Problem` heading but claim it's a PRD-platform without code proof
   - Visual lint checks for mermaid/table structure but not content correctness
   - **Unconfirmed:** Can a malicious actor pass gate with structurally sound but semantically false content?
   - **Evidence location:** `lib/templates/visual-requirements.mjs`, gate tests

4. **Whether citation lint actually verifies links are live**
   - Citation lint counts URL patterns and arxiv markers
   - **Unconfirmed:** Does it fetch and verify URLs are not broken?
   - **Evidence location:** `lib/artifact-release-gate.mjs` (need full citation-lint implementation)

## 6. Asset-quality contract opportunities

### 6.1 Proposed completion-state expansion

| State | Condition | Evidence required |
|-------|-----------|-------------------|
| `drafted` | Markdown source written and saved to disk | File path + mtime |
| `gate-passed` | Structural/citation/prose lint passed | Gate result object with errors=[] |
| `author-completed` | Author specialist finished (host-reported) | Agent log entry + timestamp |
| `reviewed` | Required reviewers provided feedback (host-reported) | Agent log + review notes path |
| `rewrite-completed` | Revisions made per review (host-reported) | Git diff or artifact timestamp |
| `validated-exported` | Export to target format succeeded | Exported file path + file hash |
| `visually-rendered` | PDF/deck opened and rendered without errors | Typst/Pandoc exit code + stderr log |
| `visual-reviewed` | Human inspection of rendered artifact (host-reported) | Screenshot/PDF path + approval marker |
| `published` | Artifact distributed to intended audience | Distribution log entry |

### 6.2 Proposed evidence chain

Each state transition should capture:
- **Actor:** Which role/specialist/system performed the action
- **Timestamp:** When the action occurred (ISO 8601)
- **Artifact:** Which file(s) were produced or validated
- **Digest:** SHA256 or similar to detect tampering
- **Proof:** The proof object (file path, test output, agent log, etc.)
- **Reversible:** Can this state be reverted? (e.g., re-export if source changes)

Example:
```json
{
  "state": "visually-rendered",
  "actor": "construct-export",
  "timestamp": "2025-06-29T14:32:00Z",
  "artifact": "docs/prd/2025-06-29-platform-vision.pdf",
  "digest": "sha256:abc123...",
  "proof": {
    "source": "lib/artifact-workflow.mjs:240",
    "exportResult": {
      "ok": true,
      "outputPath": "/abs/path/to/prd.pdf",
      "branding": { "applied": "construct", "mechanism": "construct-brand.typ" },
      "renderLog": "/abs/path/to/.cx/logs/export-2025-06-29-143200.log",
      "diagramsEmbedded": 3,
      "diagramsExpected": 3
    }
  },
  "reversible": true
}
```

## 7. Render or visual-review requirements

### 7.1 Currently unmet

1. **No PDF render validation step**
   - Exported PDF is created but never opened to verify:
     - Fonts render correctly (Space Grotesk, JetBrains Mono availability)
     - Images/diagrams appear in correct positions
     - Page breaks occur at logical boundaries
     - Brand colors (monochrome ink ramp from `lib/brand-tokens.mjs`) apply correctly

2. **No deck/PPTX visual review**
   - HTML deck and PPTX exports are generated but never rendered in a browser or slide viewer
   - Font embedding status unknown (see `lib/brand-fonts.mjs`: "Requires `pptx-embed-fonts` is installed")
   - Slide layouts may not match expected Construct brand theme

3. **No diagram render quality heuristic**
   - After export, could check PDF for common diagram-rendering failures:
     - Empty diagram (only bounding box, no content)
     - Diagram size too small to read (sub-6pt text)
     - Missing labels or connections
   - Currently only checks presence of image objects

### 7.2 Proposed lightweight additions

**For PDF export:**
- Capture Typst stderr log (`--output-stderr` or similar) and include in render evidence
- Count embedded fonts and compare to template expectations
- Check PDF page count matches expected structure (e.g., PRD should be 8-15 pages)

**For deck/PPTX:**
- Generate a headless Chrome screenshot of first 3 slides to detect layout breakage
- Validate font embedding when pptxgenjs writes PPTX

**For diagrams:**
- After PDF export, use `pdftotext` or similar to extract diagram regions and check for placeholder text ("invalid diagram", "error", "timeout")

## 8. Tests needed

1. **Provenance test: Confirm export step includes full render metadata**
   ```javascript
   test('export step captures render log and diagram count', () => {
     const report = runArtifactWorkflow({ ... }, { approve: 'allow-durable-write' });
     const exportStep = report.executedSteps.find(s => s.id === 'export');
     assert.ok(exportStep.evidence.renderLog, 'render log path required');
     assert.ok(typeof exportStep.evidence.diagramCount === 'number');
   });
   ```

2. **Diagram validation: Confirm rendered diagrams are not error placeholders**
   ```javascript
   test('PDF with invalid d2 diagram is flagged in render evidence', () => {
     const badPdf = '/path/to/export-with-bad-diagram.pdf';
     const evidence = validatePdfDiagrams(badPdf);
     assert.ok(evidence.warnings.some(w => /invalid|error|timeout/.test(w)));
   });
   ```

3. **Branding audit: Confirm exported PDF uses correct template**
   ```javascript
   test('PRD export includes construct-prd.typ in branding.mechanism', () => {
     const result = exportMarkdown({ ... });
     assert.match(result.branding.mechanism, /construct-prd\.typ/);
   });
   ```

4. **Visual requirement validation: Confirm visual checks run before export**
   ```javascript
   test('artifact failing visual requirement is blocked from export', () => {
     const report = runArtifactWorkflow({
       input: 'PRD without mermaid diagram',
       sourcePath: '/path/to/prd-no-diagram.md'
     });
     assert.ok(report.validation.errors.some(e => /mermaid|diagram/.test(e)));
     assert.ok(report.skippedSteps.some(s => s.id === 'export'));
   });
   ```

## 9. Docs needed

1. **docs/guides/reference/artifact-completion-states.md** (new)
   - Define all completion states with examples
   - Show how to interpret `executedSteps`, `skippedSteps`, reason codes
   - Explain when specialist evidence is required
   - Map states to learning-loop feedback (§ 10 below)

2. **Update docs/guides/reference/mcp-tools.md**
   - `artifact_workflow` tool: add note that specialist steps (review, author) are reported as skipped when host owns execution
   - `publish_run` tool: document that PDF render evidence is limited to exit code and diagram count

3. **docs/guides/cookbook/visual-review-checklist.md** (new)
   - Step-by-step guide for human visual review of exported PDFs
   - Brand checklist (fonts, colors, spacing)
   - Diagram quality checklist
   - Page layout expectations by artifact type
   - When to re-export vs. accept degradation

4. **Update CLAUDE.md rules section**
   - Add: "Artifact completion states must never claim specialist execution without host evidence. See artifact-completion-states.md for valid states."

## 10. Dependency and degradation concerns

### 10.1 Dependencies

- **Pandoc + Typst:** PDF/deck export depends on external binaries. If absent, export fails and step stays skipped.
- **d2 or graphviz:** Diagram rendering requires vendor tools. If absent, diagrams are skipped but artifact still exports.
- **Agent-log.jsonl:** Reviewer tracking depends on external logging. If log is absent or empty, gate may fail if reviewers are required.
- **Specialist manifest (specialist/artifact-manifest.json):** Release gate policy comes from manifest. Invalid manifest → gate fails closed.

### 10.2 Degradation modes

| Scenario | Current behavior | Risk |
|----------|------------------|------|
| Typst fails silently (e.g., font not found) | PDF exports but may use fallback fonts | User doesn't know branding degraded |
| Diagram too complex for d2 | Diagram fenced but not rendered | User claims it's in PDF; it isn't |
| Agent-log.jsonl is missing | `readAgentLogReviewers()` returns empty Set; gate fails if reviewers required | Legitimate artifacts blocked; no recovery path |
| Manifest requires unknown reviewer role | Gate rejects artifact; unclear how to fix | User must edit manifest or lower requirements |
| Export to PPTX with missing fonts | pptxgenjs substitutes fonts silently | Deck doesn't look like brand; user unaware |

### 10.3 Feedback to learning loop

Currently, no mechanism exists to feed render failures back into the authoring loop. Proposed:

1. If export fails, capture error in a `render_failures.jsonl` file
2. On the next authoring-loop run, include render errors in the authoring prompt
3. Mark artifact as `render-failed` state so it's not distributed until re-exported successfully

## 11. Questions for Opus

1. **Rendering/approval in Construct's model:** Should visual-review be a mandatory step for distribution, or is it the host's responsibility?
   - Currently: Host responsibility (review is "skipped" as "host-owned")
   - Question: Should Construct provide a lightweight "render and screenshot" step that hosts can invoke?

2. **Branding audit trail:** Should exported files embed metadata (PDF XMP, DOCX custom properties) recording which template was applied?
   - Currently: Only in MCP result object; not in file itself
   - Risk: File separated from result object; reader can't verify provenance

3. **Diagram render fidelity validation:** Is counting PDF image objects sufficient, or should Construct OCR the PDF to verify diagram content?
   - Currently: Heuristic (count objects; compare to fence count)
   - Alternative: `pdftotext` extraction to check for error messages

4. **Reviewer evidence authentication:** Should agent-log entries be signed/authenticated, or is trust in external logging sufficient?
   - Currently: Trusts external source entirely
   - Risk: Log spoofing; unknown how to audit

5. **Re-render automation:** Should the authoring loop automatically re-export artifacts if source changes, or should the user explicitly request it?
   - Currently: Manual `construct publish` required
   - Tradeoff: Automation vs. cost (re-rendering expensive)

## 12. Suggested bead updates

- [ ] **Audit findings:** Log unconfirmed concerns (§5.1, 5.2, 5.3, 5.4) in a Beads ticket for follow-up investigation
- [ ] **Contract opportunity:** Create a Beads design ticket to spec expanded completion-state vocabulary and evidence chain (§6.1, 6.2)
- [ ] **Render validation:** Create a Beads feature ticket to add lightweight PDF render heuristics (capture Typst log, check page count, OCR diagrams) — backlog if design ticket confirms need
- [ ] **Documentation:** Create Beads doc ticket to write artifact-completion-states.md and update CLAUDE.md (§9)
- [ ] **Test coverage:** Create Beads test ticket to add provenance + visual-validation tests (§8)

---

**Report prepared by:** Construct audit subagent (Agent I)  
**Date:** 2025-06-29  
**Confidence:** High (verified via code inspection + test audit)  
**Scope:** Artifact workflow truth & completion-state model per assignment
