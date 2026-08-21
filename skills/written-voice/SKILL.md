---
name: written-voice
description: One plain, direct house voice for every prose deliverable
  someone else will read, plus per-genre shapes - spec, proposal, status
  update, announcement, README. The reader's decision or the outcome goes at
  the top, hype vocabulary is banned unless defined and earned, and every
  claim of done or tested must have been observed. Use before drafting any
  document a reader will act on - a spec, proposal, update, announcement,
  README, report, or memo - and when unifying documents written by different
  hands or models into one voice, or when a draft reads buried, hedged, or
  salesy and needs the decision surfaced. Not for a two-line chat answer, a
  code comment, a commit message, or prose whose format is dictated by an
  external template - write those directly and skip this method entirely.
license: Apache-2.0
metadata:
  version: 0.1.0
  source: geraldmaron/construct
---

# Written voice

A working method for prose that respects its reader's time and its own
claims. It exists because the default behavior of a capable model asked for
a document is specific and bad: open with throat-clearing, bury the one
thing the reader came for under background, inflate ordinary work with
vocabulary that sells rather than states, hedge every assertion until
nothing is claimed, and describe work as done that was never observed done.
The result reads professional and costs the reader a full read to extract a
sentence's worth of information - and when documents come from different
hands or different models, each adds its own version of this, so a project's
written record ends up in six voices, none of them trustworthy.

Every rule below is mandatory when this skill is engaged. The deliverable is
a draft until its verification record is complete.

## 1. Scope - and when to stand down

Engage this method when someone other than the author will read the prose
and act on it: a spec, a proposal, a status update, an announcement, a
README, a report, a decision memo. Engage it also for unification passes -
existing documents being brought into one voice.

