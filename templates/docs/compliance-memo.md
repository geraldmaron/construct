---
title: "Compliance memo: {title}"
status: draft
owner: security
artifactType: compliance-memo
date: {YYYY-MM-DD}
version: "0.1"
doc_id: COMP-{NNN}
subtitle: "{obligation class or processing in one line}"
tags: []
contributors: []
approvers: []
---

- **Author**: security.legal-compliance (security Worker Profile) or named counsel
- **Related artifacts**: {PRD / ADR / RFC paths}
- **Not legal advice**: This memo structures obligations for counsel review. It does not assert compliance.

<!--
Owning specialist: security.legal-compliance (security Worker Profile).
Before drafting: get_skill("docs/artifact-authorship")
  + get_skill("perspectives/security.legal-compliance")
  + get_skill("compliance/regulatory-review")
  + get_skill("compliance/case-law-research") when precedent is load-bearing.

Masthead (status, tags, contributors, approvers, date, owner) lives in YAML.
Don't duplicate Date/Owner/Status as a body H1 block.

Depth: prose TL;DR + obligation register + remediation with dated owners.
DPIA-adjacent signals when processing is novel. Multi-persona tension with
product (marketing claims), architect (control design), privacy (retention),
and reviewer (theater controls) must appear in residual risk / adversarial.
Human framing: data subjects are people in roles, not "log noise."
Voice: rules/common/human-voice.md — prefer contractions; avoid spaced em
dashes; skip AI tells. Keep formal negation when counsel-facing precision
requires it (shall not, cannot assume absence).
Refuse fabricated statute articles, case names, or “we are compliant” claims.
Prefer unknown / [unverified] with owner + counsel decision-by date.
See rules/common/no-fabrication.md and get_skill("docs/artifact-authorship").
-->

## TL;DR

{2–4 sentences in human voice: what processing/activity is in scope, which
people/roles are subjects, which obligation classes fire, residual risk, and
the decision sought from counsel. No invented compliance conclusions.}

## Scope and activity

| Field | Value |
|---|---|
| Product / surface | {name} |
| Data / activity | {what is collected, generated, or decided} |
| Jurisdictions | {list or unknown} |
| Users / subjects | {roles; minors?} |
| Decision sought | {approve / block / redesign / counsel-only} |

## Obligation → control register

| Obligation | Source (statute / guidance / contract) | Cite verified? | Control in product | Residual risk | Owner |
|---|---|---|---|---|---|
| {e.g. purpose limitation} | {primary text URL+date or unknown} | yes / no / [unverified] | {control or missing} | {what remains} | {name} |

Every load-bearing obligation needs a **primary** statute/regulation URL or an explicit `[unverified]` with counsel owner. Agency guidance is secondary; blog posts are tertiary.

## Regulatory Citations

| Citation | Kind | Verification | Notes |
|---|---|---|---|
| {article / section / case} | statute / agency / case law | CourtListener / EUR-Lex / eCFR / counsel library / [unverified] | {holding or obligation summary; no invented quotes} |

Case law: follow `skills/compliance/case-law-research.md`. Never invent reporter cites. Use CourtListener citation lookup when available; otherwise mark `[unverified]` and escalate to counsel.

## Remediation Plan

| Gap | Severity | Remediation | Decision needed by | Owner |
|---|---|---|---|---|
| {missing control} | critical / high / med / low | {concrete change} | {YYYY-MM-DD} | {name} |

## Residual risk and counsel gate

| Risk | Accept? | Rationale | Counsel required before ship? |
|---|---|---|---|
| {highest residual} | yes / no / unknown | {why} | yes / no |

**Counsel gate**: {named counsel or “not yet assigned”}. Do not claim sign-off without a dated record.

## Adversarial challenge

| Failure mode | Effect | Cause | Mitigation or block |
|---|---|---|---|
| Theater controls (policy without enforcement) | False compliance confidence | Checklist without evidence | Require control proof before accept |
| Hallucinated citation | Wrong legal posture | Unverified case/statute | Refuse; CourtListener / primary text verify |

## References

- {primary regulation URLs + access dates}
- {related PRD/ADR/DPIA}
- {CourtListener or counsel library ids}
