---
title: "Team workspace sharing — multi-persona stress deck"
status: draft
owner: product-manager
artifactType: one-pager
date: 2026-07-20
version: "0.2"
doc_id: DECK-STRESS-001
subtitle: "Phase→FR→AC · legal · competitive · financial honesty"
cx_release_gate: bypass
cx_release_gate_reason: "Local visual/skill stress-test export; not a production release artifact"
---

# Team workspace sharing

Stress deck for the strong PRD: Phase → Requirement → AC, adversarial gates, unknowns marked.

---

## Decision sought

Approve **Phase 1 named-user share**?

- In: viewer/editor + audit log
- Out: public unauthenticated links

---

## TL;DR

Forked email briefs lose audit trails. Phase 1: named share only. ROI and ticket volume stay **unknown** until instrumented.

---

## Evidence (user advocacy)

| Source | Status |
|---|---|
| Authorship contract | skills/docs/artifact-authorship.md |
| PM anti-pattern | skills/perspectives/product-manager.md |
| Live interviews | **unknown** — research-required |

---

## Hierarchy

| Phase | Requirements | Exit |
|---|---|---|
| 1 Named share MVP | FR-1.1–1.4 | ACs green; public link blocked |
| 2 Multi + retention | FR-2.1–2.2 | Retention decided |
| 3 Domain policies | FR-3.1 | Deferred + threat model |

---

## Sample FR → AC

**FR-1.1** Grant editor/viewer to registered user

- AC-1.1.1 Editor can edit; non-grantee 403
- AC-1.1.2 Viewer cannot mutate

---

## Competitive & financial

| Item | Stance |
|---|---|
| Email forks | Differentiate |
| SaaS ACL | unknown |
| ROI / market share | **unknown** / [unverified] |

---

## Legal & privacy triggers

| Trigger | Present? | Recruit |
|---|---|---|
| PII / emails | yes | security.privacy |
| ToS / contracts | yes | security.legal-compliance |
| Minors in briefs | unknown | privacy + legal |
| Public links P1 | no — blocked | n/a |

---

## Adversarial FMEA

| Mode | Why it hurts | Mitigation |
|---|---|---|
| Skip legal review | Trust / regulatory | Mandatory trigger table |
| Fabricated “40% faster” | Misleading launch | Mark unknown; instrument |
| Public link creep | Data leak | Out-of-scope + release test |

---

## Open questions

1. Audit retention — privacy — 2026-08-01
2. Counsel for ToS — legal-compliance — 2026-08-01
3. Second user-evidence source — researcher — 2026-07-27

---

## Visual system

Field-notebook brand:

- Plus Jakarta Sans · charcoal `#1a1d24`
- Slate-teal accent `#1f5c61`
- PPTX requires `---` slide separators