Stand down when the writing is not a deliverable. A chat reply, a code
comment, a commit message, a quick answer to a quick question - write it
plainly and skip the apparatus. Stand down too when an external template
dictates the format (a legal filing, a grant form, a journal's structure):
fill the template honestly and apply only §4's claims discipline, which
applies to all prose everywhere. Applying the full method to a two-line
answer is a failure of this skill, not a safe default.

If it is genuinely unclear whether the prose is a deliverable, it probably
is - the cost of the method is minutes, and the cost of a buried decision is
the reader's.

## 2. The reader, before the first word

Two questions answered before drafting, in one line each, kept with the
draft (they do not have to ship in the final document, but they must exist):

- **Who reads this, and what do they decide or do because of it?** A
  document with no identifiable reader action is a note to self; write it as
  one and stand down. "Leadership decides whether to fund this",
  "an engineer implements from this", "a stranger evaluates whether to use
  this" - each demands different content, and naming the action is what
  reveals which.
- **What is the one sentence the reader would keep?** If it cannot be
  written yet, the thinking is not done, and no amount of drafting will hide
  that - the document will be long because it is unresolved.

## 3. The voice

These rules produce one voice regardless of who or what drafts:

- **The decision or outcome at the top.** The first screen of the document
  answers the reader's question: what happened, what is recommended, what is
  being asked of them. Background, method, and history come after, for
  readers who want them. The test: a reader who stops after the first three
  sentences should leave with the right conclusion, just less support for it.
- **Plain and direct, contractions fine.** Short paragraphs. Descriptive
  headings a scanner can navigate by - a heading states what its section
  says ("The migration costs two weeks", not "Timeline considerations").
  Numbered steps for sequences. Say the thing, then stop; a sentence that
  restates the previous sentence in different words is deleted, not
  polished.
- **Hype vocabulary is banned unless defined and earned.** Seamless, robust,
  revolutionary, best-in-class, cutting-edge, powerful, blazing, and their
  relatives assert quality without stating any fact. Each is either deleted,
  or replaced by the measurable thing it was gesturing at ("handles the
  reconnect without dropping the session" instead of "seamless"). A word
  survives only with its definition and evidence in the same passage.
- **One recommendation, not a menu.** Where the document recommends, it
  recommends one thing, first, and says why - alternatives appear as
  considered-and-not-chosen, with the reason. A menu of equal options
  delegates the author's job to the reader. (Where the choice itself is the
  deliverable and it is genuinely contested, that is a decision-framing
  problem; if a decision-framing skill is present it governs that section,
  and if not, still: one recommendation, then the case against it.)
- **Tables only for real comparisons** - things with shared criteria a
  reader will compare cell against cell. Explanations live in prose;
  a table whose cells are sentences is prose wearing a grid.
- **Facts, inferences, and recommendations visibly distinct.** A reader must
  never have to guess which one a sentence is. Where it could be unclear,
  label it in the sentence itself: "measured", "we infer", "we recommend".

## 4. The claims discipline

This section applies to all prose, everywhere, including prose this skill
otherwise stands down from:

- **Done means observed done.** Nothing is described as complete, tested,
  passing, verified, deployed, or working unless that state was actually
  observed. Work believed finished but not verified is stated exactly that
  way. The observed failure this rule exists for: a status update saying
  "tests pass" written before the tests ran, which cost the reader who
  relied on it more than an honest "not yet run" ever could.
- **Load-bearing facts carry their support.** A number, date, price, quote,
  or named-thing assertion the reader will act on is cited to something the
  reader can check, or marked `[unverified]` with one sentence on what
  would settle it. Assumptions the document leans on are marked `[assumed]`.
  (Where verification is itself real work, that is a research discipline;
  if an investigative-research skill is present it governs that work, and
  if not, the marks stay honest rather than quietly hardening into facts.)
- **Failure is reported plainly.** If something failed, was skipped, or fell
  out of scope, the document says so where the reader will see it - not in a
  final paragraph's subordinate clause. Bad news buried is a claim the
  document makes about how well things went, and it is a false one.

## 5. The genre shapes

Each shape is a starting skeleton, not a cage - sections a given document
does not need are dropped, and the dropping is a judgment the author makes
visibly, not by forgetting. What no genre drops: the top-of-document
decision (§3) and the claims discipline (§4).

**Spec** (reader: someone who builds, and someone who later checks)
```
<Title: the capability, plainly>
Outcome: what exists when this is done, in observable terms
Non-goals: what this deliberately does not do
Requirements: outcomes vs constraints, separated and labeled
Acceptance: criteria a stranger could check, each one an observation
Open questions: only ones the author could not settle - each says why
```

**Proposal** (reader: someone who funds, approves, or declines)
```
<Title: the ask>
The ask: what is requested, from whom, by when - first sentence
Why now: the problem or opening, with its evidence
The plan: numbered, with costs stated where they are known
Risks: the strongest case against, stated honestly, with mitigations
Not chosen: alternatives considered, one line each on why not
```

**Status update** (reader: someone deciding whether to intervene)
```
<Title or first line: overall state in one sentence - on track, at risk,
blocked, done>
Done: verified-done items (§4 governs the word)
In progress: with expected landing, marked [assumed] where it is a guess
Blocked / needs you: what, and exactly what is needed from whom
Risks: what could change the picture, and the early signal
```

**Announcement** (reader: someone affected who did not ask)
```
First sentence: what changes, for whom, when
What you must do: if nothing, say "nothing" explicitly
What actually changes: before/after, plainly, no sell
Why: brief, honest, after the practical content
Where to ask: one place
```

**README** (reader: a stranger deciding whether and how to use this)
```
One sentence: what this is and who it is for
Working example: the shortest real usage that does something
Install / setup: numbered, tested as written
Limits: what this does not do, stated as plainly as what it does
Status: how maintained and how stable, honestly
```

## 6. The unification pass

When bringing existing prose into the house voice - one document or a set:

1. **Extract the keep-sentence first** (§2). If the original buried it,
   surfacing it is most of the work.
2. **Reorder before rewording.** Decision to the top, background down.
   Most multi-voice damage is structural, not lexical.
3. **Sweep hype and hedges.** Replace each hype word with its fact or delete
   it; collapse stacked hedges ("it might perhaps be possible") to one
   honest qualifier or a plain statement.
4. **Re-run the claims discipline** on every done/tested/working assertion
   the original makes - unification must not launder an unverified claim
   into a confident house-voice sentence. This is the pass's one danger:
   better prose makes false claims more convincing.
5. **Preserve meaning conservatively.** Where the original is ambiguous,
   keep the ambiguity and flag it, or ask - never resolve it by guessing
   fluently.

## 7. The closing gates

Before the deliverable is called final, each gate is answered - work shown,
not work claimed:

1. **Reader named** - who reads this and what they do because of it exists
   in one line (shipped or kept with the draft) (§2).
2. **Decision on top** - the first screen answers the reader's question;
   the three-sentence test passes (§3).
3. **Hype swept** - zero banned words, or each survivor defined and
   evidenced in its passage (§3).
4. **Claims honest** - every done/tested/working statement was observed;
   load-bearing facts cited, `[unverified]`, or `[assumed]`; failures
   reported where the reader will see them (§4).
5. **Shape held** - the genre's skeleton used; dropped sections dropped on
   purpose, and on request the author can say why (§5).
6. **One recommendation** - where the document recommends, it recommends one
   thing, with alternatives as considered-and-not-chosen (§3).

## 8. The verification record

The deliverable ends with a short block, exactly this shape:

```
Verification record
- Reader named:      answered — <who acts, and how>
- Decision on top:   answered — see <where>
- Hype swept:        answered — <clean | survivors defined: <which>>
- Claims honest:     answered — <all observed | marked: <count> [unverified]/[assumed]>
- Shape held:        answered — <genre> | dropped: <sections, or none>
- One recommendation: answered — see <where> | not applicable: nothing recommended
```

For a shipped document where the block would be noise (an announcement, a
README), the record may live beside the deliverable rather than inside it -
but it exists, and it says where. A gate that was not done says `not done -
<reason>` in its slot. It is never deleted, never skipped silently. Until
every line is filled in, the deliverable is labeled a draft, by you, in its
title line.

The record is presence, not quality: it proves each gate was answered and
where, not that the answers are good. Whether the keep-sentence is the right
sentence is judgment, and the record never claims to have automated it.

## 9. What is enforced, and by what

Nothing in this file is machine-enforced by this file. The voice rules, the
gates, and the record are obligations on you, made checkable for the reader
- that visibility is the enforcement tier this skill carries everywhere it
goes. An environment that separately lints hype words or the record's
presence adds a deterministic tier on top; this file works identically with
or without one, and never claims a tier it is not running under.

## References

Method identified, not incorporated - these name where the discipline comes
from, and reading them is not required to follow it:

- Minto, *The Pyramid Principle*, 1987 - the governing thought first,
  support beneath it (§2, §3).
- Gopen & Swan, "The Science of Scientific Writing," American Scientist
  78(6), 1990 - readers take meaning from where information sits in a
  sentence, not only from the words (§3).
- Williams & Bizup, *Style: Lessons in Clarity and Grace* - clarity as
  characters-and-actions, hedges and throat-clearing as diagnosable defects
  (§3, §6).
- Plain Writing Act of 2010, and the U.S. federal plain-language
  guidelines - the reader's action as the organizing principle of a
  document (§2, §5).
- Orwell, "Politics and the English Language," 1946 - inflated vocabulary as
  a way of not saying things (§3).
