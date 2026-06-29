---
intake: none
---

# Asset Quality Program — Bead Tree

Status: **CREATED in tracker (2026-06-29).** Epic + 12 child epics + 11 audit beads + 1 synthesis gate are live. Implementation beads (Waves 2–5) remain undrafted pending the synthesis gate.

## As-created ID map

| Bead | ID |
|---|---|
| Top epic | `construct-cuxq` |
| Epic 1 Surface & completion contract | `construct-cuxq.1` |
| Epic 2 Source presentation lint | `construct-cuxq.2` |
| Epic 3 Rendered output / visual review pipeline | `construct-cuxq.3` |
| Epic 4 Deck/PPTX certification | `construct-cuxq.4` |
| Epic 5 Document export (PDF/DOCX/HTML/MD) — absorbs `construct-amfg` | `construct-cuxq.5` |
| Epic 6 Diagram & drawing quality | `construct-cuxq.6` |
| Epic 7 Branding/typography/spacing | `construct-cuxq.7` |
| Epic 8 Accessibility & visibility | `construct-cuxq.8` |
| Epic 9 Workflow truth & completion state | `construct-cuxq.9` |
| Epic 10 Visual fixtures & regression | `construct-cuxq.10` |
| Epic 11 Release gates & CI | `construct-cuxq.11` |
| Epic 12 Dogfood certification | `construct-cuxq.12` |
| Audit A–K | `construct-cuxq.13`–`.23` |
| Synthesis gate (blocked-by all 11 audits) | `construct-cuxq.24` |

Note: `construct-amfg` is cross-referenced (note appended) to Epic 5; a hard dep edge isn't possible (a task can't block an epic in `bd`).

---

## Original draft (retained for provenance)

On approval, Opus creates the epic + child epics, then only the Wave-1 audit beads (per the prompt: "Do not create every implementation bead yet").

Reconciliation note: existing in-progress bead **`construct-amfg`** ("Artifact generation: polish PDF layout and list fidelity") becomes a child of Epic 5, not a duplicate. Its current PDF/list work is the first concrete slice of Epic 5.

---

## TOP-LEVEL EPIC

**Title:** Generated asset quality and visual certification
**Labels:** `epic`, `artifacts`, `visual-quality`, `accessibility`, `render-review`, `certification`, `registry-first`

**Description:** Construct-generated artifacts must be visually usable, readable, accessible, renderable, and honestly reviewed before completion is claimed. "File generated" is not "artifact complete." This program audits the existing artifact surface (manifest, gates, export, decks, diagrams, branding, workflow truth), then adds registry-first quality contracts, layered gate levels, a render-and-inspect pipeline with typed degradation, evidence-backed visual review, fixtures, and certification across Markdown, PDF, DOCX, PPTX, HTML, diagrams, images, and branded distribution outputs.

**Acceptance criteria:**
- Child epics exist; Wave-1 audit beads exist.
- Existing gates inventoried before any new gate is implemented.
- Every (artifact type × output format) has a declared completion contract.
- Visual review is evidence-based, never implied from source.
- Rendered artifacts are inspected before completion claims at the appropriate gate level.
- Gating is explicit, tested, and degrades with a typed reason when a renderer is unavailable (never silent skip-and-pass).
- Behavior is manifest/schema/registry/rubric-driven wherever a declaration can express it.

---

## CHILD EPICS (12)

Each carries: Problem · Existing-to-preserve · Known gaps (to validate) · Parallel audit tasks · Serial impl tasks · Tests · Docs · Acceptance · Non-goals. Condensed below; full detail expands at finalize time.

### Epic 1 — Artifact surface inventory & completion contract
- **Problem:** No single map of (type × format × tool × gate), and no shared definition of "complete" per output.
- **Preserve:** registry-first manifest; 27 declared types; `visualRequirements`/`releaseGate` structure.
- **Gaps to validate:** `outputs` unused (0/27); `releaseGate` lacks render/visual/a11y/completion fields; completion is effectively binary.
- **Completion-state enum to ratify:** planned → authored → structurally-valid → source-linted → exported → file-valid → renderable → screenshot-captured → visually-reviewed → accessibility-reviewed → approved → completed.
- **Acceptance:** every type×format has a declared completion contract; Construct cannot emit "complete" when only "generated" happened.

### Epic 2 — Source artifact lint & presentation quality
- **Problem:** structurally-valid Markdown can still be a bullet wall / dense / placeholder-ridden.
- **Preserve:** `visual-requirements.mjs`, `doc-presentation.mjs`, existing template-visual tests.
- **Gaps:** spacing/blank-line rhythm, bullet-wall/dense-text, unresolved placeholders, `[object Object]`, table readability, empty/skinny sections — manifest/rubric-driven and per-type configurable.
- **Acceptance:** obvious readability failures caught pre-export; rules configurable by artifact type.

### Epic 3 — Rendered output inspection & visual review pipeline
- **Problem:** no rendered evidence exists before a visual-completion claim.
- **Render strategy:** PPTX→slide images, PDF→page images, HTML→screenshot, DOCX→PDF/image, Markdown→HTML screenshot, Mermaid/D2→SVG/PNG.
- **Gaps:** renderer-availability detection, typed degradation, page/slide-image output contract, model/human review report contract, evidence storage, completion-claim enforcement.
- **Acceptance:** rendered review is explicit and evidenced; missing renderer never passes silently.

### Epic 4 — Deck / PPTX visual quality certification
- **Problem:** decks are the highest-risk surface (overflow, tiny fonts, dense tables, invisible text).
- **Preserve:** whatever pre-export layout / post-export XML-bounds checks `deck-export-pptx.mjs` already has (audit first).
- **Gaps:** rendered slide-image review, dense-slide detection, table/bullet card readability, ugly-deck fixtures, a deck certification gate.
- **Acceptance:** PPTX completion = file validity + bounds; full certification = rendered slide evidence; clipped/invisible content fails.

