# Subagent Evidence Report: Artifact surface & manifest

## 1. Summary

The artifact manifest system declares 27 document types with source-level validation only. Zero artifacts declare output formats or branding overrides; all depend on workflowDefaults alone. The `visualRequirements` schema checks **source markdown structure only** (mermaid presence, table columns) and runs no render/export/accessibility/completion-state inspection. The `releaseGate` is source-only (structuralLint, citationLint, proseMinimum, requiredReviewers, optionalReviewers) with no exported-file validation. Critical asset classes (image, screenshot, diagram-as-asset, deck-as-asset, PDF/DOCX/PPTX as first-class typed outputs) are entirely absent from the manifest contract.

## 2. Evidence table

| Finding | Evidence file | Evidence | Confidence |
|---------|---------------|----------|------------|
| 27 artifacts registered; 0 declare `outputs` block | `specialists/artifact-manifest.json` | Line 14–489: `artifacts` object; jq query confirms 0 artifacts with `outputs != null` | HIGH |
| `outputs` schema exists but unused | `specialists/artifact-manifest.schema.json` lines 54–60 | `outputs` defined as optional with `formats[]` and `branding`; all 27 artifacts rely on `workflowDefaults.outputs` only (line 9–12) | HIGH |
| `visualRequirements` is source-inspection only | `specialists/artifact-manifest.schema.json` lines 18–27 | `check` enum contains only `["artifact-has-mermaid", "artifact-table-has-columns"]`; no render/export/a11y/completion-state checks | HIGH |
| `lintDocVisuals` validates source markdown only | `lib/artifact-release-gate.mjs` line 71 | Calls `lintDocVisuals(filePath)` which scans markdown text for diagram+table presence; no export or rendered-file inspection | HIGH |
| `releaseGate` has no render/visual/a11y/completion-state fields | `specialists/artifact-manifest.schema.json` lines 28–37 | Properties: structuralLint, citationLint, proseMinimum, requiredReviewers, optionalReviewers only; no completion-state, render-check, accessibility-audit, or visual-fidelity fields | HIGH |
| Export workflow is separate from validation | `lib/artifact-workflow.mjs` lines 217–248 | Export (branding, PDF/DOCX/PPTX generation) is deferred as separate "export" step; validation runs on source markdown before export | HIGH |
| No typed asset classes in manifest | `specialists/artifact-manifest.json` (all 27 entries) | No `documentClass` values for "image", "screenshot", "diagram", "deck-asset", "pdf-asset", "docx-asset", "pptx-asset"; `documentClass` when present (none observed) would mirror the artifact type | MEDIUM |
| Export formats are workflow-level, not artifact-level | `lib/artifact-manifest.mjs` lines 150–154 | `outputs.formats` resolved at workflow contract time; formats list is de-duplicated from manifest defaults + entry overrides + project config + invocation overrides | HIGH |
| No export-fidelity or quality-metric fields | `specialists/artifact-manifest.schema.json` (complete scan) | Schema allows only source-level validation fields; no branding-fidelity, pdf-quality, pptx-visual-theme, or render-completeness fields | HIGH |
| Author/reviewer chains support branding execution but not asset-output validation | `lib/artifact-manifest.mjs` lines 145–150 | `authorChain` and `reviewerChain` resolve from manifest; no chain for "export-reviewer", "asset-quality-reviewer", or "render-validator" | MEDIUM |
| Completion-state vocabulary is absent | `lib/artifact-workflow.mjs` lines 157–252 (runArtifactWorkflow) | Workflow report tracks plannedSteps/executedSteps/skippedSteps with actions=[research, review, rewrite, author, validate, brand, export]; no "completion-check", "render-audit", or "quality-gate" action types | HIGH |

## 3. Existing mechanisms

