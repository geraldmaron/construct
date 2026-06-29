---
intake: none
---

# Asset Completion Contract (Phase 3 Synthesis — DRAFT proposal)

A registry-first definition of "complete" per artifact, per output format. Grounded in Agent A (manifest), Agent I (workflow truth), Agent C (gates). This is a **proposal for the synthesis gate**, not yet implemented.

## Principle

"File generated" is not "artifact complete." Completion is an **ordered ladder of states**; an artifact carries the highest state for which it holds **re-verifiable evidence**. No state is reachable without its evidence object. This extends — never weakens — the workflow's existing no-forgery guarantee (`lib/artifact-workflow.mjs:158-201`).

## Completion-state ladder

Synthesized from Agent I §6.1 and Agent A §6.2, mapped to today's actual vocabulary.

| # | State | Evidence required (re-verifiable) | Exists today? |
|---|---|---|---|
| 0 | `planned` | Workflow plan record | ✅ `planned` |
| 1 | `authored` | Source file path + mtime | ◑ implicit |
| 2 | `structurally-valid` | structuralLint pass | ✅ via gate |
| 3 | `source-linted` | presentation + visual-requirement lint pass | ◑ partial (Agent B) |
| 4 | `exported` | export result `{ok, outputPath, format, branding}` | ✅ `completed-local-steps` |
| 5 | `file-valid` | format integrity check (PDF qpdf / DOCX unzip / PPTX XML) | ❌ (Agent E G7) |
| 6 | `renderable` | renderer exit code + stderr log captured | ❌ |
| 7 | `screenshot-captured` | stored page/slide image path + digest | ❌ |
| 8 | `visually-reviewed` | rendered image + rubric + saved review report (model or human) | ❌ |
| 9 | `accessibility-reviewed` | per-format a11y report (contrast/alt/headings/font) | ❌ (Agent H) |
| 10 | `approved` | required-reviewer evidence (authenticated) | ◑ warns-not-blocks (Agent C/I) |
| 11 | `completed` | all required states for this (type × format) satisfied | ❌ (binary today) |

Legend: ✅ present · ◑ partial · ❌ absent.

## Evidence object schema (gates every state ≥4)

From Agent I §6.2. Each state transition records:

```json
{
  "state": "visually-reviewed",
  "actor": "construct-export | cx-designer | host-human",
  "timestamp": "<ISO-8601, injected — scripts cannot call Date.now()>",
  "artifact": "relative/path/to/output.pdf",
  "digest": "sha256:…",
  "proof": { "imagePath": "…", "rubricId": "deck-v1", "reportPath": "…" },
  "degradation": null,
  "reversible": true
}
```

`degradation` is non-null when a state was **skipped** rather than satisfied — it carries a typed reason (below) and the state does NOT advance. Skipping is honest, not forging.

## Typed degradation enum (closes Traffic-jam 6 / R1)

Reused from the existing `detect()` tooling surface (Agent E §3), not a new mechanism:

`unavailable-renderer` · `missing-dependency` · `unsupported-format` · `headless-limitation` · `skipped-by-policy`

Rule: a degraded render **downgrades** the completion state and emits a surfaced warning (result field + artifact frontmatter flag). It never silently advances. This directly fixes the five silent-degradation paths in consolidated-findings §3.

## Registry shape — activating the unused `outputs` block (Agent A G4)

Today `outputs` is schema-defined but 0/27 artifacts use it. The contract activates it and adds a sibling `qualityContract`:

```json
"outputs": {
  "formats": ["pdf", "pptx"],
  "branding": "construct"
},
"qualityContract": {
  "gateLevel": "render-smoke",          // fast | standard | render-smoke | full-certification | human-reviewed
  "requiredStates": ["file-valid", "renderable"],
  "perFormat": {
    "pdf":  { "requiredStates": ["file-valid", "renderable"], "a11y": "wcag-2.1-aa" },
    "pptx": { "requiredStates": ["renderable", "screenshot-captured"], "fontFloorPt": 12 }
  }
}
```

- Defaults live in `workflowDefaults` so the 27 existing artifacts inherit safe behavior (R9 backward-compat).
- High-stakes types (prd, strategy, one-pager, prfaq decks) override to stricter levels.
- Code interprets this declaration; it does not hard-code per-type rules (owner constraint).

## "Complete" is a function, not a flag

```
completed(artifact, format) ⟺
  ∀ s ∈ qualityContract.perFormat[format].requiredStates :
    artifact.states[s].evidence ≠ null ∧ artifact.states[s].degradation = null
```

The CLI/MCP result reports the achieved state and the gap — never a bare "complete" (preserves Agent K's honest-output finding).

## What this contract deliberately does NOT do (non-goals)

- Does not mandate human review for every artifact — `gateLevel` decides.
- Does not introduce new asset *types* (image/screenshot/video) yet — that's an E1 proposal downstream of proving this contract (R15).
- Does not change the no-forgery semantics of specialist steps — only adds rungs above `exported`.
