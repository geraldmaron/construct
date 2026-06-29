# Execution Matrix (Phase 3 Synthesis)

Maps the 12 epics to waves, parallel-safety, fixture-owner locks, and executor models. Implementation beads (Waves 2–5) are drafted here but NOT yet in the tracker — they are created after this synthesis is reviewed and the contract (Epic 1) is ratified.

## Wave plan

| Wave | Theme | Gate before entering | Models |
|---|---|---|---|
| 1 | Audit + synthesis | — | Haiku (audits, done), Opus (synthesis, this doc) |
| 2 | Test scaffolding + fixtures | synthesis reviewed | Sonnet (tests/fixtures), Opus (rubric/gate contract review) |
| 3 | Contract + registry implementation | fixtures exist | Sonnet (impl), Opus review required |
| 4 | Render + visual-review implementation | contract merged | Sonnet (impl), Opus review on render architecture |
| 5 | Release gates + CI + dogfood | render path exists | Sonnet (CI/gates), Opus (final review), Haiku (docs) |

Hard ordering (Phase 7): contract & evidence model (E1/E9) **before** any render implementation (E3–E6). Do not jump to screenshot review / PPTX font fixes / model visual review first.

## Dependency gates between epics

```
E1 (completion contract + outputs/qualityContract schema)  ── gates ──▶ E3,E4,E5,E6,E8,E11
E9 (workflow truth + evidence-object schema)               ── gates ──▶ E3 (render states), E8, E12
E3 (render pipeline + typed degradation)                   ── gates ──▶ E4,E5,E6 render-review, E12
E10 (fixtures: ugly + golden + anti-fixtures)              ── gates ──▶ E2,E4,E5,E6 tests
E11 (gate levels)                                          ── gates ──▶ E12 dogfood certification
```

## Fixture-owner locks (prevents R5 collisions)

One owner per fixture family. Cross-family edits require re-coordination.

| Fixture family | Path root | Owner epic | Lock |
|---|---|---|---|
| Source/markdown fixtures | `tests/fixtures/artifacts/**` | E2 | source-lock |
| Deck/PPTX fixtures | `tests/fixtures/publish/*deck*`, deck goldens | E4 | deck-lock |
| Document export fixtures | `tests/fixtures/publish/**` (pdf/docx/html) | E5 | doc-lock |
| Diagram fixtures | new `tests/fixtures/diagrams/**` | E6 | diagram-lock |
| Golden gate matrix | `tests/certification/artifacts/gate-matrix.json` | E1 | matrix-lock (single writer; deterministic regen) |

## As-created tracker IDs (2026-06-29)

All 25 implementation beads are now live, nested under their epic, with verified dependency edges (26 edges, no cycles). Starting frontier (`bd ready`): `10.1` (fixtures), `3.1`, `9.1` (independent tests), `1.1`/`1.2`/`11.1` (contract foundation).

| Code | ID | Code | ID |
|---|---|---|---|
| E10-1 | `construct-cuxq.10.1` | E3-2 | `construct-cuxq.3.2` |
| E2-1 | `construct-cuxq.2.1` | E3-3 | `construct-cuxq.3.3` |
| E4-1 | `construct-cuxq.4.1` | E3-4 | `construct-cuxq.3.4` |
| E6-1 | `construct-cuxq.6.1` | E4-2 | `construct-cuxq.4.2` |
| E5-1 | `construct-cuxq.5.1` | E5-2 | `construct-cuxq.5.2` |
| E9-1 | `construct-cuxq.9.1` | E6-2 | `construct-cuxq.6.2` |
| E3-1 | `construct-cuxq.3.1` | E7-1 | `construct-cuxq.7.1` |
| E1-1 | `construct-cuxq.1.1` | E8-1 | `construct-cuxq.8.1` |
| E1-2 | `construct-cuxq.1.2` | E11-2 | `construct-cuxq.11.2` |
| E9-2 | `construct-cuxq.9.2` | E10-2 | `construct-cuxq.10.2` |
| E11-1 | `construct-cuxq.11.1` | K-1 | `construct-cuxq.11.3` |
| E2-2 | `construct-cuxq.2.2` | E12-1 | `construct-cuxq.12.1` |
| | | Docs sweep | `construct-cuxq.12.2` |

## Drafted implementation beads (per epic) — created post-review

Each will carry on creation: parent epic, problem, evidence (report+file:line), affected files/formats/commands, dependency gate, parallel-safety class, file locks, registry-first path, tests, docs, typed degradation, rollback, acceptance, non-goals, executor model.

