# Persona-rubric panel — 2026-08-06

Judge: Claude (Fable 5) subagent, cross-family with respect to all five
producers (qwen3.5:4b, qwen3.6:35b). Rubric: docs/persona-acceptance-rubrics.md,
committed before this judging. Deliverables: the recorded stakeholder-acceptance
runs (docs/stakeholder-acceptance-phase-4.md). Verdicts recorded under the
standing LLM-as-judge approval; Gerald checks outcomes.

Scope note: these are rubric verdicts on deliverable adequacy, not routing
verdicts — no `construct verdict` was recorded, and the routing-label corpus is
untouched.

| # | Run / role | Producer | Persona | Verdict | Deciding lines |
|---|---|---|---|---|---|
| 1 | run-20260806032817359 / employment | qwen3.5:4b | Legal | reject | C1 (invented provenance: `[domain catalog]`), C2 (verify-list, not steps) |
| 2 | run-20260806032817359 / contracts | qwen3.5:4b | Legal | reject | C1, C2, C3 (refused for missing input instead of proceeding on labeled assumptions) |
| 3 | run-20260806040351750 / privacy | qwen3.6:35b | Legal | reject | C1 only (`[source: domain catalog — GDPR Art. …]`) |
| 4 | run-20260806040351750 / security | qwen3.6:35b | Operations | reject | C1 (quoted namer-inferred engagement evidence as `[cite:outcome brief]`), C4 (no limits label in body), O1 (no owner per issue) |
| 5 | run-20260806040351750 / compliance | qwen3.6:35b | Compliance | **accept** | — |

Cross-cutting findings, each traced to a fix or a filed bead:

1. **Invented provenance decided four of five verdicts.** The
   scaffolding-citation rule (landed 2026-08-06, `findScaffoldingCitations`)
   refuses the exact forms in deliverables 1–3; a re-run would hold those at
   `challenged` rather than promoting them.
2. **A fourth provenance species** (deliverable 4): the role quoted the
   namer's inferred engagement framing as if it were the user's outcome,
   cited `[cite:outcome brief]`. Not covered by the landed rule (the word
   "brief" was deliberately excluded); filed as its own bead.
3. **The limits label does not reach the deliverable body** on roles whose
   lens declares no label (security): the best-effort/untuned fact lives in
   the work log but a reader of the deliverable alone never sees it. Filed.
4. **Issues name no owner** (O1): the work-product directive asks for the
   step but not who takes it. Filed with the label bead.
5. **The 35b compliance deliverable meets the Compliance bar as-is**, and the
   35b privacy deliverable is one citation-format fix from accept — evidence
   that the open-weight path's quality gap is concentrated in provenance
   discipline, not in analysis depth.