### Source validation (artifact-release-gate.mjs)
- **structuralLint**: `lintDocStructure(filePath, type)` scans markdown headings and section presence against `structureRequirements`
- **visualRequirements**: `lintDocVisuals(filePath, type)` verifies that mermaid/flowchart/sequenceDiagram blocks or table structures with required columns exist in the markdown text
- **citationLint**: `countCitations(body)` counts URLs and arxiv patterns in markdown prose
- **proseMinimum**: `countProseParagraphs(body)` enforces minimum sentence/block count
- **reviewersSeen**: Frontmatter parsing detects required vs optional reviewers from YAML metadata
- **presentationFile check**: `lintDocPresentationFile(filePath)` audits PPTX rendering via pandoc for deck type only (evidence in export workflow, not release gate)

### Export workflow (artifact-workflow.mjs + document-export.mjs)
- Plans workflow steps: research → review → author → validate → brand → export
- Export runs only when `approvalMode: allow-durable-write` is set
- Branding is applied by export engine (Typst for PDF, pandoc+template for DOCX, pptxgenjs for PPTX)
- No structured completion-state report after export; export result surfaced as { ok, outputPath, branding: { applied, mechanism } }

### Manifest structure (artifact-manifest.json + schema)
- 27 artifacts: prd, prd-platform, prd-business, meta-prd, adr, rfc, rfc-platform, research-brief, evidence-brief, signal-brief, runbook, incident-report, postmortem, strategy, memo, prfaq, one-pager, customer-profile, backlog-proposal, test-plan, qa-strategy, changelog, architecture-overview, system-design, security-review, threat-model, product-intelligence-report
- All declare: template, primaryOwners, toneDefault, releaseGate
- Optional: workflowSkill, toneAllowed, structureRequirements, visualRequirements, researchProfile, documentClass, aliases, authorChain, reviewerChain, validation, outputs
- workflowDefaults provides fallback: formats=[pdf, docx, doc, deck, pptx, html, rtf, odt, epub, tex, txt, md, mdx], branding=construct

### MCP surface (lib/mcp/server.mjs + docs/guides/reference/mcp-tools.md)
- `author_artifact` tool: materializes typed artifact markdown to disk, runs release gate, returns path + PASS/FAIL verdict + errors/warnings
- `artifact_workflow` tool: plans manifest workflow or performs local validation/export with approval gate
- `document_export` tool: exports markdown to PDF/DOCX/PPTX/HTML/deck/etc via pandoc/typst/pptxgenjs; returns { ok, missing_tooling[], message }
- `publish_run` tool: export + optional figure rendering + optional demo recordings
- No MCP tool for "export-quality audit", "render validation", "asset inventory", or "completion-state report"

### Registered artifact types (27 total from manifest)
**Product & Strategy**: prd, prd-platform, prd-business, meta-prd, strategy, prfaq, one-pager, memo, customer-profile, backlog-proposal, product-intelligence-report
**Technical**: adr, rfc, rfc-platform, architecture-overview, system-design
**Security**: security-review, threat-model
**Operations**: runbook, incident-report, postmortem
**Testing & QA**: test-plan, qa-strategy
**Research & Evidence**: research-brief, evidence-brief, signal-brief
**Metadata**: changelog

## 4. Confirmed gaps

1. **Zero artifact-level output overrides** — All 27 artifacts inherit from `workflowDefaults.outputs`; none declare custom format lists or branding preferences. The schema allows it (`outputs` is optional per artifact) but the manifest has empty usage.

2. **visualRequirements is markdown-only** — Checks for "artifact-has-mermaid" or "artifact-table-has-columns" inspect the source `.md` file for text patterns. Zero checks for:
   - "rendered-mermaid-exports-to-svg" (does the diagram actually render?)
   - "pptx-slide-count" or "pptx-visual-layout" (does the exported deck have correct structure?)
   - "pdf-page-count" or "pdf-table-of-contents" (does the PDF render correctly?)
   - "a11y-wcag-2.1-aa" (does the rendered document meet accessibility standards?)

