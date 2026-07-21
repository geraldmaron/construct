---
name: docs-transcript-synthesis
description: "Use when: a meeting, call, or interview transcript needs to be turned into a summary, the decisions made, and concrete action items with owners."
inputs: [transcript-text]
artifactType: meeting-summary
---
# Transcript Synthesis

Use this skill when a meeting, call, or interview transcript needs to be turned into a structured summary with decisions and action items.

A raw transcript is a low-signal artifact: speaker turns, filler, and tangents bury the few load-bearing outcomes. The job is to extract those outcomes faithfully without inventing any that were not actually stated.

## Steps

1. **Read the whole transcript first.** Do not summarize incrementally — a decision late in the call often reverses an earlier one.
2. **Identify participants and roles** if stated. Note who owns what. If unstated, write `owner: unassigned` rather than guessing.
3. **Extract decisions.** A decision is an explicit commitment ("we'll ship X", "we're not doing Y"). Quote or tightly paraphrase the line that establishes it. Do not promote a musing ("maybe we could…") to a decision.
4. **Extract action items** as `{ action, owner, due? }`. Only include items someone actually committed to. Mark `due` only if a date was stated.
5. **Extract open questions** — anything raised and left unresolved.
6. **Write a 3–6 sentence summary** of what the conversation was about and what changed as a result.
7. **Flag low-confidence sections** — crosstalk, inaudible markers, ambiguous antecedents — as `[unclear]` rather than smoothing them over.

## Output shape

```
## Summary
<3–6 sentences>

## Decisions
- <decision> — basis: "<quoted/paraphrased line>"

## Action items
- [ ] <action> — owner: <name|unassigned>[, due: <date>]

## Open questions
- <question>
```

## Verification bar

- Every decision and action item traces to an actual statement in the transcript — no invented commitments or owners.
- Tentative language stays tentative; do not sharpen "maybe" into "will".
- Unresolved or inaudible content is surfaced, not silently dropped.

## Shared authorship contract

Before drafting or reviewing, call `get_skill("docs/artifact-authorship")` for framing, template population, storytelling, adversarial review, anti-fabrication, and cross-persona triggers. Persona overlays under `skills/perspectives/` add failure modes; they do not waive that contract.
