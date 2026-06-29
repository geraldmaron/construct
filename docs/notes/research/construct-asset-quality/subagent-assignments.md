---
intake: none
---

# Asset Quality Program — Parallel Subagent Assignments (READY, NOT DISPATCHED)

These 11 read-only audit agents are scoped and ready. Per the selected **Plan & stop** scope, they are **not** dispatched in this run. Each is a bounded, read-only, single-report agent (Haiku preference). On approval, dispatch all 11 in one parallel batch.

## Shared subagent contract (prepended to every dispatch)

> You are a bounded Construct asset-quality audit subagent, assigned exactly one audit area.
> Do NOT edit code. Do NOT create/update/close/reprioritize Beads. Do NOT make architecture decisions.
> Do NOT assume an existing gate is sufficient because it exists. Do NOT assume a generated file is visually complete. Do NOT assume Markdown lint implies a good exported PDF/DOCX/PPTX/HTML. Do NOT recommend bespoke code where a registry/schema/manifest/rubric can express the behavior.
> Every finding must cite repo evidence (file + line/excerpt). If evidence is missing, write "unverified."
> Write exactly ONE report file at the assigned path using the required 12-section format. Stop after the report.

Required report sections: 1 Summary · 2 Evidence table · 3 Existing mechanisms · 4 Confirmed gaps · 5 Unconfirmed concerns · 6 Asset-quality contract opportunities · 7 Render/visual-review requirements · 8 Tests needed · 9 Docs needed · 10 Dependency & degradation concerns · 11 Questions for Opus · 12 Suggested bead updates.

## Read-only enforcement

Agents may write ONLY their one assigned report under `docs/notes/research/construct-asset-quality/subagents/`. All other writes are out of contract.

| Agent | Area | Report file | Primary files |
|---|---|---|---|
| A | Artifact surface & manifest | `subagents/artifact-surface-manifest.md` | `specialists/artifact-manifest.json`, `…schema.json`, `lib/artifact-manifest.mjs`, `lib/artifact-workflow.mjs`, `lib/mcp/tools/artifact-author.mjs`, `lib/mcp/server.mjs`, `docs/guides/reference/mcp-tools.md`, `docs/guides/reference/document-io.md`, `registry/capabilities.json` |
| B | Source presentation lint | `subagents/source-presentation-lint.md` | `lib/templates/visual-requirements.mjs`, `lib/templates/doc-presentation.mjs`, `lib/contracts/validate.mjs`, `tests/template-visuals.test.mjs`, `tests/structure-requirements.test.mjs`, `docs/guides/concepts/doc-quality-rubric.md`, `docs/guides/concepts/doc-visual-matrix.md`, `templates/docs/**` |
| C | Artifact release gates | `subagents/artifact-release-gates.md` | `lib/artifact-release-gate.mjs`, `lib/hooks/artifact-release-gate.mjs`, `lib/artifact-gate-notice.mjs`, `lib/certification/artifact-gates.mjs`, `lib/certification/runner.mjs`, `tests/artifact-release-gate.test.mjs`, `tests/hooks/…`, `tests/functional/…`, `docs/guides/reference/hooks*.md` |
| D | Deck / PPTX quality | `subagents/deck-pptx-quality.md` | `lib/deck-export-pptx.mjs`, `tests/deck-export-pptx.test.mjs`, `tests/functional/deck-export.functional.test.mjs`, `scripts/generate-deck-examples.mjs`, `examples/distribution/sources/deck-one-pager.md`, `tests/fixtures/publish/golden-deck-platform.md`, `docs/guides/reference/{document-io,branding}.md` |
| E | PDF/DOCX/HTML/MD export | `subagents/document-export-quality.md` | `lib/document-export.mjs`, `lib/export-branding.mjs`, `lib/brand-fonts.mjs`, `lib/brand-tokens.mjs`, `templates/distribution/construct-web.html`, `docs/guides/reference/{document-io,branding}.md`, `tests/functional/document-export.functional.test.mjs`, `scripts/generate-distribution-examples.mjs`, `examples/distribution/**` |
| F | Diagram & drawing quality | `subagents/diagram-quality.md` | `lib/diagram.mjs`, `tests/functional/diagram.functional.test.mjs`, `docs/guides/cookbook/diagram-and-demo.md`, `docs/guides/concepts/doc-visual-matrix.md`, `templates/docs/**`, `specialists/artifact-manifest.json`, `skills/roles/designer{,.accessibility}.md`, `specialists/prompts/cx-designer.md` |
| G | Branding / typography / spacing | `subagents/branding-typography-spacing.md` | `lib/brand-tokens.mjs`, `lib/export-branding.mjs`, `lib/brand-fonts.mjs`, `docs/guides/reference/branding.md`, `templates/distribution/fonts/README.md`, `templates/distribution/**`, `specialists/prompts/cx-designer.md`, `skills/brand/**`, `skills/roles/designer.md` |
| H | Accessibility & visibility | `subagents/accessibility-visibility.md` | `skills/roles/designer.accessibility.md`, `skills/frontend-design/{accessibility,screen-reader-testing}.md`, `templates/docs/accessibility-audit.md`, `lib/templates/doc-presentation.mjs`, `lib/document-export.mjs`, `lib/deck-export-pptx.mjs`, `templates/distribution/**`, `tests/**` |
| I | Workflow truth & completion state | `subagents/artifact-workflow-truth.md` | `lib/artifact-workflow.mjs`, `lib/artifact-loop-core.mjs`, `lib/mcp/tools/artifact-author.mjs`, `lib/mcp/server.mjs`, `lib/publish.mjs`, `lib/publish-tooling.mjs`, `docs/guides/reference/{mcp-tools,document-io}.md`, `tests/**/*artifact*`, `tests/**/*publish*` |
| J | Visual fixtures & regression | `subagents/visual-fixtures-regression.md` | `tests/e2e/lib/artifact-quality.mjs`, `tests/e2e/reports/realistic-user-validation.md`, `tests/fixtures/**`, `tests/capabilities/corpus-inventory.json`, `tests/certification/**`, `tests/functional/**`, `.github/workflows/**`, `package.json`, `scripts/run-tests.mjs` |
| K | Asset-quality CLI & UX | `subagents/asset-quality-cli-ux.md` | `bin/construct`, `lib/cli-commands.mjs`, `docs/guides/reference/cli/**`, `docs/guides/reference/{document-io,mcp-tools}.md`, `README.md`, `lib/artifact-gate-notice.mjs` |

## Dispatch note

All 11 are mutually independent and read-only → single parallel batch is safe (Traffic jam 7 does not apply during audit: no goldens/snapshots written). After reports land, Opus runs the Phase 3 synthesis gate before any implementation.

## Pre-seeded findings to validate (from Phase 0)

Hand these to the relevant agents as "confirm or refute with evidence" — do not let them be assumed:
- **A:** `outputs` is schema-defined but declared by 0/27 artifacts; `releaseGate` has no render/visual/accessibility/completion fields.
- **C:** confirm the gate blocks completion vs. advisory-only; confirm `--no-gate` escape-hatch safety.
- **D:** does `deck-export-pptx.mjs` already do post-export XML bounds checks, or generation only?
- **E:** does `construct publish --figures` actually render mermaid/d2 to an image, or pass a filter that can no-op?
- **I:** what completion vocabulary does `artifact workflow` report today, and is any state forgeable from source?
- **J:** does `tests/e2e/lib/artifact-quality.mjs` assert on rendered output or on source text?