3. **releaseGate lacks render/completion-state fields** — Schema defines exactly 5 properties (structuralLint, citationLint, proseMinimum, requiredReviewers, optionalReviewers). No fields for:
   - "exportAudit" or "requiresVisualReview" (does a human need to inspect the rendered output?)
   - "completionStateCheck" (what completion-state vocabulary should artifacts carry?)
   - "accessibilityAudit" (WCAG compliance, color contrast, screen reader readiness)
   - "brandFidelityCheck" (does the rendered document match brand guidelines?)

4. **No asset class system** — Manifest has no registrations for:
   - Image (as a first-class typed output, not an inline markdown reference)
   - Screenshot (annotation-capable, with source metadata)
   - Diagram-as-asset (SVG/PNG export from mermaid/d2 with rendering metadata)
   - Deck-as-asset (PPTX or HTML-slide-deck as a typed artifact, not just an export format)
   - PDF-as-asset (PDF as a typed output with compression/quality metadata)
   - DOCX-as-asset (Microsoft Word as a typed output with compatibility metadata)
   - PPTX-as-asset (PowerPoint as a typed output with animation/fidelity metadata)

5. **Author/reviewer chains do not include render-validator role** — `authorChain` and `reviewerChain` use specialists from the roster (cx-product-manager, cx-devil-advocate, etc). No chain includes a "render-validator" or "export-quality-reviewer" role, even though export happens as a workflow step.

6. **Completion-state vocabulary is absent** — `runArtifactWorkflow` reports planned/executed/skipped steps with action types [research, review, rewrite, author, validate, brand, export]. No action type for "completion-audit", "render-check", or "asset-quality-assessment".

7. **Export fidelity is not tracked in manifest** — The `document-export.mjs` module returns { ok, outputPath, branding: { applied, mechanism }, missing: [], message }. No structure for "fidelity", "quality-tier", "compression-settings", "a11y-compliance-level", or "render-warnings".

## 5. Unconfirmed concerns

1. **Branding application consistency** — The manifest declares `branding: construct` as default, but export engines (Typst, pandoc, pptxgenjs) apply it independently. No single contract specifies "what construct branding means for each format" or "what happens if Typst crashes mid-brand-application".

2. **Diagram rendering at export** — The `publish_run` tool accepts `figures: true` to render mermaid/d2 blocks. No manifest field tracks whether a diagram is "required" vs "optional" or "must render successfully" vs "silent-skip-on-failure".

3. **Multi-format consistency** — When an artifact exports to both PDF and PPTX, no manifest contract specifies whether both must pass the same visual requirements or if they have independent quality gates.

4. **Degradation semantics** — When a tooling requirement (pandoc, typst, pptxgenjs, LibreOffice) is missing, `document-export` returns `{ ok: false, missing: [...], message: "..." }`. The manifest has no field to say "this artifact type requires strict tooling" vs "best-effort fallback is acceptable".

5. **Brand voice overrides** — `.cx/brand-voice.json` can override tone per artifact type. No manifest field tracks "which branding choices are overridable" or "which are locked".

6. **Reviewer sign-off on rendered output** — The manifest defines `requiredReviewers` / `optionalReviewers` for the source. No field says "reviewer must inspect the exported PDF before release" or "export-review is optional".

## 6. Asset-quality contract opportunities

1. **Asset class registry** — Add `documentClass` enum to schema: include "document" (default, markdown artifact) + "image", "screenshot", "diagram", "deck-asset", "pdf-asset", "docx-asset", "pptx-asset", "video-transcript". Each class carries:
   - Rendering engine (mermaid, pandoc, pptxgenjs, ffmpeg, …)
   - Required output formats and quality metrics
   - Completion-state vocabulary (ready, needs-review, render-failed, a11y-audit-required)
   - Export-reviewer chain

2. **Visual completion-state** — Extend schema with `completionState` enum: source-only, render-required, a11y-audit-required, brand-review-required, export-verified. Separate source-readiness from rendered-readiness.

