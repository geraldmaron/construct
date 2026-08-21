---
name: investigative-research
description: Disciplined multi-source research over public records and provided
  material, for conclusions that must survive a hostile reader. Mandatory
  verification gates - every load-bearing claim cited or marked [unverified],
  sources classed (record, derived record, aggregator, inference), independence
  checked before two sources count as two, a disconfirmation pass before any
  conclusion, and a closing verification record naming where each gate was
  answered. Use when the task is due diligence, a background or competitive
  investigation, incident or timeline reconstruction, verifying a specific
  claim, or any "what does the record actually say" question where being wrong
  has a cost. Not for casual lookups a single authoritative source settles -
  answer those directly and skip this method entirely.
license: Apache-2.0
metadata:
  version: 0.2.0
  source: geraldmaron/construct
---

# Investigative research

A working method for research whose conclusion has to survive a reader who
wants it to be wrong. It is distilled from the tradecraft of intelligence
analysis and the standards of archival description, and it exists because the
default behavior of a capable model under research pressure is specific and
bad: reach for whatever is nearest, cite what was never opened, quote a
summary as if it were the thing it summarizes, read silence as confirmation,
and stop looking the moment the first coherent story appears.

Every step below is mandatory when this skill is engaged. The gates are not
suggestions, and the deliverable is a draft until its verification record is
complete.

## 1. Scope — and when to stand down

Engage this method when the conclusion will carry weight: someone will decide,
spend, accuse, publish, or rely on it, and being wrong has a cost. Due
diligence, background investigation, competitive or market claims, incident
and timeline reconstruction, "verify this claim," "what does the record
actually say."

Stand down when it does not. A single-fact question with one authoritative
source gets a direct answer with one citation and none of this ceremony. A
brainstorm, a draft, an opinion, a task where the requester explicitly wants
speed over certainty — answer plainly and say, in one sentence, that the
investigative method was not applied. Applying the full apparatus to a task
that does not need it is a failure of this skill, not a safe default:
intervention has a cost, and a method that always interposes teaches the
reader to ignore it.

If it is genuinely unclear whether the stakes warrant the method, ask the
requester one question rather than guessing in either direction.

## 2. The citation discipline

Three markers, used exactly, on the same line as the claim they discharge:

- `[cite: <source>]` — the requester's own material: a document they provided,
  a dataset they named, an answer they gave. Their material always outranks
  what you found elsewhere.
- `[research: <what it is, and where a reader finds it>]` — public material
  you actually opened during this work. A title, publisher, and identifier a
  reader can follow. Never a bare domain name.
- `[unverified]` — the honest third answer, plus one sentence on what would
  settle the claim.

What counts as load-bearing and must carry a marker: every money amount,
percentage, date, duration, statute or regulation reference, proper-name
assertion, and any claim the conclusion would change without. When in doubt,
it is load-bearing.

Three rules with no exceptions:

1. **Never cite what you did not open.** A citation for a document you did not
   read, or a search you did not run, is fabrication wearing a citation's
   clothes. If you have no way to read public material in this environment,
   say so and mark the claim `[unverified]` — never describe research you
   could not have done.
2. **Never cite your own scaffolding.** Your notes, your reasoning, your
   tooling, this skill file, an internal keyword list — none of these are
   evidence about the world. The observed failure this rule exists for: a
   question of employment law answered by citing the tool's own configuration,
   which looked cited and was worse than uncited, because a citation is the
   unit of trust.
3. **Prose about citing is not citing.** A sentence attesting that "every
   claim is supported or marked" while the body carries no markers is
   self-attestation, and self-attestation is the exact failure a verification
   record exists to make visible. Only the markers are the practice.

## 3. Source classing

Name what kind of thing each source is, on first use. Four classes:

- **Record** — the thing itself: the filing, the statute, the contract, the
  commit, the registry entry, the transcript.
- **Derived record** — an official restatement: an index of filings, a
  government summary of a statute, a certified extract.
- **Aggregator** — someone's write-up: news coverage, an encyclopedia entry,
  a vendor blog, an analyst note, a forum answer.
- **Inference** — a conclusion you drew rather than a statement any source
  makes. Marked as an inference where it appears, every time.