### Wave 2 — tests & fixtures (parallel-safe within lock families)
- E10-1 Fixture inventory + ugly/anti-fixtures per format · Sonnet · low · **fixture locks**
- E2-1 Source presentation-lint tests (placeholders, headings, density) · Sonnet · low · source-lock
- E4-1 Deck font-floor + dense-slide failing tests · Sonnet · medium · deck-lock
- E6-1 Diagram quality failing tests (density/label/path) · Sonnet · medium · diagram-lock
- E5-1 Export file-validity + roundtrip + missing-image tests · Sonnet · medium · doc-lock
- E9-1 Completion-state + evidence-object tests (no state without proof) · Sonnet · medium · serial w/ E9-2
- E3-1 Renderer-missing typed-degradation tests · Sonnet · medium · serial

### Wave 3 — contract & registry (Opus-reviewed)
- E1-1 Add `qualityContract` + activate `outputs` in manifest schema (optional, defaulted) · Sonnet+Opus · **high** · matrix-lock
- E1-2 Completion-state enum (shared by manifest/workflow/gate/CLI) · Sonnet+Opus · high · serial
- E9-2 Evidence-object schema + workflow state transitions · Sonnet+Opus · high · serial
- E11-1 Gate-level config (`fast`…`human-reviewed`) wired to existing 3-layer gate · Sonnet+Opus · high
- E2-2 Make presentation lint manifest-driven + blocking at `standard` · Sonnet · medium · source-lock

### Wave 4 — render & visual review (Opus-reviewed architecture)
- E3-2 Render pipeline + renderer availability detection (reuse `detect()`) · Sonnet+Opus · high
- E3-3 Screenshot/page-image output contract + evidence storage · Sonnet+Opus · high
- E3-4 Model/human visual-review report contract (rubric + stored image) · Sonnet+Opus · high
- E4-2 PPTX → slide-image review + font-floor enforcement · Sonnet · high · deck-lock
- E5-2 PDF page-image + file-validity + roundtrip validators · Sonnet · high · doc-lock (absorbs `construct-amfg`)
- E6-2 Diagram render-legibility heuristics + frontmatter warning flag · Sonnet · medium · diagram-lock
- E7-1 WCAG contrast validator on brand tokens + spacing scale · Sonnet · medium
- E8-1 Per-format a11y checks (contrast/alt/headings/font) + honest coverage report · Sonnet · high

### Wave 5 — gates, CI, dogfood
- E11-2 CI integration of gate levels + optional-dependency matrix + add artifact gate to `gates-audit.mjs` · Sonnet+Opus · high
- E10-2 Pixel-regression at full-cert only + fixture-regen gating policy · Sonnet · medium · fixture locks
- E12-1 Dogfood: generate PRD/RFC/ADR/deck/runbook → export → render → review → certify; failures → Beads · Sonnet+Opus · medium
- K-1 (Epic 11) `construct publish --preview` / `artifact verify-render` user command · Sonnet · medium
- Docs sweep (completion-states ref, visual-review checklist, export audit guide) · Haiku · low

## Parallel-safety classes (per prompt taxonomy)
- **parallel-safe:** E10-1, E2-1, E6-1, docs sweep
- **blocked-by-contract-gate:** all E3/E4/E5/E6 render beads (need E1+E9)
- **blocked-by-render-pipeline-gate:** E4-2, E5-2, E6-2, E12-1
- **blocked-by-fixture-gate:** Wave-2 tests depend on E10-1 fixtures
- **blocked-by-accessibility-gate:** E12-1 dogfood needs E8-1
- **blocked-by-ci-performance-gate:** E10-2 pixel regression (full-cert only)
- **serial-required:** E1-2 → E9-2 (shared enum), matrix-lock writers

## Model-assignment rule (enforced)
Haiku: docs-only, inventory, simple fixtures. Sonnet: normal impl + tests. Opus: schema/contract design, render architecture, gate-level decisions, migration/back-compat, risk resolution. **No Haiku/Sonnet on `high`/`critical` beads without Opus review** — every Wave-3/4 high bead is co-owned.

## Definition of done for this synthesis gate (construct-cuxq.24)
- ✅ consolidated-findings · ✅ risk-register · ✅ asset-completion-contract · ✅ visual-quality-matrix · ✅ execution-matrix
- Implementation waves defined; no Wave-2+ work started before owner review.