3. **Export audit rules** — Add `exportRequirements` block per artifact:
   ```json
   "exportRequirements": {
     "formats": ["pdf", "pptx"],
     "qualityTier": "high",
     "a11y": "wcag-2.1-aa",
     "requiresExportReview": true,
     "brandFidelityCheck": true,
     "diagramRenderCheck": true
   }
   ```

4. **Render-validator role** — Extend specialist roster to include a "render-validator" or "export-quality-reviewer" who can audit rendered outputs. Update `reviewerChain` to include this role for high-stakes documents (PRD, strategy).

5. **Render-check workflow action** — Add to `runArtifactWorkflow` action enum: `{ id, action: "render-check", format, checks: ["page-count", "a11y", "brand-fidelity"] }`. This would run after export and before release-gate approval.

6. **Asset inventory** — Create MCP tool `list_artifact_assets` that returns all exported outputs for an artifact type + completion-state + quality metrics + reviewer sign-off status.

7. **Branding completeness contract** — Document per format: PDF (via Typst), PPTX (via pptxgenjs), DOCX (via pandoc + template), HTML (via pandoc + template). Each specifies what "construct branding applied" means and under what conditions it's partial/failed.

## 7. Render or visual-review requirements

**Current state**: Zero visual/render checks in `releaseGate` or `visualRequirements`.

**What should be there**:

| Document type | Render check | Trigger | Reviewer |
|---|---|---|---|
| prd, prd-platform, strategy | PDF page count ≥ 3; metrics table renders | Always | cx-devil-advocate |
| prd-business | PDF page count ≥ 2 | Always | cx-devil-advocate |
| adr, rfc, rfc-platform | Diagram renders to SVG without errors | When visualRequirements present | cx-reviewer |
| research-brief, evidence-brief | Codeblock/table alignment in PDF | High-fidelity export | cx-researcher |
| runbook | Flowchart diagram renders; instructions readable at 100% zoom | Always | cx-sre |
| one-pager | PDF fits 1 page without overflow | Always | cx-product-manager |
| prfaq | PPTX slide count ≥ 3; no missing images | High-fidelity export | cx-product-manager |
| security-review, threat-model | PDF renders with table of contents; code blocks are readable monospace | Always | cx-security |

**Missing**: No MCP tool exists to perform these checks. `publish_run` with `figures=true` renders diagrams, but returns no completion-state or quality report beyond `{ ok, outputPath }`.

## 8. Tests needed

1. **Manifest parity test**: Verify that all 27 artifacts can export to all declared `workflowDefaults.formats` without error. Currently no test validates export success.

2. **Visual requirements coverage**: For each artifact with `visualRequirements`, verify that:
   - Source markdown contains the required diagram or table
   - Diagram/table renders correctly when exported to PDF/PPTX
   - Render result carries no warnings or dropped information

3. **Export format matrix test**: 27 artifacts × 13 formats = 351 matrix cells. Verify each combination either exports successfully or returns a structured degradation (missing tooling, not supported).

4. **Branding fidelity test**: Export a PRD to PDF with `branding: construct` and verify that the Typst template applied correctly (headers, colors, fonts, page numbers).

5. **Render-check action test**: Extend `runArtifactWorkflow` to include a "render-check" step and verify it runs after export and reports page count, diagram presence, a11y metrics.

6. **Completeness-state propagation test**: Verify that a workflow report correctly transitions from "source-only" to "render-required" to "export-verified" as steps execute.

## 9. Docs needed

1. **Asset class reference**: Document each asset class (image, screenshot, diagram-asset, etc) with rendering engine, output formats, completion-state vocabulary, reviewer chain.

2. **Export audit guide**: How to verify rendered outputs are ready for distribution. When to require export review. What "brand-fidelity" means per format.

3. **Release gate customization**: Guide to overriding `releaseGate` per artifact type. When to add custom checks. How to define custom completion-state.

4. **Render-validator role charter**: Describe the render-validator specialist. What checks they perform. When they are required. How to integrate into reviewer chains.

