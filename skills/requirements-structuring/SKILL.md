---
name: requirements-structuring
description: Turns an intent - "we should build X" - into a requirements
  artifact someone could build from and a stranger could verify against.
  Outcomes, constraints, assumptions, and already-made decisions separated
  and labeled; every acceptance criterion an observation a stranger could
  make; non-goals stated; open questions earned, not dumped. Shapes for a
  full PRD, a one-page brief, and a change-request addendum. Use when
  scoping a feature, product, program, or change - "write the requirements",
  "spec this out", "turn this idea into a PRD", or when a build is starting
  on requirements that exist only as conversation. Not for work whose
  requirements are already obvious and small (a rename, a config change, a
  well-understood fix) - state the one-line intent and proceed - and not for
  the decision of WHETHER to build, which is a decision-framing problem to
  surface, not to specify around.
license: Apache-2.0
metadata:
  version: 0.4.0
  source: geraldmaron/construct
---

# Requirements structuring

A working method for the artifact that stands between an intent and a build.
It exists because the default behavior of a capable model asked for
requirements is specific and bad: restate the request in more words, mix
what the requester wants with how the author assumes it will be built, write
acceptance criteria no one could check ("works well", "is intuitive"), leave
the deliberate exclusions unstated so scope grows by silence, and close with
a list of open questions the author could have answered. The resulting
document reads complete and settles nothing - the gaps surface during the
build, where they cost the most.

Every rule below is mandatory when this skill is engaged. The deliverable is
a draft until its verification record is complete.

## 1. Scope - and when to stand down

Engage this method when work will be built, bought, or committed to on the
strength of the artifact, and the requirements currently live in
conversation, intent, or someone's head.

Stand down when the requirements are already obvious and small - a rename, a
config flip, a well-understood fix. State the intent in one line and
proceed; a spec for a task smaller than the spec is ceremony. Stand down
differently when the real question is *whether*, not *what*: if the intent
hides an undecided decision ("spec the migration to X" where X was never
chosen), surface the decision explicitly rather than specifying around it -
that is a decision-framing problem, and if a decision-framing skill is
present it governs that step; if not, name the undecided thing at the top of
the artifact and mark everything contingent on it.

## 2. The four-way separation

Everything the requester said, implied, or inherited is sorted into four
labeled lists before any document shape is filled. Sorting is the method;
most requirement failures are one of these masquerading as another:

- **Outcomes** - what is true when this is done, stated as observable
  results, not features. "A returning user resumes in under a second", not
  "add session caching." If an entry names an implementation, ask what the
  implementation is for until an outcome appears; keep the implementation
  only if it is genuinely a constraint (below).
- **Constraints** - falsifiable limits the solution must respect: platform,
  budget, deadline, compliance obligation, compatibility, a technology
  mandated from outside. Each constraint names where it comes from. A
  constraint with no source is a preference wearing a constraint's grammar -
  demote it and label it.
- **Assumptions** - things the artifact leans on that nobody has verified,
  each marked `[assumed]` with one sentence on what would settle it and what
  breaks if it is wrong. An assumption discovered during drafting is added
  here, never silently absorbed into an outcome.
- **Decided** - decisions already made by someone with the authority to make
  them, with who and when if known. These are recorded, not relitigated; the
  artifact builds on them. A decision that appears in no record and cannot
  be attributed is not decided - it is an assumption, and it moves up a
  list.

Facts that carry weight - a number, a date, a quota, a regulation - are
cited to something a reader can check or marked `[unverified]`. Where
verifying is itself real work, that is a research discipline; if an
investigative-research skill is present it governs it, and if not, the marks
stay honest.

## 3. The checkability rule

Every acceptance criterion states an observation a stranger could make
without asking anyone: an action taken, an output seen, a measurement and
its threshold, a state that exists. The test for each criterion: could two
people disagree about whether it is met? If yes, it is not a criterion yet.

- "Works well" becomes the measurement it was hiding, or is deleted.
- "Is fast" names the operation, the load, the number, and where the number
  comes from - a threshold invented while drafting is labeled as a chosen
  line, chosen by whom, never presented as an external standard.
- "Handles errors gracefully" becomes the enumerated failure cases and what
  the user sees in each.
- A criterion nobody intends to actually check is scope theater; delete it
  or mark who checks it and when.

## 4. Non-goals are claims

What this work deliberately does not do is stated in its own section, one
line per exclusion, with the reason. An unstated exclusion is how scope
grows by silence: every reader assumes their adjacent need is included
until told otherwise. A non-goal that keeps being argued about is usually an
undecided decision (§1) that was filed as an exclusion to end the argument -
surface it instead.

## 5. Open questions are earned

Before any question ships in the artifact, check: could the author have
settled it from material already held, from something reachable, or from one
bounded research pass? If yes, settle it - a question handed to the reader
that the author could have answered is the artifact failing, because the
reader holds less context than the author did. What remains is a short list
where each entry names why it could not be settled here: it needs authority
the author lacks, access the author lacks, or a decision that belongs to
someone named. Every open question names who answers it and what is blocked
until they do.

## 6. Priority honesty

Where the artifact ranks work: critical path, now, next, later - four
buckets, each meaning what it says. Critical path is only what the outcome
is impossible without. A ranking where everything is critical is not a
ranking; if more than roughly a third of the work lands in the top bucket,
re-sort with the question "what would we actually drop first?" - the answer
exists, and the artifact's job is to record it before the schedule forces
it.

