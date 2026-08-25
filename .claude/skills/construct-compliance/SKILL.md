---
name: construct-compliance
description: >-
  Controls and evidence over intent: a change is what it does to who can
  act, what gets recorded, and what an auditor can verify afterward. Use
  when the outcome touches compliance. Every deliverable is labeled
  compliance analysis, not an audit opinion or a certification.
license: Apache-2.0
metadata:
  generator: construct
  version: 3.0.0-alpha.17
  lens: compliance
---

# The compliance lens

This file is generated from the role catalog of the tool named in its
metadata. Editing it here changes nothing durable: the next generation
overwrites the folder, and removal deletes it whole. Change the catalog
instead.

## Posture

Controls and evidence over intent: a change is what it does to who can act,
what gets recorded, and what an auditor can verify afterward.

## When this applies

Take this lens when the work touches compliance.

## The questions

Work through every one. A question left unasked is a finding not made, and
the answer "nothing found" is only worth reading once the question has been
put.

1. When a change moves who or what performs an action, which identity acts
   afterward, what audit trail records that act, and who reviews that
   access?
2. For every permission, credential, or trust change: does it widen or
   narrow access, and do the review and audit processes follow the new
   identity or still watch the old one?
3. Which standing obligations or open requests (certifications, customer
   commitments, access-control asks already on file) does this change
   satisfy, advance, or contradict? When an open access request and a design
   change converge on the same access model, state the governance
   consequence for that pair — which identity acts, who reviews that access,
   where the audit trail must follow — citing both documents.
4. What evidence would an auditor ask for after this ships, and does that
   evidence exist or is it only planned?
5. Where does a shared or privileged credential get replaced, retired, or
   quietly kept — and who still holds it?

## What the deliverable must carry

### compliance — compliance review

Stages, in order: discover, research, clarify, draft, review.

Every one of these is filled before the work is finished; a fact the
material cannot settle is written as an assumption, never left blank:

- finding — the conclusion, stated first, in plain language
- evidence — what supports the finding, each item citing a source read or
  the domain catalog
- risks — what could make the finding wrong, or "none identified" said
  explicitly
- access-and-audit — for each change in who or what acts: the identity that
  acts afterward, the audit trail that records it, and who reviews that
  access

Filled when there is something to say:

- open-questions — what remains unknown, each with the assumed default the
  draft proceeds on

## When to stop and escalate

- A control gap with no owner: put the ownership question in the decision
  inbox.
- A regulator-facing obligation possibly breached: route to licensed review
  before anything relies on the finding.

## Limits

Every deliverable carries this label: compliance analysis, not an audit
opinion or a certification.

## What this method stands on

References identify where the discipline comes from; they are not reproduced
here, and what a standard currently says is checked against the standard.

- NIST Cybersecurity Framework (CSF) 2.0 (NIST) — the controls-and-evidence
  framing: a control without recorded evidence is a claim, not a control
