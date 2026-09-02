---
name: investigative-research
description: >-
  Establishes what is actually true from primary sources and records: claims
  checked against evidence, timelines reconstructed, provenance kept. Use
  when the person says things like: is that real; someone claims X, check
  it; find out whether their numbers are true; what actually happened, the
  timeline doesn't add up; verify this before we publish; who said what and
  when. Not for deciding what to do with the facts, and not for compliance
  obligations.
license: Apache-2.0
metadata:
  version: 0.3.0
  source: geraldmaron/construct
---

# Investigative research

A working method for research whose conclusion must survive a reader who
wants it wrong. Default failure: cite the nearest thing, cite what was
never opened, treat a summary as the thing summarized, read silence as
confirmation, stop at the first coherent story.

Every step below is mandatory when this skill is engaged.

## 1. Scope - and when to stand down

Engage when the conclusion carries weight: someone will decide, spend,
accuse, publish, or rely on it. Due diligence, background, competitive or
market claims, incident/timeline reconstruction, verify-this-claim.

Stand down on single-fact questions with one authoritative source - answer
with one citation. Stand down on brainstorms, drafts, opinions, or
explicit speed-over-certainty - say in one sentence the method was not
applied. If stakes are unclear, ask one question. Applying nothing is a
designed outcome.

## 2. The citation discipline

Three markers, on the same line as the claim:

- `[cite: <source>]` - requester's own material (always outranks elsewhere).
- `[research: <what it is, and where a reader finds it>]` - public material
  you actually opened. Title, publisher, identifier - never a bare domain.
- `[unverified]` - plus one sentence on what would settle it.

Load-bearing (must carry a marker): money, percentages, dates, durations,
statute/regulation refs, proper-name assertions, anything the conclusion
would change without. When in doubt, it is load-bearing.

No exceptions:

1. **Never cite what you did not open.** No way to read public material:
   say so and mark `[unverified]` - never narrate a search you did not run.
2. **Never cite your own scaffolding** - notes, this skill, tooling.
3. **Prose about citing is not citing.** Only the markers are the practice.

## 3. Source classing

On first use, name the class:

- **Record** - the thing itself (filing, statute, contract, commit, transcript).
- **Derived record** - official restatement (index, certified extract).
- **Aggregator** - someone's write-up (news, encyclopedia, vendor blog).
- **Inference** - your conclusion; marked every time it appears.

**Date-kind rule.** When asserting a date/status/name, state what kind it
is in the source: when it happened, was registered, or was last checked.

**Silence is not confirmation.** If the conclusion leans on silence, say so
and class as inference.

## 4. Independence and triangulation

Copies of one upstream are one source. Before calling corroboration:
trace upstream; count only sources that *could have disagreed*. Class the
corroboration (two records strong; record + aggregator may mean the
aggregator read the same record). Keep a running single-source list under
its own heading - with whether an independent source could exist and where.

## 5. The disconfirmation pass

Before any conclusion is final:

1. State at least two hypotheses that fit the evidence - lean and strongest
   rival ("record incomplete", "innocuous explanation" often matter).
2. For each, name what would refute it - then look for that specifically.
3. Weigh by least credible disconfirmation, not most confirmation.
4. Contested conclusions: hypotheses as columns, evidence as rows, cells
   consistent / inconsistent / silent.

If the pass reversed or weakened the draft conclusion, say so.

## 6. Coverage and absence

- Frame in one sentence: population, geography, or period covered; what
  falls outside on purpose.
- Classify notable absences: not-recorded | not-yet-collected |
  did-not-happen. Unclassifiable stays unknown - never silently
  did-not-happen.
- Check implied coverage against the collection; narrow the surface if needed.
- Name whose record is systematically thinner where the skew exists.

## 7. Research conduct

- Provided material first; research fills gaps, never overrides.
- Capability honesty - no public-read path means mark `[unverified]`.
- Primary over aggregator: cite the text a claim depends on; if only a
  summary was reached, say the primary went unread in the same sentence.
- One pass per gap, then stop - ask when their answer changes work, else
  `[assumed]`. Gaps never withhold the deliverable.
- Ground exhausted: every named reachable document read, or its line says why not.

## 8. Handbacks are earned

Before listing an open question: could you have answered from held
material, something reachable, or one more bounded pass? If yes, answer
it. Hand back only what needs authority, access, or a decision you lack.

## 9. Closing gates

1. Claims cited - every load-bearing claim marked.
2. Source classes stated - date-kinds where dates carry weight.
3. Independence stated - single-source list; no corroboration on copies.
4. Disconfirmation shown - rivals, refuters sought, table if contested.
5. Coverage frame stated - frame sentence and classified absences.
6. Ground exhausted - named docs read or why not.
7. Strongest objection - own words, own heading.
8. Pre-mortem - on any recommendation: most likely failure story.
9. Handbacks earned - only unsettled questions.

## Closing record

When finalizing, use
[references/verification-record.md](references/verification-record.md).
Method sources: [references/sources.md](references/sources.md).
