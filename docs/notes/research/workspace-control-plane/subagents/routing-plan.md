---
intake: none
---

# Program Routing Plan (dispatcher output, Wave 0)

Produced 2026-07-17 by the dispatcher agent; edited for format by the program lead. This is
the program's execution-routing decision record: who runs what, at which tier, in which
order.

## Precedent

This repo has direct precedent for this exact program shape:
`docs/notes/research/construct-self-audit/` (baseline → bounded subagent reports →
synthesis → bead tree) and `docs/notes/research/construct-asset-quality/`
(subagent-assignments.md). Both ran a human-facing session as supervisor/synthesizer
dispatching bounded, read-only, single-report subagents — bypassing the `construct`
orchestrator persona, whose architect→engineer→reviewer→qa→ops chain is shaped for
single-task feature dispatch, not multi-week strategic synthesis. That precedent governs
here. The `construct`/cx-operations chain remains the right tool for one narrow piece:
final bead filing (dependency sequencing + beads hygiene live there).

## Routing table

| WS | Task | Route | Tier | Sequencing |
|---|---|---|---|---|
| 1 | Intent reconstruction | lead + bounded report agents | strong lead, mid-tier workers | Wave 0 ✅ |
| 2 | Truth map | lead + bounded report agents | strong lead, cheap/mid workers | Wave 0 ✅ |
| 3a | `lib/graph` audit | bounded read-only agent | mid tier | Wave 0 ✅ |
| 3b | Graph schema/builder design | single strong lead | strongest | after WS1+2+5 draft |
| 3c | Graph builder build | engineer chain or bounded agents | inherit | after 3b |
| 4 | Validation spikes ×6 | independent disposable agents | mid tier each | after 3c + WS5 draft |
| 5 | Target model + schemas | single strong lead, **no fan-out** | strongest | after WS1+2 |
| 6 | Retain/rebuild/replace/remove verdicts + migration/cleanup strategy | strong lead decides; workers gather evidence only | strongest lead | after WS2+5 |
| 7 | Bead DAG + filing | `construct` → cx-operations | inherit | last |

**Never fan out** WS5 verdict-writing or WS6 per-subsystem disposition calls — those are the
artifacts everything downstream depends on. Fan-out is for evidence gathering feeding those
calls, not the calls.

## Waves

- **Wave 0 (complete this session):** WS1, WS2, WS3a evidence + synthesis + program
  scaffolding, committed.
- **Wave 1:** WS5 draft target model (single lead) — needs explicit go-ahead.
- **Wave 2:** WS3b design → WS3c build; WS6 in parallel (needs WS2+WS5, not the build).
- **Wave 3:** WS4's six spikes, parallel and disposable.
- **Wave 4:** WS7 bead program, sequenced last. Per memory: `bd create --graph` is lossy —
  file via scripted per-issue create + `bd dep add`.

Waves 1–4 each need explicit maintainer opt-in — this is a multi-week program, not a single
mega-dispatch.

## Tier discipline

Strongest reasoning for: intent synthesis, ontology/work-model decisions, migration
strategy, disposition verdicts, bead DAG, adversarial final review. Cheap workers for:
inventory, classification, extraction, formatting, repetitive checks. No cheap-tier
judgment calls — a wrong verdict is the most expensive token in the program.