5. **Export tooling contract**: Formalize what Construct's export engines guarantee. What "branding applied" means. When degradation is acceptable.

## 10. Dependency and degradation concerns

1. **Pandoc/Typst/pptxgenjs availability** — Export steps silently skip if tooling is missing (unless strict=true). Manifest has no field to specify "export is mandatory for this artifact" vs "best-effort". Risk: artifact reaches users without ever being rendered.

2. **Diagram rendering timeouts** — Mermaid/d2 rendering can hang or fail. Manifest has no timeout or fallback strategy field. Risk: export process stalls.

3. **Brand template drift** — `.cx/publish-theme.typ` or Typst templates in the Construct package can change. No versioning in manifest to pin a specific branding generation. Risk: old artifacts re-export with different visual treatment.

4. **Branding format incompatibility** — PDF branding via Typst is detailed. PPTX branding via pptxgenjs is limited. DOCX branding via reference-doc is even more limited. Manifest declares `branding: construct` uniformly; no per-format fidelity tier. Risk: PPTX is "construct branded" but looks nothing like the PDF.

5. **A11y compliance gaps** — Pandoc/Typst do not guarantee WCAG 2.1 AA compliance in exported PDF. No manifest field requires a11y audit. Risk: publicly distributed PDFs fail accessibility compliance.

6. **Multi-artifact consistency** — No contract ensures that if two artifacts (PRD + research-brief) export to PDF, they have consistent branding, fonts, page-number placement. Risk: incoherent visual language across distributed outputs.

## 11. Questions for Opus

1. **Completion-state semantics**: Should "completion-state" be a manifest-level property (all artifacts pass through the same states: source → render → a11y → brand-review → export-verified) or artifact-specific (some artifacts skip render-check, others require a11y audit)?

2. **Render-reviewer requirement**: For which artifact types is export-review mandatory? (e.g., customer-facing documents like PRD, one-pager, strategy, but not internal runbooks?) Should this be opt-in per manifest entry or a blanket rule?

3. **Asset class vs artifact type distinction**: Should image/screenshot/diagram-as-asset be separate artifact types in the manifest, or a `documentClass` property of document artifacts? (The latter seems cleaner: an artifact can be "type: diagram, documentClass: diagram-asset".)

4. **Degradation strategy**: If pandoc is missing, should PDF export fail hard, degrade to text, or return a placeholder? Should the artifact manifest specify per-type?

5. **Branding version pinning**: Should manifest entries pin a specific branding template version (e.g., `brandVersion: "2026-q2"`) so re-exports remain consistent?

6. **Export audit scope**: Should export-audit include only render-success (does the file exist and is it valid?) or also visual completeness (does the PDF have the expected page count, images, diagrams)?

## 12. Suggested bead updates

| Topic | Bead title | Rationale |
|---|---|---|
| Schema extension | Add completion-state & export-requirements to artifact-manifest.schema.json | Enables source-independent quality tracking for rendered outputs |
| Manifest refresh | Populate `outputs` overrides for high-stakes artifacts (prd, strategy, one-pager) | Pins export format requirements at manifest level instead of defaulting all |
| Test coverage | Add export format matrix test (27 types × 13 formats) | Catches unexpected format incompatibilities before release |
| MCP tool addition | Implement `render_artifact` or `export_and_audit` MCP tool | Enables agents to execute render-check as a workflow step, not just export |
| Docs & spec | ADR: Completion-state vocabulary and render-validator contract | Grounds the render-audit feature in recorded decisions |
| Release gate enhancement | Add optional render-check action to `runArtifactWorkflow` | Enables structured completion-state reporting post-export |
| Asset class registry | Scaffold asset classes (image, screenshot, diagram-asset, deck-asset) in manifest | Supports first-class asset-output typing (not markdown-only) |
| Role model update | Add render-validator / export-quality-reviewer specialist | Chains render audit into reviewer workflows for high-stakes artifacts |
