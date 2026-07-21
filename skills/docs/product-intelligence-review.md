---
name: docs-product-intelligence-review
description: "Use when: reviewing PRDs, Meta PRDs, PRFAQs, evidence briefs, signal briefs, customer profiles, or backlog proposals."
inputs: [prd, evidence-brief]
artifactType: review
---
# Product Intelligence Review

Use when: reviewing PRDs, Meta PRDs, PRFAQs, evidence briefs, signal briefs, customer profiles, or backlog proposals.

## Rubric

Score each dimension as pass, warning, or fail:

- Evidence grounding: claims cite source material or state evidence gaps.
- PM flavor fit: platform, product, enterprise, ai-product, or growth concerns are handled when relevant.
- Acceptance criteria: observable and pass/fail.
- Scope discipline: goals, non-goals, and tradeoffs are explicit.
- Approval safety: external writes and approved status are gated.
- Storage readiness: artifact path is under `.construct/knowledge/`, `docs/specs/prd/`, or `docs/meta-prd/` so hybrid retrieval can index it.
- Readability: balanced paragraphs, tables, and bullets. Human voice bar (`rules/common/human-voice.md`): contractions; no em-dash theater; no AI tells.

## Output

Return findings first, ordered by severity. Include concrete fixes and cite section names or file paths.

## Shared authorship contract

Before drafting or reviewing, call `get_skill("docs/artifact-authorship")` for framing, template population, storytelling, human voice, adversarial review, anti-fabrication, and cross-persona triggers. Persona overlays under `skills/perspectives/` add failure modes; they do not waive that contract.

**Before you write (voice):** prefer contractions (`don't`/`won't`/`can't`); avoid spaced em dashes (` — `); refuse AI tells (delve, leverage, robust as filler, "it's important to note", "In today's…", "This ensures that…", empty tricolons); sound like a careful colleague. Exceptions: ACs, legal shall/must not, quoted statute, exact required section titles. See `rules/common/human-voice.md`.
