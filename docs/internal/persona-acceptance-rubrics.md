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

---

The rubrics below were added 2026-08-10, when the concerns they judge were
added to the catalog. They are committed here before any deliverable from
those concerns has been judged, and before any of the five packs has passed a
harness-plant run — which is the only order in which a rubric means anything.

## Director / VP (strategy-alignment)

- must S1. The price of saying yes is named specifically — the work that
  stops, slips, or goes unstaffed — or the deliverable states plainly that the
  material does not settle it. "We will find capacity" fails this line.
- must S2. Any conflict with a recorded commitment, roadmap line, or stated
  priority is quoted from the material, not characterized.
- must S3. The decision owner is named, and the deliverable says whether it is
  asking that person to decide or informing them after the fact.
- should S4. What would make this the wrong bet is stated in terms someone
  could observe before the money is spent, not as a generic risk.

## Architect / tech lead (system-design)

- must D1. Reversible choices are separated from one-way doors, and each
  one-way door carries what unwinding it would cost.
- must D2. The deliverable stays inside the declared ceiling: shape,
  boundaries, coupling, migration. A code review, a patch, or an
  implementation opinion fails this line even when it is correct.
- must D3. Any claim about how the current system is shaped is tied to
  material actually read, or tagged.
- should D4. The second consumer is considered — what breaks when someone
  other than the first caller uses this.

## Support / on-call (operations)

- must O1. Every failure path names how anyone finds out about it. A failure
  with no detection path is stated as such rather than omitted.
- must O2. An owner is named for answering the failure, with what access that
  person needs; "the team" is not an owner.
- must O3. The rollback is stated, including past any irreversible step, or
  the deliverable says plainly that there is none.
- should O4. The recurring cost of keeping this alive is named, not folded
  into the build estimate.

## Designer / UX (user-experience)

- must U1. The path from where the user starts to what they came to do is
  written out step by step, and the steps this change adds are identified.
- must U2. The unhandled states this change creates — empty, error, partial,
  permission-denied — are enumerated, with what the interface says in each.
- must U3. Any claim about existing product behavior is tied to material or
  tagged; no invented screens.
- should U4. A pattern change names the cost to users who already learned the
  old pattern.

## Data / analyst (measurement)

- must M1. Each claimed behavior is marked observable or unobservable in
  production today, with the measurement that exists, is requested, or is
  missing.
- must M2. The baseline is stated, including the case where none exists and
  what that costs a before/after comparison.
- must M3. Instrumentation names where a number would be recorded and who
  owns recording it.

## Security engineer (security)

- must Y1. Each threat path runs from who can reach the surface to what they
  gain, with the check that stops it or the explicit gap where none does.
- must Y2. Blast radius is stated concretely — one record, one tenant, every
  tenant, or persistent access — not as a severity word.
- must Y3. The deliverable stays defensive: exposures, paths, and checks. Any
  working exploit, attack tooling, or evasion guidance fails this line.
- should Y4. What evidence would show the exposure had already been used is
  named, and whether anything records it today.

## Settled: O2 and M3 against the [unowned] rule (2026-08-13)

Four of eleven verdicts in the wave-B panel are rejections and all four are the
same complaint: operations O2 asks that an owner is named for answering the
failure, measurement M3 that instrumentation names who owns recording the
number, and the deliverables wrote `[unowned]` with the reason the material
names nobody and who would have to supply one.

Both sides were working correctly. The work-product directive requires the
`[unowned]` marker precisely so that a resolving step with nobody attached is
visible rather than quietly ownerless, and an invented name is worse than an
absent one. The rubric asks for a name.

**The rubric is not amended.** A rubric reinterpreted after seeing the
deliverables it judges is no longer pre-committed, and the pre-commitment is the
whole instrument — it is the only reason a score from it means anything. The
four recorded verdicts keep their as-run values.

What changed is the production side. A role is now told that where something
needs an owner and the material names none, it proposes who should own it and
why that role; and that where nothing in the material supports even that, the
owner is whoever asked for the work, because saying so is more use to a reader
than an empty line (`src/kernel/run/grounding.ts`, ANSWER_THE_ASK). A proposal is
marked as a proposal, so nothing is invented and nothing is passed off as
found — the marker's original purpose is kept and the line becomes satisfiable
rather than being lowered to meet what was already written.

The enforcement agrees in the same direction: the reader-rubric check fails a
slot that describes the absence of an owner rather than naming one, so prose
about ownership does not pass as ownership either.
