# Asset Quality Program — Traffic Jams & Selected Resolutions

Grounded against the Phase 0 baseline. Each jam states the risk, the resolution adopted for this program, and the Construct-specific anchor that makes the resolution concrete (so it is not generic advice).

| # | Traffic jam | Selected resolution | Construct anchor |
|---|---|---|---|
| 1 | Existing gates mistaken for complete visual QA | Inventory first; extend, never replace. The `releaseGate` source-lint is correct and stays. New gates are *additional levels*, not rewrites. | `lib/artifact-release-gate.mjs`, manifest `releaseGate` def — both kept; new fields are additive. |
| 2 | Markdown quality confused with rendered quality | Split `source-lint` (existing `visualRequirements`) from `rendered-review` (new). Both required at the right gate level. | `visualRequirements` checks are all source-level today (`artifact-has-mermaid`); rendered review is a new, separate contract. |
| 3 | PPTX XML bounds ≠ readability | Keep any geometry/bounds audit in `deck-export-pptx.mjs`; add rendered slide-image review before a deck may claim `visually-reviewed`. | `lib/deck-export-pptx.mjs` (1152 lines) — audit what bounds checks already exist before adding. |
| 4 | Syntactically valid diagrams that are useless | Diagram gate inspects purpose/readability/density/labels, not just `artifact-has-mermaid`. Split syntax-valid from diagram-quality. | `lib/diagram.mjs` (302 lines) + manifest `visualRequirement.check` vocabulary. |
| 5 | Visual review becomes subjective/flaky | Two-track: **deterministic** (overflow, clipping, missing alt, contrast ratio, file validity, unresolved placeholders, `[object Object]`) vs **judgment** (spacing quality, diagram usefulness, hierarchy, audience fit). Judgment requires a structured rubric + recorded reviewer evidence. | New `visual-quality-matrix.md` will enumerate which checks are deterministic vs judgment per format. |
| 6 | Render tooling missing locally | Every render step declares a **typed degradation**: `unavailable-renderer` / `missing-dependency` / `unsupported-format` / `headless-limitation` / `skipped-by-policy`. Never silent skip-and-pass. A skipped render downgrades the completion state; it does not forge it. | Mirrors existing `construct publish --detect` tooling JSON; reuse that detection surface rather than inventing a new one. |
| 7 | Parallel agents collide on goldens/snapshots | No snapshots/goldens during audit (Wave 1). In implementation, Opus assigns file locks: one owner per fixture family (deck / diagram / document / source). | Recorded in the execution matrix; enforced by per-bead `file locks` field. |
| 8 | Accessibility reduced to alt-text only | Audit contrast, font size, reading order (where extractable), alt text, table readability, heading hierarchy, screen-reader concerns per format. | `skills/roles/designer.accessibility.md`, `templates/docs/accessibility-audit.md` already exist — extend, don't reinvent. |
| 9 | Workflow claims steps that were only planned | Preserve Construct's truth model. `construct artifact workflow` already returns a "truthful plan/run report" — extend its state vocabulary, do not weaken it. | `lib/artifact-workflow.mjs`; CLI already advertises truthful plan/run reporting. |
| 10 | Visual model review becomes magic | A model/human visual review MUST consume a rendered image + a rubric + a saved report. It can never be inferred from source text. The completion state `visually-reviewed` is only reachable with a stored evidence artifact. | New evidence object schema in Epic 9; storage path under `.cx/`. |
| 11 | Branding breaks readability | Branding is subordinate to legibility. Brand tokens/fonts/colors/spacing must pass the same accessibility/readability gates as plain output. | `lib/brand-tokens.mjs`, `lib/export-branding.mjs`, `lib/brand-fonts.mjs` — branded output runs the Epic 8 gates. |
| 12 | Render review too slow for every run | Five gate levels: `fast` (source lint) → `standard` (export validation) → `render-smoke` → `full-certification` → `human/model-reviewed`. Local fast feedback; strict levels for release/certification. | Layer onto existing `construct certify gate` + `construct publish --strict`; the level becomes a manifest/`outputs`-driven declaration. |

## Cross-cutting resolution: registry-first, not bespoke

Per the owner constraint, every resolution above is expressed as **declared data** wherever possible:
- gate levels, required formats, and per-format review requirements → manifest `outputs` + a new `qualityContract` block (currently `outputs` is defined-but-unused; this program activates it).
- deterministic vs judgment checks → a visual-rules registry keyed by format.
- degradation types → a fixed enum reused from the existing tooling-detection surface.
- completion states → a single ordered enum shared by manifest, workflow, gate, and CLI output.

Code's job is to *interpret, validate, render, inspect, and report* — not to hard-code per-type rules.
