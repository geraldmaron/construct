---
name: product-management
description: >-
  Reviews or shapes a product decision: the problem, who has it, what
  changes for them, how it will be measured, what is cut. Use when the
  person says things like: everyone loves this idea but nobody can say what
  it changes for the customer; sanity check this spec before engineering
  starts; which of these twelve asks actually matter this quarter; did last
  quarter's launch do anything; what should we build next; is this worth
  building. Not for writing the buildable requirements (that is
  requirements).
license: Apache-2.0
metadata:
  version: 1.0.0
  source: geraldmaron/construct
---
# Product management

A pack of obligations for what a product should do and why. It reviews and
shapes requirements, opportunity assessments, and priority calls so that the
problem, the users, the outcome and its measure, the scope, and the evidence
are all stated and checkable. It does not decide how to build; engineering
and architecture own that.

## 1. Scope - and when to stand down

Engage when a product document, feature proposal, or priority call is about
to be committed to and the problem, users, outcome, scope, or evidence are
unstated or unsupported. Stand down on how-to-build questions, on plain
questions about what the product does, and on decisions already made that
need execution rather than framing. Applying nothing is a designed outcome.

## 2. Obligations

Every deliverable carries `references/obligations.md`: problem and users,
outcome and measure, scope, priority evidence, assumptions, decision rights.
A measure the project's sources cannot observe is written as unobservable.

## 3. Doctrine

Value, usability, feasibility, and viability are separate risks (Cagan) and
a document that addresses one is not done. Discovery is continuous evidence,
not a one-off study (Torres). The customer outcome is stated first, in the
customer's words, before the solution (working backwards). Unsupported
claims are hypotheses with a test attached (Ries), and measures are results,
not deliverables (Doerr). Sources with review dates are in
`references/sources.md`; cite what a finding leans on and never invent user
evidence or a market figure the sources do not hold.

## 4. Procedure

1. Read the document and the confirmed primary outcome and success
   measures; cite them.
2. Restate the problem in the users' words; if the document cannot, that is
   the first finding.
3. For each outcome, name the measure and the declared source that could
   observe it; otherwise write unobservable.
4. Separate scope in, scope out, and non-goals; treat non-goals as claims.
5. Attach evidence or the word assumption to every priority reason.
6. Where the real question is whether to build, hand it to decision-framing
   and stop specifying around it; write `assets/prd.md` or
   `assets/opportunity-assessment.md` otherwise.

## 5. Checks

Deterministic before judgment: every user or market claim cites a declared
source or is labeled an assumption; every outcome has a measure row; the
deliverable has a summary, findings, and assumptions.

## 6. Limits and escalation

This pack frames and reviews; it never decides to build, cut, or ship, and it
never produces the numbers it lacks. An unobservable measure goes to the
person with the source it would need. Legal, pricing, and financial
exposure questions go to governance-risk as issue spotting.