Two classing rules that catch real fabrications:

- **The date-kind rule.** When a date, status, or name is asserted, state what
  kind it is in the source: when the thing happened, when it was registered,
  or when it was last checked. A date read as the wrong kind is a fabrication
  that passes every spelling check — an incorporation date presented as a
  founding date, a last-modified stamp presented as a publication date.
- **Silence is not confirmation.** What a source does not say is not evidence
  that the thing is absent, false, or fine. If the conclusion leans on a
  source's silence, say so explicitly and class the claim as an inference.

## 4. Independence and triangulation

Two sources that copy one another are one source. Before counting a claim as
corroborated:

- Trace the upstream. Wire-service copy, a shared database, a press release
  reprinted five times, one filing quoted by every article — each is a single
  source wearing several mastheads. Corroboration means a source that **could
  have disagreed**: different method, different custody, different incentive.
- Class the corroboration, not just the sources. Two records that agree are
  strong. A record and an aggregator that agree may mean only that the
  aggregator read the same record.
- Keep a running list of which conclusions rest on a single source. That list
  is not shameful; hiding it is. It goes in the deliverable under its own
  heading, with, for each entry, whether an independent source could exist and
  where one would look.

## 5. The disconfirmation pass

Confirmation collects easily; investigations fail on what nobody tried to
refute. Before any conclusion is called final:

1. **State at least two hypotheses that fit the evidence so far** — the
   conclusion you are leaning toward and its strongest rival. "The record is
   incomplete" and "the innocuous explanation" are often the rivals that
   matter.
2. **For each hypothesis, name the evidence that would refute it — then go
   look for that evidence specifically.** This is the step the method turns
   on. Searching for support one more time is not a disconfirmation pass.
3. **Weigh by least credible disconfirmation, not most confirmation.** The
   conclusion is the hypothesis with the weakest evidence against it, not the
   one with the most evidence for it — confirmation is cheap and refutation
   is not.
4. **On contested conclusions, show the table**: hypotheses as columns,
   load-bearing evidence as rows, each cell consistent / inconsistent /
   silent. A reader who disagrees with the verdict can then disagree with a
   cell instead of with you.

If the disconfirmation pass reversed or materially weakened the initial
conclusion, say so in the deliverable. That sentence is the method visibly
paying for itself, and hiding it wastes the work.

## 6. Coverage and absence

What a collection leaves out is a claim it makes without saying so.

- **State the frame in one sentence**: the population, geography, or period
  this work meant to cover, and what falls outside it on purpose.
- **Classify every notable absence** as one of three things: not-recorded
  (the world happened, the record did not), not-yet-collected (a record
  exists, this work did not reach it), or did-not-happen. These three are
  indistinguishable to a reader and must not be to you. An absence you cannot
  classify stays classified as unknown — never silently promoted to
  did-not-happen.
- **Check the implied coverage.** What does the surface of your deliverable
  imply to someone who reads it without reading the method? If the
  implication is broader than the collection, narrow the surface.
- **Ask whose record is systematically thinner.** A method that reaches
  institutions reaches what institutions kept. Name the skew where it exists.

## 7. Research conduct

- **Provided material first.** The requester's own material is the better
  evidence and is read before the open web. Research fills the gaps their
  material is silent on; it never overrides it.
- **Capability honesty.** If this environment gives you no way to read public
  material, you have no research capability on this task. Say so, mark the
  affected claims `[unverified]`, and deliver anyway. Never narrate a search
  you did not run.
- **Primary over aggregator, as a posture and a disclosure.** A summary of a
  rule is not the rule. Where a claim depends on what a statute, standard,
  agreement, specification, filing, or dataset actually says, the citation is
  that text. Aggregators are how you find the primary source; they are not
  evidence for what it says. If a summary is all you could reach, cite the
  summary and write, in the same sentence, that the primary text went unread.
- **One pass, then stop.** Research is a bounded step, not a mode. Each gap
  gets one disciplined pass; if the fact is still missing, stop and either ask
  the requester (when their answer would change the work) or state the
  assumption you proceed on, marked `[assumed]`. A gap is never a reason to
  withhold the deliverable.
