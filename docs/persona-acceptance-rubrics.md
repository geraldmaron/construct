# Persona acceptance rubrics

Committed before any judging, for the same reason the org-harness answer key
is: a rubric written after reading the deliverables would be tuned to pass
them. Each rubric states what a professional reader in that role requires from
a Construct deliverable to call it adequate **for the role Construct fills** —
a background staff that surfaces concerns, decisions, and finished drafts —
not adequate as that professional's own finished work product.

How the rubrics are used. A judge (a model, under the standing LLM-as-judge
approval; cross-family where independence matters) reads a deliverable from a
recorded run and answers each rubric line pass/fail with one sentence of
evidence quoting the deliverable. The verdict for a persona is the worst of:
**accept** (all must-pass lines hold), **accept-with-corrections** (a should
line fails), **reject** (a must line fails). Judge identity and the producer
model are recorded with every verdict; when they share a family, the
correlated-error caveat travels with the number. Gerald checks the outcomes;
his acceptance is the close gate. Nothing here licenses a claim about any
user other than the author.

Common floor (every persona, must-pass):

- C1. No invented provenance: every load-bearing claim carries a real source
  or an explicit [unverified]/[assumed] tag; nothing cites the tool's own
  scaffolding as authority.
- C2. The deliverable is actionable as given: numbered issues with the step
  that resolves each, not a restated gap or a request for the information the
  outcome never contained.
- C3. Missing information became labeled assumptions the work proceeded on,
  not a refusal to work.
- C4. The stated limits travel with the text (best-effort model label,
  licensed-review flag) wherever the deliverable could be read alone.

## Engineer

- must E1. Any claim about a system's behavior is either tied to stated
  material or tagged; no invented architecture.
- must E2. The deliverable stays inside the engineering lens's declared
  ceiling (cross-references, no implementation judgment) rather than
  role-playing a code review it cannot ground.
- should E3. Anything checkable is stated so an engineer could check it in
  one step (a name, a version, a place to look), not as a vague direction.

## Product manager

- must P1. Conflicting commitments are surfaced with both sides cited and an
  owner named — the PM's real job risk is the promise made twice.
- must P2. Scope boundaries are explicit: what this deliverable deliberately
  does not cover, stated, not discoverable by absence.
- should P3. A success measure is named where the outcome implies one, with
  whether the data for it exists.

## Operations

- must O1. Sequencing collisions and dependencies name who owns the
  resolution, not just that a collision exists.
- must O2. Interim restrictions and open requests are treated as planned work
  (a restriction that forbids what a request asks for is a collision with
  that request).
- should O3. Dates and durations carry what must be true for them that is
  not true yet.

## Legal

- must L1. Nothing reads as advice: issue-spot, draft, escalate; every
  finding flagged for licensed review; no jurisdiction asserted as covered.
- must L2. Jurisdiction-dependent claims name the dependence (one-party vs
  all-party consent, GDPR applicability) rather than assuming one silently.
- must L3. Provenance and authorship questions are raised where machine
  writes enter a system of record.
- should L4. The licensed-review recommendation is specific: which issues,
  which kind of professional, which jurisdiction question.

## Compliance

- must K1. Every access or identity change names the identity that acts
  afterward, the audit trail that records it, and who reviews that access.
- must K2. Evidence an auditor would ask for is distinguished as existing vs
  planned.
- should K3. Standing obligations (certifications, commitments) touched by
  the change are named, or the absence of information about them is tagged.

## R&D leadership

- must R1. The one decision that most changes the outcome is surfaced to the
  decision inbox rather than buried mid-document.
- must R2. Risk posture is proportionate: high-risk findings read as
  high-risk; nothing manufactures urgency and nothing sands it down.
- should R3. The cost of the run and its degradations (model tier, fallback
  events) are visible enough to govern spend.
