<!--
skills/docs/product-intelligence-review.md — Evaluate Product Intelligence artifacts before they become docs of record.
-->
# Product Intelligence Review

Use when: reviewing PRDs, Meta PRDs, PRFAQs, evidence briefs, signal briefs, customer profiles, or backlog proposals.

## Rubric

Score each dimension as pass, warning, or fail:

- Evidence grounding: claims cite source material or state evidence gaps.
- PM flavor fit: platform, product, enterprise, ai-product, or growth concerns are handled when relevant.
- Acceptance criteria: observable and pass/fail.
- Scope discipline: goals, non-goals, and tradeoffs are explicit.
- Approval safety: external writes and approved status are gated.
- Storage readiness: artifact path is under `.cx/product-intel/`, `docs/prd/`, or `docs/meta-prd/` so hybrid retrieval can index it.
- Readability: balanced paragraphs, tables, and bullets. Few em dashes.

## Output

Return findings first, ordered by severity. Include concrete fixes and cite section names or file paths.