- **Read before you call it unknown.** Every document you named and could
  reach is either read and citable, or its line says why it could not be
  read. "Ground exhausted" means exactly this: nothing reachable was left
  unopened.

## 8. Handbacks are earned

A question you could have settled from material you hold is work, not an open
question. "Confirm whether X" addressed to the reader, when you held what
settles X, is the deliverable failing — even if every claim in it is true and
cited, because the reader you hand it to holds less context than you do and
the same license. Before listing any open question, check: could I have
answered this from the provided material, from something reachable, or from
one more bounded research pass? If yes, answer it. Hand back only what
genuinely requires authority, access, or a decision you do not have.

## 9. The closing gates

Before anything is called final, each gate below is answered in the
deliverable itself. This is work shown, not work claimed:

1. **Claims cited** — every load-bearing claim carries `[cite: …]`,
   `[research: …]`, or `[unverified]` (§2).
2. **Source classes stated** — every source classed on first use; date-kinds
   stated where dates carry weight (§3).
3. **Independence stated** — the single-source list is present, and no claim
   is called corroborated on copies of one upstream (§4).
4. **Disconfirmation shown** — the rival hypotheses, what would have refuted
   each, and what was found; the table on contested calls (§5).
5. **Coverage frame stated** — the frame sentence and the classified absences
   (§6).
6. **Ground exhausted** — every named document read or its line says why not
   (§7).
7. **Strongest objection** — the strongest argument against the conclusion,
   stated in its own words under its own heading, not paraphrased into
   weakness.
8. **Pre-mortem** — on any recommendation: assume it was followed and failed;
   tell the most likely story of how, in a short labeled paragraph.
9. **Handbacks earned** — every open question is one you could not have
   settled (§8).

## 10. The verification record

The deliverable ends with a short block, exactly this shape:

```
Verification record
- Claims cited:        answered — see <where>
- Source classes:      answered — see <where>
- Independence:        answered — see <where>
- Disconfirmation:     answered — see <where> | reversed the draft conclusion: <yes/no>
- Coverage frame:      answered — see <where>
- Ground exhausted:    answered — see <where>
- Strongest objection: answered — see <where>
- Pre-mortem:          answered — see <where> | not applicable: no recommendation made
- Handbacks:           none | listed at <where>, each with why it could not be settled here
```

A gate that was not done says `not done — <reason>` in its slot. It is never
deleted, never skipped silently. Until every line is filled in, the
deliverable is labeled a draft, by you, in its title line.

The record is presence, not quality: a reader can check in seconds that each
gate was answered and where, and that is all it proves. Whether the strongest
objection is genuinely the strongest is judgment, and the record never claims
to have automated it.


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

## 11. What is enforced, and by what

Nothing in this file is machine-enforced by this file. The markers, the gates,
and the record are obligations on you, made checkable for the reader — that
visibility is the enforcement tier this skill carries everywhere it goes. An
environment that separately lints the markers or the record's presence adds a
deterministic tier on top; this file works identically with or without one,
and never claims a tier it is not running under.

## References

Method identified, not incorporated — these name where the discipline comes
from, and reading them is not required to follow it:

- Heuer, *Psychology of Intelligence Analysis*, CIA Center for the Study of
  Intelligence, 1999 — analysis of competing hypotheses; disconfirmation over
  confirmation.
- Heuer & Pherson, *Structured Analytic Techniques for Intelligence
  Analysis* — the worked catalog of the techniques §5 compresses.
- ICD 203, *Analytic Standards*, Office of the Director of National
  Intelligence — sourcing, uncertainty, and distinguishing assumptions from
  judgments as review standards.
- PROV-DM, W3C Recommendation, 2013 — the entity / activity / agent vocabulary
  behind §3's source classes.
- Records in Contexts (RiC-CM) 1.0, International Council on Archives — what a
  record is, as distinct from descriptions of one.
- Groves & Lyberg, *Total Survey Error*, Public Opinion Quarterly 74(5),
  2010 — coverage error as a named, separable thing (§6).
- Gebru et al., *Datasheets for Datasets*, CACM 2021 — stating a collection's
  frame and absences as an obligation of the collection.
