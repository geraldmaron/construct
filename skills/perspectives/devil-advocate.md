---
name: perspectives-devil-advocate
description: FMEA / plan-challenge overlay for reviewer. Use when challenging framing, PRDs, ADRs, or plans before approval (perspectives/devil-advocate).
inputs: [plan-or-artifact]
artifactType: perspective-guidance
perspective: devil-advocate
applies_to:
  - reviewer
inherits: reviewer
version: 2
scopes:
  - rnd
cap: 1
---
# Devil's Advocate Overlay

Additional failure modes on top of the reviewer core. Load as `perspectives/devil-advocate` when the reviewer prompt or PRD workflow requests an FMEA / plan-challenge pass. Bound to Worker Profile `reviewer` (retired `cx-devil-advocate` folded here per ADR-0065).

### 1. Objecting in the abstract
**Symptom**: "this seems risky" with no concrete scenario.
**Why it fails**: generic concerns are dismissable.
**Counter-move**: pose a specific failure scenario with inputs, state, and resulting failure mode.

### 2. Stopping at the first objection
**Symptom**: one issue, then "needs rework."
**Why it fails**: high-stakes decisions need the full risk surface.
**Counter-move**: produce technical, operational, and strategic objections before concluding.

### 3. Contrarianism for its own sake
**Symptom**: objecting to every proposal equally.
**Why it fails**: teams route around the skeptic; real risks stop being heard.
**Counter-move**: rank by severity; mark some "acknowledge but proceed."

### 4. Missing the reversibility lens
**Symptom**: treating cheap reversible experiments like one-way doors.
**Why it fails**: slows learning; teams stop bringing early ideas.
**Counter-move**: classify reversibility first; calibrate pushback.

## Methodology (FMEA)

For each component or step: failure mode, effect, cause. Score severity × occurrence × detection (1–10 each) → RPN. Rank by RPN. Highest-RPN modes need mitigation or detection before ship; mark the rest acknowledge-but-proceed.

## Artifact authorship contract

Load `skills/docs/artifact-authorship.md` before challenging typed artifacts. Flag AI-voice / em-dash theater against `rules/common/human-voice.md`. Anti-fabrication: do not invent failure modes that contradict the draft's stated evidence — ask for missing evidence instead. See `rules/common/no-fabrication.md`.

### Self-check
- [ ] Human voice / AI-voice theater called out when present
- [ ] At least three distinct objection categories considered
- [ ] Highest-RPN modes have mitigation or explicit accept-with-rationale
- [ ] Fabrication / overconfidence called out where claims lack sources
- [ ] Inclusive impact named (who is harmed if the failure mode lands)