### Epic 5 — Document export quality: PDF · DOCX · HTML · Markdown  *(absorbs `construct-amfg`)*
- **Problem:** exported docs need format-specific quality gates.
- **Gaps:** PDF validation + render smoke; DOCX validation + text-extraction check; HTML screenshot/readability; cross-format content-preservation; missing image/link/font checks; export quality report.
- **Acceptance:** exported docs checked for renderability + content preservation; format-specific typed degradation.

### Epic 6 — Diagram & drawing quality certification
- **Problem:** "has Mermaid" ≠ a useful, readable diagram.
- **Preserve:** `lib/diagram.mjs` generation/syntax path.
- **Gaps:** purpose rubric, density/label checks, render check, flowchart non-happy-path heuristic, sequence participant/readability checks, diagram↔artifact relevance, diagram fixtures.
- **Acceptance:** diagrams present-when-required, renderable, readable, useful; syntax-valid ≠ quality.

### Epic 7 — Branding, typography, spacing & design tokens
- **Problem:** brand chrome can reduce legibility.
- **Preserve:** `brand-tokens.mjs`, `export-branding.mjs`, `brand-fonts.mjs`.
- **Gaps:** token audit, font availability/fallback, contrast + type-scale, spacing-token proposal, branded/unbranded comparison fixtures, decorative-chrome safety, brand quality docs.
- **Acceptance:** branding passes readability/visibility gates; missing fonts degrade with a typed reason; tokens centrally declared and tested.

### Epic 8 — Accessibility & visibility gates
- **Problem:** baseline a11y/visibility checks needed across formats.
- **Preserve:** `designer.accessibility.md`, `accessibility-audit.md` template.
- **Gaps:** alt-text + image-visibility, contrast, min font size, reading order (where extractable), heading hierarchy, table a11y, hidden/clipped-text, an audit output format that says what was and wasn't checkable.
- **Acceptance:** a11y checks explicit per format; Construct reports coverage and gaps honestly.

### Epic 9 — Artifact workflow truth & completion-state model
- **Problem:** must never claim author/review/render/approval that did not happen.
- **Preserve:** `artifact workflow` truthful plan/run reporting.
- **Gaps:** workflow truth table, completion-status schema, evidence-object schema, local-vs-host visual-review semantics, MCP result hardening, CLI completion-message correction, learning-loop capture on failed visual gates.
- **Acceptance:** results distinguish planned/generated/exported/rendered/reviewed/completed; claims carry evidence + degradation.

### Epic 10 — Visual fixtures, golden examples & regression testing
- **Problem:** gates need realistic ugly + known-good fixtures without golden-file gridlock.
- **Gaps:** fixture inventory; ugly fixtures (MD, deck, diagram, HTML/PDF/DOCX); known-good goldens; snapshot/golden update policy; CI perf strategy; fast-vs-full separation.
- **Acceptance:** common visual failures covered; goldens not a parallel-work bottleneck; fast local vs full certification separated.

### Epic 11 — Asset quality release gates & CI integration
- **Problem:** quality must fit release gates without making every local run unbearable.
- **Gate levels:** `fast` → `standard` → `render-smoke` → `full-certification` → `human/model-reviewed`.
- **Gaps:** gate-level design, per-level checks, CI integration plan, optional-dependency matrix, failure-remediation UX.
- **Acceptance:** release runs the right level; devs run fast checks locally; full visual certification available and documented.

### Epic 12 — Construct generated-asset dogfood certification
- **Problem:** Construct should certify its own artifacts with its own system.
- **Gaps:** dogfood artifact set (PRD/RFC/ADR/deck/runbook), multi-format export, run visual gates, capture review reports, feed failures into Beads, certification docs.
- **Acceptance:** Construct can generate→export→render→review→certify its own artifacts; failures become Beads + learning evidence.

---

## WAVE-1 AUDIT BEADS (the only beads to create now, beyond epics)

Read-only, Haiku-preferred, one report each. Parent: top-level epic. These map 1:1 to the 11 subagent assignments (`../subagent-assignments.md`) plus one synthesis bead owned by Opus.

| Bead (draft title) | Maps to | Executor | Risk |
|---|---|---|---|
| Audit: artifact surface & manifest completion contract | Agent A | Haiku | low |
| Audit: source presentation lint coverage | Agent B | Haiku | low |
| Audit: artifact release gates | Agent C | Haiku | low |
| Audit: deck/PPTX visual quality | Agent D | Haiku | low |
| Audit: PDF/DOCX/HTML/MD export quality | Agent E | Haiku | low |
| Audit: diagram & drawing quality | Agent F | Haiku | low |
| Audit: branding/typography/spacing | Agent G | Haiku | low |
| Audit: accessibility & visibility | Agent H | Haiku | low |
| Audit: workflow truth & completion state | Agent I | Haiku | low |
| Audit: visual fixtures & regression | Agent J | Haiku | low |
| Audit: asset-quality CLI & UX | Agent K | Haiku | low |
| Synthesis gate: consolidate findings + risk register + contracts + matrices | Phase 3 | Opus | medium |

Implementation beads (Waves 2–5) are intentionally NOT drafted yet — they are downstream of the synthesis gate, per the prompt's Phase 7 ("do not jump straight into implementing screenshot review / PPTX spacing / visual model review").

---

## Proposed labels for child epics

`epic` + area tag: `artifacts`, `visual-quality`, `accessibility`, `render-review`, `branding`, `diagrams`, `decks`, `document-export`, `workflow-truth`, `fixtures`, `release-gates`, `dogfood`, `registry-first`.
