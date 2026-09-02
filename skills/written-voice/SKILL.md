---
name: written-voice
description: >-
  One plain, direct house voice for prose: what it says, for whom, and
  nothing decorative. Use when the person says things like: make this sound
  less like a robot wrote it; rewrite the outage email so customers don't
  panic; this reads like marketing, make it plain; tighten this up, it's
  three pages saying one thing; draft the announcement; is the tone right.
  Not for what the document decides, only how it says it.
license: Apache-2.0
metadata:
  version: 0.4.0
  source: geraldmaron/construct
---

# Written voice

A working method for prose that respects its reader's time and its own
claims. Default failure: throat-clearing, buried decision, hype vocabulary,
hedged assertions, "done" that was never observed - and six voices across
documents from different hands.

Every rule below is mandatory when this skill is engaged. Opt-in house
style: install deliberately; it is not in a default `--all` pack.

## 1. Scope - and when to stand down

Engage when someone other than the author will read and act: spec,
proposal, status update, announcement, README, report, decision memo. Also
for unification passes bringing documents into one voice.

Stand down when the writing is not a deliverable - chat reply, code
comment, commit message, quick answer. Stand down when an external
template dictates format (legal filing, grant form, journal structure):
fill honestly and apply only §4's claims discipline. Applying the full
method to a two-line answer is a failure of this skill. Applying nothing
is a designed outcome.

## 2. The reader, before the first word

Two questions, one line each, kept with the draft:

- **Who reads this, and what do they decide or do because of it?** No
  identifiable reader action → note to self; stand down.
- **What is the one sentence the reader would keep?** If it cannot be
  written yet, the thinking is not done.

## 3. The voice

- **Decision or outcome at the top.** First screen answers the reader's
  question. Three-sentence test: stop after three and still leave with the
  right conclusion.
- **Plain and direct, contractions fine.** Short paragraphs. Headings state
  what the section says. Numbered steps for sequences. Say it, then stop.
- **Hype banned unless defined and earned.** Seamless, robust,
  revolutionary, best-in-class, cutting-edge, powerful, blazing - delete or
  replace with the measurable thing. Survivors need definition and evidence
  in the same passage.
- **One recommendation, not a menu.** Alternatives as considered-and-not-
  chosen. Contested choices: if decision-framing is present it governs;
  otherwise still one recommendation, then the case against.
- **Tables only for real comparisons** - shared criteria, cell against
  cell. Sentence-cells are prose wearing a grid.
- **Facts, inferences, and recommendations visibly distinct** - label in
  the sentence when unclear: "measured", "we infer", "we recommend".

## 4. The claims discipline

Applies to all prose, including prose this skill otherwise stands down from:

- **Done means observed done.** Complete, tested, passing, verified,
  deployed, working - only if observed. Believed-but-unverified is stated
  that way.
- **Load-bearing facts carry support** - cited, `[unverified]`, or
  `[assumed]`. If investigative-research is present it governs deep
  verification.
- **Failure reported plainly** where the reader will see it - not buried.

## 5. Presentation and genres

Standard header, shape-follows-content, segmenting, visuals, and human-
reads rules:
[references/presentation.md](references/presentation.md).

Genre skeletons (spec, proposal, status, announcement, README, decision
log, handoff):
[references/genre-shapes.md](references/genre-shapes.md).

## 6. The unification pass

When bringing existing prose into house voice:

1. Extract the keep-sentence first (§2).
2. Reorder before rewording - decision to top.
3. Sweep hype and stacked hedges.
4. Re-run claims discipline on every done/tested/working assertion -
   better prose must not launder unverified claims.
5. Preserve meaning conservatively - flag ambiguity; never resolve by
   fluent guess.

## 7. Closing gates

1. Reader named - who acts, and how.
2. Decision on top - three-sentence test passes.
3. Hype swept - clean, or survivors defined and evidenced.
4. Claims honest - observed done; facts marked; failures visible.
5. Shape held - genre skeleton; dropped sections on purpose.
6. One recommendation where the document recommends.
7. Formatted by shape - mix follows content; every screenful has an entry
   point; banned tics absent.

## Closing record

When finalizing, use
[references/verification-record.md](references/verification-record.md).
Method sources: [references/sources.md](references/sources.md).
