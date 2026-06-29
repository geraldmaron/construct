# Asset Quality — Consolidated Findings (Phase 3 Synthesis)

Source: 11 read-only audit reports under `../subagents/`. Every claim traces to a report; report claims trace to file:line. Date: 2026-06-29.

## The one-sentence finding

Construct's artifact system is **strong at source-level QA and deliberately honest about what it did not do** — but it has **no perceptual/rendered-output QA**, so an artifact can pass every gate and still be visually broken, and "exported" is the furthest completion rung the model can truthfully reach.

## 1. Existing mechanisms worth preserving (do not rebuild)

| Mechanism | Evidence | Why it matters |
|---|---|---|
| Registry-first manifest, 27 types, per-type `releaseGate`/`visualRequirements` | Agent A; `specialists/artifact-manifest.json` | The extension point. New contracts are additive fields, not a new system. |
| 3-layer gate: advisory PostToolUse hook → blocking CLI `validate` (exit 1) → CI certification (golden matrix) | Agent C; `lib/hooks/artifact-release-gate.mjs:43`, `lib/artifact-release-gate.mjs:206-237`, `lib/certification/runner.mjs:52-59` | Gate levels already exist in embryo. Layer render-smoke/full-cert onto this, don't invent a parallel stack. |
| Safe bypass (`cx_release_gate: bypass` + required reason), **no CONSTRUCT_SKIP_\* vars** | Agent C; `lib/artifact-release-gate.mjs:168-189` | Policy-compliant. Keep this shape for any new gate. |
| Workflow truth model: specialist steps marked `skipped/host-owned` without evidence; **no fabrication** | Agent I; `lib/artifact-workflow.mjs:158-201` | The completion-state work extends this vocabulary; it must not weaken the no-forgery guarantee. |
| Deck two-tier safety: pre-export markdown layout audit (`auditDeckMarkdownLayout`) + post-export PPTX XML bounds audit (`auditPptxFile`) | Agent D; `lib/deck-export-pptx.mjs` | Geometry/overflow already caught. Add font-floor + rendered review on top. |
| Diagram render is **active** + three post-export validators that **block** on render failure | Agent E; `lib/document-export.mjs:488-520`, `vendor/pandoc-ext/diagram.lua` | `--figures` truly renders mermaid/d2 and fails the export if images don't embed. Not a no-op. |
| Offline brand fonts enforced via `--ignore-system-fonts` (fails visibly, not silently) | Agent E/G; `lib/brand-fonts.mjs:22-80` | Font substitution can't silently happen in PDF. Preserve. |
| Centralized brand tokens flowing to PDF/HTML/PPTX; monochrome principle enforced; brand-prose lint | Agent G; `lib/brand-tokens.mjs` | Single source of truth for design. Extend with contrast/spacing tests, don't decentralize. |
| Honest CLI ("Published <path>", never "Verified") | Agent K | UX makes no false visual-review claim today. Keep it honest as states expand. |
| Graceful renderer degradation: optional tools (pandoc/typst/d2/pptxgenjs) skip cleanly, tests skip not fail | Agent J | Typed-degradation foundation already partly present. |

## 2. Confirmed gaps (evidence-backed)

### G1 — No perceptual/rendered review anywhere (the core gap)
No screenshot, page-image, or pixel-diff of any exported format exists. *(Agents E §4, I §4, J, K)* Validation is structural (XML bounds, image-object counts), never visual.

### G2 — `releaseGate` and `visualRequirements` are source-only
`check` vocab is `artifact-has-mermaid` / `artifact-table-has-columns`; `releaseGate` has 5 source fields and no render/visual/a11y/completion field. *(Agent A; schema $defs)*

### G3 — No completion-state ladder
Workflow states stop at `completed-local-steps`; no `visually-rendered` / `visual-reviewed` / `approved`. The gate treats validity as binary. *(Agent I §2, Agent C gap 1)*

### G4 — `outputs` declared by 0/27 artifacts
Per-type format requirements and gate levels are not expressible; everything inherits `workflowDefaults`. *(Agent A)*

