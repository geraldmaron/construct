---
intake: none
---

# Visual Quality Matrix (Phase 3 Synthesis)

Splits checks into **deterministic** (machine-decidable, pass/fail, safe to block) and **judgment** (needs rubric + recorded reviewer evidence). Resolves Traffic-jam 5. Columns marked ✅ exist today (with evidence); ❌ are gaps.

## Deterministic checks (block at the declared gate level)

| Check | MD | PDF | DOCX | PPTX | HTML | Diagram | Today? | Evidence |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|---|
| File integrity / valid container | — | qpdf | unzip | XML | parse | — | ❌ | Agent E G7 (only `>1000B`) |
| Unresolved placeholders (`{{}}`,`[object Object]`,TODO/TBD) | ● | ● | ● | ● | ● | — | ❌ | Agent B |
| Required diagram present (source) | ● | — | — | — | — | ● | ✅ | `artifact-has-mermaid` (Agent A) |
| Required table columns present | ● | — | — | — | — | — | ✅ | `artifact-table-has-columns` |
| Diagram actually rendered (image embedded) | — | ● | ● | ● | ● | ● | ✅ | `pdf/docx/htmlRenderedDiagrams` (Agent E) |
| Geometry overflow / off-canvas / clipping | — | — | — | ● | — | — | ✅ | `auditPptxFile` (Agent D) |
| Pre-export layout overflow (deck) | ● | — | — | ● | — | — | ✅ | `auditDeckMarkdownLayout` (Agent D) |
| Min font floor | — | — | — | ● | — | — | ❌ | Agent D G11 (8pt defined, unchecked) |
| Brand fonts embedded / no silent fallback | — | ● | — | ● | — | — | ◑ | PDF enforced (Agent G); PPTX silent (E) |
| Content-preservation roundtrip (text vs source) | — | ◑ | ● | ● | ● | — | ❌ | Agent E G7 (PDF text test-only) |
| Missing image / broken link references | ● | ● | ● | ● | ● | — | ❌ | Agent E §4 |
| WCAG AA contrast ratio | — | ● | ● | ● | ● | ● | ❌ | Agent G/H |
| Alt text on rendered images | ● | ● | ● | ● | ● | ● | ◑ | source-only (Agent H) |
| Heading hierarchy well-formed | ● | ● | ● | — | ● | — | ❌ | Agent B/H |
| Page/slide count within expected band | — | ● | ● | ● | — | — | ❌ | Agent A §7 |

● = applicable · ◑ = partial today · — = N/A.

## Judgment checks (require rubric + stored reviewer evidence; never silently auto-pass)

| Check | Applies to | Rubric anchor | Today? |
|---|---|---|---|
| Spacing quality / visual rhythm | MD, PDF, DOCX, PPTX, HTML | doc-quality-rubric, doc-visual-matrix | ❌ |
| Diagram usefulness (purpose, density, label readability, path coverage) | Diagram | designer.md + new diagram rubric | ❌ (Agent F) |
| Visual hierarchy / scan-ability | PDF, PPTX, HTML | doc-visual-matrix | ❌ |
| Audience fit / tone-appropriate density | all | manifest tone + reviewer | ◑ tone only |
| Reading order sanity (where extractable) | PDF, DOCX, HTML | a11y rubric | ❌ (Agent H) |
| Branded vs plain legibility comparison | PDF, PPTX, HTML | branding fixtures | ❌ (Agent G) |

Judgment checks reach state `visually-reviewed` only with: rendered image + named rubric id + saved report (model or human). No inference from source text (Traffic-jam 10 / R10).

## Gate-level → check mapping

| Level | Runs | Speed | Where |
|---|---|---|---|
| `fast` | source lint (placeholders, headings, presentation rhythm, required-diagram-present) | ms | local, PostToolUse advisory + CLI |
| `standard` | + export + file-integrity + diagram-rendered + roundtrip + missing-image/link | seconds | CLI `validate`, pre-commit |
| `render-smoke` | + screenshot first page/slide + font-floor + contrast (deterministic) | ~seconds/asset | CI on changed artifacts |
| `full-certification` | + all-page screenshots + pixel regression vs golden + full a11y | minutes | CI nightly / release |
| `human-reviewed` | + judgment checks with stored rubric evidence | human latency | release / dogfood |

Deterministic checks at a level **block**; judgment checks **record evidence and surface**, they don't hard-fail CI (prevents flakiness, R2/R6).

## Per-artifact gate-level defaults (proposal, overridable via `qualityContract`)

| Artifact | Default level | Rationale |
|---|---|---|
| one-pager, prd, prd-platform, strategy, prfaq | render-smoke (full-cert at release) | customer-facing, high visual risk |
| decks (any → pptx/deck) | render-smoke min; full-cert for distribution | highest-risk surface (Agent D) |
| adr, rfc, system-design, architecture-overview | standard + diagram render-smoke | diagram-heavy |
| runbook, incident-report, postmortem | standard | internal, readability matters less than correctness |
| changelog, memo, signal-brief | fast | low visual surface |
