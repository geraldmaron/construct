---
name: decision-framing
description: Disciplined framing for decisions that will be expensive to
  revisit - one recommendation backed by honestly generated options, a
  stated do-nothing baseline, a reversibility class, the strongest objection
  in its own words, a pre-mortem, and a decision record a later reader can
  audit without the conversation that produced it. Use when someone must
  choose between real alternatives and being wrong has a cost - architecture
  and vendor choices, build-vs-buy, sequencing and investment calls,
  organizational or strategic direction, any "which way should we go"
  question whose answer someone will act on. Not for decisions already made
  (help execute instead), choices with one viable option (say so and
  proceed), or reversible low-stakes picks where deciding fast beats
  deciding well - answer those directly and skip this method entirely.
license: Apache-2.0
metadata:
  version: 0.2.0
  source: geraldmaron/construct
---

# Decision framing

A working method for decisions whose record has to survive two readers: the
one deciding now, and the one who arrives a year later, finds the
consequences, and asks what we were thinking. It exists because the default
behavior of a capable model handed a decision is specific and bad: collapse
to the first coherent option, present a menu of three where every option is
described in the language of its advocates, bury the recommendation under
balance, treat "do nothing" as unthinkable rather than as the incumbent, and
record none of it - so the next reader inherits the choice without the
reasoning and must either trust it blindly or relitigate it from nothing.

Every step below is mandatory when this skill is engaged. The deliverable is
a draft until its decision record and verification record are complete.

## 1. Scope - and when to stand down

Engage this method when a real choice exists between alternatives and the
choice will carry weight: someone will build, buy, commit, reorganize, or
forgo something because of it, and reversing it later has a cost.

Stand down when it does not, and say so in one sentence. A decision already
made gets execution help, not relitigation - reopening a settled decision is
itself a decision, and needs new evidence, not this ceremony. A question with
one viable option gets that answer and a sentence on why the alternatives are
not viable. A cheap, reversible pick - where trying beats analyzing - gets a
fast answer and permission to just try it. Applying the full apparatus to a
two-way door is a failure of this skill, not a safe default: the method's
cost is real, and a method that always interposes teaches the reader to
ignore it.

If it is genuinely unclear whether the stakes warrant the method, ask the
requester one question rather than guessing in either direction.

## 2. Frame before options

Options generated before the decision is framed inherit the framer's first
guess. Four things are written down before any option is listed:

- **The decision, in one sentence, as a choice.** "Choose how X will Y" -
  not a topic ("our database situation") and not a smuggled conclusion
  ("decide how to migrate to Z", which has already decided). If the sentence
  cannot be written as a choice between outcomes, the real decision has not
  been found yet; keep asking "and that is in service of what?" until it has.
- **Who decides, and who is consulted.** The recommendation below is
  addressed to the decider. A decision with no identifiable decider is not a
  decision; it is a discussion, and this method stands down.
- **The reversibility class**, one of three, stated with its reasoning:
  - *Reversible* - undoing costs about what doing cost. Bias to deciding
    fast; this method is usually stood down here.
  - *Costly to reverse* - undoable, but at real expense of money, time, or
    trust.
  - *One-way* - practically irreversible: the data is deleted, the
    announcement is public, the contract is signed, the trust is spent.
  The class sets the evidence bar. Misclassifying one-way as reversible is
  the expensive direction; when unsure, class upward and say the
  classification is uncertain.
- **The do-nothing baseline, as a real option.** What happens if nothing is
  decided: costs accrued, options that expire, risks that grow or shrink.
  Do-nothing is the incumbent and wins by default whenever deciding stalls,
  so it is evaluated with the same honesty as every other option - including
  the cases where it is genuinely the best one.

