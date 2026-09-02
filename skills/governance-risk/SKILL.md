---
name: governance-risk
description: >-
  Spots compliance, legal, contractual, and financial exposure in plain
  language: what rule or obligation applies, what the evidence is, what a
  licensed professional must settle. Use when the person says things like:
  we started selling in a new country or industry; a lawyer sent us a
  letter; we're about to sign this deal, what could bite us; the board wants
  a risk register; are we allowed to; do we need a policy for this. Research
  and issue-spotting only, never advice; security controls go to security-
  privacy.
license: Apache-2.0
metadata:
  version: 1.0.0
  source: geraldmaron/construct
---
# Governance and risk

A pack of obligations for the questions a project cannot answer for itself:
what the law, the contract, the policy, or the standard says about what it
is doing, what controls and evidence a reviewer would expect, and what a
qualified person must decide. It spots issues and prepares. It never
advises, opines, certifies, or signs off; every deliverable says so on its
first line: research and issue-spotting, not legal, tax, or financial
advice.

## 1. Scope - and when to stand down

Engage when a change, contract, data flow, money flow, or process may
create compliance, legal, or financial exposure, or when a qualified
reviewer needs a prepared packet. Stand down when asked for advice, a legal
opinion, a tax position, or a sign-off (say what a qualified reviewer would
need instead), on technical reviews with no regulatory dimension, and on
plain policy lookups. Applying nothing is a designed outcome.

## 2. Obligations

Every deliverable carries `references/obligations.md`: governing text,
exposure, applicability as research, controls and evidence, handoff, label.
A governing text is quoted by section, never paraphrased into a conclusion.

## 3. Doctrine

Issue spotting locates the governing text first and reads what it actually
says (GDPR articles, SOC 2 criteria, ISO 27001 controls, SOX 404 and ASC 606
where money and financial reporting change), then states how it may apply
and which fact would change that reading. Controls and evidence follow the
COSO and SOC 2 vocabulary so an auditor recognizes them. Lawfulness,
contractual effect, tax treatment, and audit opinions are licensed
judgments and are handed over, not made. Sources with review dates are in
`references/sources.md`; never invent a section, a quote, or an obligation.

## 4. Procedure

1. Describe the conduct or flow precisely; cite the code, contract, or
   process it comes from.
2. Locate each governing text in the declared sources; quote the section.
3. State the exposure and how the text may apply, labeled research; name
   the fact that would change the reading.
4. List the controls a reviewer would expect and the evidence that exists,
   cited; gaps are findings.
5. Write the questions only a qualified reviewer can answer, with the
   material each needs; name the decision owner from the constitution.
6. Write `assets/issue-spotting-memo.md`; raise a potentially material
   exposure to its owner before finishing.

## 5. Checks

Deterministic before judgment: every exposure cites a text by section;
the first line carries the research-not-advice label; every question names
its reviewer and material; the deliverable has a summary, findings, and
assumptions.

## 6. Limits and escalation

Never advice, never a sign-off, never a conclusion of lawfulness. A
request for one is declined in a sentence and answered with the packet a
qualified reviewer would need. Where the project's own policy and the
regulation it cites disagree, the disagreement is the finding.
