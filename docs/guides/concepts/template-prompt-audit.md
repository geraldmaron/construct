<!--
docs/guides/concepts/template-prompt-audit.md — quality audit of every doc template and
specialist prompt against the rubric in doc-quality-rubric.md. The backlog source
of truth for the research-grade remediation (epic construct-7zrh): each remediation
bead points at a row. Classifications are an assessment to re-verify on touch, not
a settled score; remediation status is updated as items land.
-->
# Template & prompt quality audit

Every document template (`templates/docs/*.md`) and specialist prompt (`specialists/prompts/cx-*.md`) judged against [doc-quality-rubric.md](doc-quality-rubric.md): **strong** (an expert would respect it), **adequate** (sound structure, missing a depth dimension), **thin** (placeholder-level, not shippable). The gap column names what a domain expert would add; the standard column anchors it.

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

## Specialist prompts

Depth is split between the prompt and the `skills/roles/*.md` overlay; the gap is usually a named methodology framework missing from the overlay, not a shallow prompt.

| Specialist | Grade | Methodology gap | Status |
|------------|-------|-----------------|--------|
| cx-architect, cx-engineer, cx-ai-engineer, cx-reviewer, cx-qa | strong | — | — |
| cx-security | strong | make STRIDE/PASTA process explicit | queued (Phase D) |
| cx-sre | strong | make error-budget *policy* explicit ([Google SRE](https://sre.google/workbook/error-budget-policy/)) | queued (Phase D) |
| cx-researcher, cx-product-manager, cx-data-analyst, cx-docs-keeper | strong | — | source taxonomy added to cx-researcher |
| cx-evaluator | adequate → strong | rubric design, ground-truth/inter-rater reliability, FP/FN cost asymmetry, statistical significance | **done (7zrh.6)** |
| cx-orchestrator | adequate → strong | dependency-graph wave sequencing, critical path, fan-out bounding | **done (7zrh.6)** |
| cx-ux-researcher | adequate | sampling/power, validity types (internal/external/construct), inter-rater reliability | queued (Phase D) |
| cx-data-engineer | adequate | data lineage/observability, SLA maturity | queued (Phase D) |
| cx-business-strategist | adequate | Porter's Five Forces, scenario planning | queued (Phase D) |
| cx-legal-compliance | adequate | risk taxonomy, liability framing, technical-legal bridge | queued (Phase D) |
| cx-debugger | adequate | causal-model root-cause enumeration | queued (Phase D) |
| cx-devil-advocate | adequate | FMEA / failure-mode enumeration | queued (Phase D) |
| cx-operations | adequate | critical-path method, resource leveling | queued (Phase D) |
| cx-rd-lead | adequate | power analysis, effect-size estimation | queued (Phase D) |
| cx-release-manager | adequate | canary failure-detection, SLO-based rollback trees | queued (Phase D) |
| cx-trace-reviewer | adequate | statistical process control, drift detection | queued (Phase D) |
| cx-platform-engineer | adequate | IaC maturity model, supply-chain SBOM | queued (Phase D) |
| cx-designer, cx-accessibility | adequate | design-system maturity; screen-reader/cognitive-accessibility rigor | queued (Phase D) |
| cx-explorer | adequate | dependency-graph analysis, code-smell enumeration | queued (Phase D) |

## Sequencing

- **PR-1 (this branch)** — foundation (source taxonomy, quality rubric, structure enforcement) + all thin items remediated.
- **PR-2 (Phase C)** — adequate templates.
- **PR-3 (Phase D)** — adequate prompts, mostly via role-overlay methodology additions.

## References

- [doc-quality-rubric.md](doc-quality-rubric.md), [ADR-0017](../../decisions/adr/0017-source-credibility-taxonomy.md), [ADR-0018](../../decisions/adr/0018-document-quality-standard.md)
- [Google SRE: Postmortem Culture](https://sre.google/workbook/postmortem-culture/), [Error Budget Policy](https://sre.google/workbook/error-budget-policy/)
