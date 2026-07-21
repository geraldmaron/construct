<!--
docs/guides/concepts/template-prompt-audit.md — quality audit of every doc template and
Worker Profile prompt against the rubric in doc-quality-rubric.md.
-->
# Template & prompt quality audit

Every document template (`templates/docs/*.md`) and Worker Profile prompt (`registry/worker-profiles/prompts/*.md`) judged against [doc-quality-rubric.md](doc-quality-rubric.md): **strong** (an expert would respect it), **adequate** (sound structure, missing a depth dimension), **thin** (placeholder-level, not shippable). The gap column names what a domain expert would add; the standard column anchors it.

This is the assessment that drives remediation — re-verify a row when you touch it rather than trusting the label.

## Templates

| Template | Grade | Key gap vs expert standard | Status |
|----------|-------|----------------------------|--------|
| prd, prd-platform, prd-business, meta-prd | strong | — | — |
| adr, rfc, rfc-platform | strong | — | structure now enforced |
| test-plan, memo, onboarding | strong | — | — |
| research-brief | strong | — | Admiralty grade added; structure enforced |
| incident-report | ~~thin~~ → strong | trigger/root-cause/contributing-factors split, severity rationale, mitigators, action priorities, glossary ([Google SRE](https://sre.google/workbook/postmortem-culture/)) | **done (7zrh.5)** |
| skill-artifact | ~~thin~~ → strong | competency rubric, prerequisites, failure modes, worked example | **done (7zrh.5)** |
| research-finding | ~~thin~~ → strong | Admiralty-graded sources, observation/inference split, confidence reasoning, refresh | **done (7zrh.5)** |
| runbook | adequate | SLO/severity-to-action mapping, diagnostic decision tree ([Google SRE error budgets](https://sre.google/workbook/error-budget-policy/)) | queued (Phase C) |
| strategy | adequate | resources, leading/lagging metrics, milestones, risk register, kill criteria | queued (Phase C) |
| evidence-brief, signal-brief, product-intelligence-report | adequate | confidence calibration + evidence bars; sources table (evidence-brief done) | queued (Phase C) |
| prfaq, customer-profile, one-pager, changelog-entry, persona-artifact, backlog-proposal | adequate | evidence grounding / decision-forcing depth per family | queued (Phase C) |

## Worker Profile prompts

Depth is split between the prompt and the `skills/perspectives/*.md` overlay; the gap is usually a named methodology framework missing from the overlay, not a shallow prompt. Grades below cover the **12 shipping Worker Profiles** in `registry/worker-profiles/prompts/` (unprefixed ids). Retired v1 personas (e.g. `cx-sre`, `cx-evaluator`, `cx-explorer`) are not listed — their depth moved into Skills / Perspectives where still relevant.

| Worker Profile | Grade | Methodology gap | Status |
|------------|-------|-----------------|--------|
| `architect`, `engineer`, `reviewer`, `qa` | strong | — | — |
| `security` | strong | make STRIDE/PASTA process explicit | queued (Phase D) |
| `researcher`, `product-manager`, `data-analyst` | strong | — | source taxonomy on researcher |
| `orchestrator` | adequate → strong | dependency-graph wave sequencing, critical path, fan-out bounding | **done (7zrh.6)** |
| `debugger` | adequate | causal-model root-cause enumeration | queued (Phase D) |
| `operations` | adequate | critical-path method, resource leveling | queued (Phase D) |
| `designer` | adequate | design-system maturity; screen-reader/cognitive-accessibility rigor | queued (Phase D) |

## Sequencing

- **PR-1 (this branch)** — foundation (source taxonomy, quality rubric, structure enforcement) + all thin items remediated.
- **PR-2 (Phase C)** — adequate templates.
- **PR-3 (Phase D)** — adequate prompts, mostly via role-overlay methodology additions.

## References

- [doc-quality-rubric.md](doc-quality-rubric.md), [ADR-0017](../../decisions/adr/0017-source-credibility-taxonomy.md), [ADR-0018](../../decisions/adr/0018-document-quality-standard.md)
- [Google SRE: Postmortem Culture](https://sre.google/workbook/postmortem-culture/), [Error Budget Policy](https://sre.google/workbook/error-budget-policy/)
