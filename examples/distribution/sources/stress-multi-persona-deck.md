---
title: "Team workspace sharing (multi-persona stress deck)"
status: draft
owner: product-manager
artifactType: one-pager
date: 2026-07-21
version: "0.5"
doc_id: DECK-STRESS-001
subtitle: "One story: product · architecture · compliance · a11y"
cx_release_gate: bypass
cx_release_gate_reason: "Local visual/skill stress-test export; not a production release artifact"
---

# Team workspace sharing

Same story as PRD-STRESS-001, ADR-STRESS-SHARE-001, and COMP-STRESS-SHARE-001.

---

## Decision sought

Approve **Phase 1 named-user share**?

- In: viewer / editor + access audit log
- Out: public unauthenticated links
- Gates: retention + ToS counsel before “enterprise-ready” claims

---

## TL;DR

Brief owners still fork drafts over email. Phase 1 restores least-privilege share in-product with append-only audit. ROI and expansion dollars stay **unknown** until instrumented.

---

## Who hurts today

| Role | Break | Lens |
|---|---|---|
| Brief owner | No least-privilege share | product-manager |
| Legal / design reviewer | Forced into email | researcher |
| Privacy investigator | Can't reconstruct access | privacy |
| Keyboard / AT user | Email-client a11y only | designer.accessibility |
| Ops / QA | No revoke SLO or link ban test | operations, qa |

Live interviews: **unknown**; research-required before Phase 2.

---

## Evidence (honest)

| Source | Status |
|---|---|
| Authorship contract | skills/docs/artifact-authorship.md |
| Process perspectives | PM / a11y / legal overlays |
| Live interviews | **unknown** |
| Expansion $ | **unknown**; sales ops |

---

## Phases with Why?

| Phase | Why? | Exit |
|---|---|---|
| 1 Named share | Least-privilege + audit trail now | ACs green; public link blocked |
| 2 Multi + retention | Bound PII; multi-collaborator audit | Retention decided; 2nd evidence or defer |
| 3 Domain policies | Admin defaults after threat model | Deferred |

---

## Sample FR → AC

**FR-1.1** Grant editor/viewer

- AC-1.1.1 Non-grantee 403
- AC-1.1.2 Viewer cannot mutate

**FR-1.3** Append-only audit (ADR)

- AC-1.3.1 Grant/revoke rows complete
- AC-1.3.2 No plaintext secrets

**FR-1.4** Share dialog WCAG 2.2 AA

- AC-1.4.1 Keyboard + manual a11y evidence

---

## Architecture

**Decision:** append-only grant/revoke rows. Not snapshot ACL. Not full edit event-sourcing.

Rejected: snapshot (no history), forever-append without purge (indefinite PII).

---

## Why now

| Dimension | Status |
|---|---|
| Revenue at risk | Seats blocked; $ unknown |
| Upside window | Team-plan before 2026-Q4 (intent) |
| Cost of delay | Email-fork toil compounds |
| Compliance | Collaborator PII on Phase 1 ship |

---

## Competitive / financial

| Item | Stance |
|---|---|
| Email forks | Differentiate |
| Docs-class ACL | Match named share; defer public links |
| Build / ROI | Low/Base/High unknown |

Refuse “40% faster.” Instrument email-export first.

---

## Legal / privacy

| Trigger | Gate |
|---|---|
| PII / emails | privacy: retention + deletion |
| ToS | legal-compliance → memo |
| DPIA? | unknown; counsel by 2026-08-08 |
| Public links P1 | blocked; QA fail-closed |

---

## Adversarial FMEA

| Mode | Mitigation |
|---|---|
| Skip legal review | Trigger table + counsel gate |
| Fabricated “40% faster” | Mark unknown; instrument |
| Public-link creep | Out-of-scope + release test |
| Append without retention | GA marketing blocked |
| Axe-only a11y | Manual keyboard + SR evidence |

---

## Open questions

1. Retention: privacy, due 2026-08-01
2. ToS counsel: legal, due 2026-08-01
3. Second evidence source: researcher, due 2026-07-27
4. DPIA required?: privacy, due 2026-08-08
5. Expansion $: sales ops, due 2026-08-15

---

## Ask

Approve Phase 1 engineering under the gates above. Block GA marketing until retention + ToS evidence exists. Defer Phase 2 lock until researcher lands a second primary source.