Constraints are separated from preferences, in two labeled lists. A
constraint is falsifiable ("must run on the existing cluster", "must close
before the contract renews") and disqualifies options. A preference is a
weight, not a wall. The observed failure this rule exists for: a preference
stated with a constraint's grammar quietly deletes the best option before
anyone sees it.

## 3. Options honestly generated

- **Two to five real options**, each described in one paragraph that its own
  advocate would sign - the description of an option is not the place to
  argue against it.
- **At least one option the framer does not favor**, developed to the same
  depth as the others. If every listed option points the same way, the list
  is a conclusion wearing a menu's clothes. The rival that matters is often
  do-nothing (§2) or "the boring incumbent tool, used harder."
- **Named, not numbered.** An option called "Option B" is forgettable and
  unauditable; an option called "buy the managed service" can be argued with.
- **Disqualified options stay visible.** An option removed by a constraint
  is listed with the constraint that removed it, in one line. The later
  reader who asks "did they even consider X?" finds the answer in the
  record, not in someone's memory.

## 4. Trade-off discipline

- **Consequences per option, against the criteria that matter.** Three to
  six criteria, drawn from the frame: the outcomes at stake, the constraints'
  margins, cost, time, risk, reversibility. Each option's consequences are
  stated concretely enough to be wrong - "adds a second operational surface
  the team must staff" - never as adjectives ("cleaner", "more scalable")
  that no evidence could contradict.
- **Facts, inferences, and preferences stay visibly distinct.** A
  load-bearing factual claim - a price, a limit, a date, a measured number,
  what a document says - is cited to something a reader can check or marked
  `[unverified]`, with one sentence on what would settle it. An inference is
  stated as one. Where an evidence question is big enough to need real
  research, that is a different discipline; if an investigative-research
  skill is present it governs that work, and if not, the unresolved claims
  stay marked rather than quietly hardening into facts. Assumptions the
  decision leans on are marked `[assumed]`.
- **No invented thresholds.** A number used as a decision rule ("under 100ms
  is acceptable") either has a source and a reason or is labeled as a chosen
  line, chosen by whom. A threshold invented mid-analysis and then treated
  as an external standard is fabricated authority - the trade-off equivalent
  of citing a document never opened.
- **On contested comparisons, show the table**: options as columns, criteria
  as rows, consequences in the cells. A reader who disagrees can then
  disagree with a cell instead of with the conclusion. When the comparison
  is not contested, prose is enough; a table where no cell would change any
  reader's mind is furniture.

## 5. One recommendation, then its strongest enemy

- **Exactly one recommendation, stated first in its section**, in one
  sentence, addressed to the decider. Not a menu, not "it depends" - the
  conditions it depends on were the frame's job. If two options are
  genuinely indistinguishable on everything that matters, say exactly that,
  recommend the cheaper-to-reverse one, and say that is the tiebreak.
- **The strongest objection, in its own words, under its own heading.** The
  best argument against the recommendation, stated the way its most capable
  advocate would state it - not paraphrased into weakness, not a strawman
  gratefully knocked down. If the strongest objection is hard to write, that
  is usually the analysis being thin, not the recommendation being safe.
- **What would change the answer.** One or two concrete observations that,
  if made, should reopen this decision - a price crossing a line, a measured
  result, a dependency shipping or dying. These become the record's
  revisit-when triggers.
- **The verdict, in the record, is one of four**: accepted, accepted with
  controls (the controls named), needs validation (the validation named,
  with who runs it), or rejected. A recommendation the decider has not yet
  seen is recorded as proposed, not accepted - the record never claims a
  decision that has not happened.

## 6. The pre-mortem

Assume the recommendation was followed and it failed. Write the most likely
story of how, in a short labeled paragraph - specific enough that someone
could watch for it, not "risks materialized." Then state what early signal
would reveal that story unfolding, and whether anything cheap now would make
the failure survivable. A pre-mortem that could be appended to any decision
unchanged has not been performed, only formatted.

If writing the pre-mortem materially weakened the recommendation, say so and
revisit §5 before finalizing. That sentence is the method visibly paying for
itself, and hiding it wastes the work.

## 7. The decision record

The deliverable's core is a record in exactly this shape, so that records
from different decisions can be read the same way years apart:

```
Decision record
- Decision:          <the one-sentence choice, from §2>
- Decider:           <who> | Consulted: <who>
- Reversibility:     reversible | costly to reverse | one-way — <why>
- Do-nothing:        <what happens if no decision is made>
- Options considered:
    <name> — <one-line essence> — <disposition: recommended / viable / disqualified by <constraint>>
    ...
- Recommendation:    <the one sentence, addressed to the decider>
- VERDICT:           proposed | accepted | accepted with controls: <which> | needs validation: <what, by whom> | rejected
                     (capitals on purpose: the one line a skimming reader must catch)
- Consequences accepted: <what the chosen path costs, stated plainly>
- Strongest objection: <one line; full text under its heading above>
- Revisit when:      <the concrete triggers from §5>
```

Every line is filled or carries `not established - <why>`. The record is a
summary of work shown above it, never a substitute: a record whose lines
point at nothing are assertions, and assertions are what this method exists
to replace.

## 8. The closing gates

Before the deliverable is called final, each gate is answered in the
document itself - work shown, not work claimed:

1. **Framed as a choice** - the one-sentence decision, decider,
   reversibility class with reasoning, and do-nothing baseline are present
   (§2).
2. **Constraints separated** - constraints and preferences in labeled lists,
   every disqualification tied to a constraint (§2, §3).
3. **Rivals real** - at least one developed option the framer does not
   favor; disqualified options visible with their reasons (§3).
4. **Consequences concrete** - trade-offs stated as checkable consequences;
   load-bearing facts cited or `[unverified]`; assumptions `[assumed]`; no
   invented thresholds (§4).
5. **One recommendation** - exactly one, first, addressed to the decider,
   with a verdict from the four (§5).
6. **Strongest objection** - in its own words, under its own heading, not
   paraphrased into weakness (§5).
7. **Pre-mortem** - the specific failure story, its early signal, and
   whether it weakened the recommendation (§6).
8. **Record complete** - every line of the decision record filled or
   explicitly `not established` (§7).

## 9. The verification record

The deliverable ends with a short block, exactly this shape:

```
Verification record
- Framed as a choice:   answered — see <where>
- Constraints separated: answered — see <where>
- Rivals real:          answered — see <where>
- Consequences concrete: answered — see <where>
- One recommendation:   answered — see <where>
- Strongest objection:  answered — see <where>
- Pre-mortem:           answered — see <where> | weakened the recommendation: <yes/no>
- Record complete:      answered — see <where>
```

A gate that was not done says `not done - <reason>` in its slot. It is never
deleted, never skipped silently. Until every line is filled in, the
deliverable is labeled a draft, by you, in its title line.

The record is presence, not quality: a reader can check in seconds that each
gate was answered and where, and that is all it proves. Whether the strongest
objection is genuinely the strongest, and the pre-mortem genuinely the most
likely failure, is judgment the record never claims to have automated.


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

Nothing in this file is machine-enforced by this file. The frame, the gates,
and both records are obligations on you, made checkable for the reader -
that visibility is the enforcement tier this skill carries everywhere it
goes. An environment that separately checks the records' presence adds a
deterministic tier on top; this file works identically with or without one,
and never claims a tier it is not running under.

## References

Method identified, not incorporated - these name where the discipline comes
from, and reading them is not required to follow it:

- Klein, "Performing a Project Premortem," Harvard Business Review,
  September 2007 - the pre-mortem as prospective hindsight (§6).
- Nygard, "Documenting Architecture Decisions," 2011 - the decision record
  as context, decision, and consequences a later reader can audit (§7).
- Bezos, Amazon shareholder letter, 1997 (restated 2015) - Type 1 and
  Type 2 decisions; reversibility as the variable that sets process weight
  (§2).
- Spetzler, Winter & Meyer, *Decision Quality*, Wiley 2016 - the frame,
  alternatives, and clear values as separable elements of a good decision.
- Heuer, *Psychology of Intelligence Analysis*, CIA Center for the Study of
  Intelligence, 1999 - developing rival hypotheses to equal depth rather
  than confirming the first (§3).
