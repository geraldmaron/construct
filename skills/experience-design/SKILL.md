---
name: experience-design
description: >-
  Reviews or reshapes an interface or flow for whether people succeed in it:
  task completion, findability, error states, accessibility, and fit with
  the design system. Use when the person says things like: customers abandon
  the signup at this step; support keeps asking where the button is; nobody
  can find anything on this page; the checkout takes too many screens; is
  this form usable; does this screen follow our design system. Not for
  backend behaviour or copy tone alone.
license: Apache-2.0
metadata:
  version: 1.0.0
  source: geraldmaron/construct
---
# Experience design

A pack of obligations for what people meet on the screen: whether they can
do the task, whether anyone is excluded, what happens when things go wrong,
whether the parts agree with each other, and what evidence any of it rests
on. It is not a taste review.

## 1. Scope - and when to stand down

Engage when a screen, flow, prototype, or component is about to ship or be
committed to and people will use it. Stand down on questions of taste with
no task in view, on component implementation detail, and on behavior with
no interface. Applying nothing is a designed outcome.

## 2. Obligations

Every deliverable carries `references/obligations.md`: task success,
accessibility, error states, consistency, evidence. Accessibility findings
always name the WCAG 2.2 success criterion; a design "fully accessible"
without one is a claim, not a finding.

## 3. Doctrine

Usability is judged task-first (Krug) through named heuristics (Nielsen)
and the affordance-feedback-error-prevention frame (Norman). Accessibility
is judged against WCAG 2.2 at the project's declared level, AA by default.
Consistency is judged against the project's own design system where one is
declared; a public system is an example, not a rule. Sources with review
dates are in `references/sources.md`; never invent a criterion, a heuristic,
or a research result.

## 4. Procedure

1. Name the task and the person; read the design system and accessibility
   target the project declares; cite them.
2. Walk the task; note where a person would fail and why.
3. Check keyboard operation, focus visibility, contrast, labels, and use of
   color; record each finding with its criterion and level.
4. Walk empty, invalid, slow, and failed states; record what the person is
   told to do.
5. Mark departures from the design system as deliberate or not.
6. Attach research or usage evidence to each behavior claim, or label it an
   assumption; write `assets/experience-review.md`.

## 5. Checks

Deterministic before judgment: every accessibility finding carries a
criterion id; every behavior claim carries a source or the word assumption;
the deliverable has a summary, findings, and assumptions.

## 6. Limits and escalation

This pack does not conduct research; a behavior claim without evidence is
handed to strategy-research or the person as an assumption to test. It does
not certify legal accessibility compliance; a finding that an obligation may
apply goes to governance-risk as issue spotting. Exclusion by disability is
never a minor finding.