### G5 — No automated accessibility validation of generated artifacts
Strong WCAG *guidance* (skills/templates) but zero enforced contrast/alt-text/font-size/heading checks on rendered output. *(Agent H)*

### G6 — Diagram quality ≠ diagram syntax
Presence is enforced; purpose, density, label readability, path coverage, and render legibility are not. Render verification is heuristic (counts image objects, doesn't inspect content). *(Agents F, I §4.3)*

### G7 — No PDF validity / DOCX-PPTX roundtrip / missing-image / broken-link / font-fallback checks
Only a `> 1000 bytes` file-size check post-export. *(Agent E §4)*

### G8 — No anti-fixtures; no pixel regression
All 28 golden fixtures are happy-path; a deck-font or PDF-linebreak regression passes CI unless it trips XML bounds. *(Agent J)*

### G9 — Source presentation lint is partial and advisory
`lintDocPresentation()` warns (doesn't block) on bullet walls/blank lines; no checks for unresolved placeholders (`{{}}`, `[object Object]`, TODO/TBD), empty sections, prose density, heading hierarchy; not manifest-driven. *(Agent B)*

### G10 — No user-facing visual-check command
No `construct publish --preview` or `artifact verify-render`; users can't run a visual check at all. *(Agent K)*

### G11 — Deck font floor defined but never enforced
Sizes down to 8pt exist in layout code but no pre-export floor check. *(Agent D)*

### G12 — Branding has no WCAG contrast validator and no spacing-scale source of truth
Colors declared but unverified for legibility; Typst uses em, CSS uses px — drift risk. *(Agent G)*

## 3. Silent-degradation violations (Traffic-jam 6 — must become typed)

| Path | Current behavior | Evidence |
|---|---|---|
| `diagram.lua` `code_to_figure()` engine failure | returns `nil`, leaves raw source in output (caught later only if `figures=true` AND count>0) | Agent E §5.5; `vendor/pandoc-ext/diagram.lua:621-638` |
| `lib/diagram.mjs` render failure | degrades to source-only with **no frontmatter warning flag** | Agent F |
| Mermaid Chrome/Puppeteer missing | "ensure mmdc is installed" — hides that Chrome is the real blocker | Agent E §5.1 |
| `pdf2svg` not in `detect()` requirements | silent failure if absent | Agent E §5.7 |
| PPTX missing fonts (pptxgenjs) | silent font substitution; deck off-brand, user unaware | Agent A §10.4, Agent I §10.2 |

## 4. Notable non-quality findings (route separately, don't lose)

- **Unauthenticated reviewer evidence** — `readAgentLogReviewers()` trusts any `specialist:` field in `.cx/agent-log.jsonl`; a log entry could forge `cx-devil-advocate`. *(Agent I §4.7, gap 7)* → security follow-up bead, outside this program's visual scope but worth filing.
- **`gates-audit.mjs` omits artifact gates** — the local/CI consistency audit has no artifact-gate entry, so drift between hook/CLI/cert configs isn't caught. *(Agent C gap 4)* → low-severity, fold into Epic 11.
- **Reviewer checks warn, never block** — gate passes before required reviewers attend. *(Agent C gap 2, Agent I)* → policy question for Opus/owner (Epic 9).

## 5. Cross-report reconciliations

- **Is `--figures` a no-op?** Phase-0 flagged it [unverified]. **Resolved: no** — diagram.lua actively compiles and `document-export.mjs:488-520` blocks export on render failure. The *residual* risk is the lua filter's silent `nil` path when the validator isn't engaged (figures off, or count detection misses). *(Agents E, I)*
- **Does the deck path check bounds?** Phase-0 [unverified]. **Resolved: yes** — both pre- and post-export. The gap is font-floor + perceptual review, not geometry. *(Agent D)*
- **Does any test assert on rendered output?** **Resolved: no** — all structural; `tests/functional/publish.functional.test.mjs` extracts PDF *text* (asserts diagram source absent) but never inspects layout/pixels. *(Agent J, E)*