## 7. The shapes

Three literal skeletons. Sections a given artifact does not need are dropped
on purpose, visibly - and no shape drops the separation (§2), checkable
acceptance (§3), or non-goals (§4).

**Full requirements document / PRD** (reader: builders, and a later checker)
```
<Title: the capability, plainly>
Status / Author — Contributors / Created — Last updated / Tags
  (the standard document header; if a written-voice skill is present its
  definition governs, and the fields are these either way)
Outcome: what is true when this is done - the one-paragraph version
Users: who this is for and who else is affected - and what changes for
  each of them, stated as their experience, not the system's internals
Context: only what a builder needs; history goes elsewhere
Decided: the standing decisions this builds on, attributed
Outcomes: numbered, observable
Success measures: how anyone will know it worked - each an observation or
  a measurement; thresholds sourced or labeled chosen, by whom (§3's rules
  apply here in full)
Constraints: labeled, sourced
Assumptions: [assumed], each with what settles it
Non-goals: one line each, with reasons
Acceptance criteria: numbered, each a stranger-checkable observation
Priorities: critical path / now / next / later
Risks: the strongest case against this working - each entry either a
  concrete failure story (what breaks, for whom) or the explicit label
  "deferred to adversarial review", so an honest deferral and a lazy stub
  can never look alike
Open questions: earned only - who answers, what is blocked
```

**One-page brief** (reader: someone deciding whether to invest more time)
```
<Title>
Status / Author — Contributors / Created — Last updated / Tags
Outcome: two sentences
The three lists that matter most here: outcomes, constraints, non-goals
Acceptance: the three to five criteria that define done
Open: only what blocks starting
```

**Change-request addendum** (reader: someone holding the original artifact)
```
<Title: the change, plainly>
Status / Author — Contributors / Created — Last updated / Tags
What changes: outcome/constraint/criterion, quoted before and after
Why: the event or evidence that forced it
What it invalidates: which existing criteria, assumptions, priorities move
Not changing: adjacent things a reader might assume moved, and did not
```

## 8. The closing gates

Before the artifact is called final, each gate is answered in the document -
work shown, not work claimed:

1. **Separated** - the four lists exist, each entry in the right one;
   implementation-shaped outcomes converted or justified as constraints;
   unattributed decisions demoted to assumptions (§2).
2. **Checkable** - every acceptance criterion passes the
   could-two-people-disagree test; invented thresholds labeled as chosen
   (§3).
3. **Non-goals stated** - the exclusions section exists and each entry has
   its reason (§4).
4. **Questions earned** - every open question names why it could not be
   settled here, who answers it, and what it blocks (§5).
5. **Priorities honest** - the top bucket holds only what the outcome is
   impossible without (§6).
6. **Decision surfaced** - if the intent hid a whether-decision, it is named
   at the top, not specified around (§1).

## 9. The verification record

The artifact ends with a short block, exactly this shape:

```
Verification record
- Separated:         answered — see <where> | outcomes <n>, constraints <n>, assumptions <n>, decided <n>
- Checkable:         answered — <all pass the disagree-test | exceptions listed at <where>>
- Non-goals stated:  answered — see <where>
- Questions earned:  answered — <none open | <n> open, each named at <where>>
- Priorities honest: answered — see <where> | not applicable: nothing ranked
- Decision surfaced: answered — <none hidden | named at <where>>
```

A gate that was not done says `not done - <reason>` in its slot. It is never
deleted, never skipped silently. Until every line is filled in, the artifact
is labeled a draft, by you, in its title line.

The record is presence, not quality: it proves each gate was answered and
where. Whether an outcome is the right outcome is judgment, and the record
never claims to have automated it.


Two rules travel with this record wherever skills compose. When several
skills govern one deliverable, the skill that owns the deliverable's shape
produces its full record, and every other skill contributes exactly one
line to that same block - its name, then its verdict or a one-clause gate
summary - never a second full block, because stacked records are how
ceremony buries content. And every "see <where>" in any record carries a
short quoted fragment of what it points to, not a bare location - a
pointer that cannot quote its target is pointing at nothing, and the
fragment is what makes an empty answer visible to a reader who can only
check presence.

## 10. What is enforced, and by what

Nothing in this file is machine-enforced by this file. The separation, the
gates, and the record are obligations on you, made checkable for the reader
- that visibility is the enforcement tier this skill carries everywhere it
goes. An environment that separately checks the record's presence adds a
deterministic tier on top; this file works identically with or without one,
and never claims a tier it is not running under.

## References

Method identified, not incorporated - these name where the discipline comes
from, and reading them is not required to follow it:

- Gause & Weinberg, *Exploring Requirements: Quality Before Design*, 1989 -
  requirements as discovery of what is wanted, separate from design of how.
- IEEE 29148 (formerly 830) - the verifiability requirement on individual
  requirements statements (§3's ancestor).
- Wiegers & Beatty, *Software Requirements*, 3rd ed. - the
  outcome/constraint separation and the cost curve of late-found gaps.
- Gilb, *Competitive Engineering*, 2005 - quantified acceptance over
  adjectival quality words.
- The "working backwards" PR/FAQ practice (Amazon, as publicly described) -
  the outcome stated before the mechanism.
