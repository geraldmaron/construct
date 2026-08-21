---
name: adversarial-review
description: A finished deliverable or decision is challenged before anyone
  commits to it - by a reviewer whose job is to break it, not improve it.
  Mandatory challenge set - strongest failure mode with concrete inputs,
  best alternative not chosen, load-bearing-claims audit, assumption
  inversion, who-bears-the-cost check - closing in exactly one of four
  verdicts - accepted, accepted with controls, needs validation, or
  rejected. Use before committing to a load-bearing artifact - an
  architecture or data
  design, a security or access boundary, a vendor or dependency choice, a
  migration or irreversible change, a spec about to be built, a public
  factual claim, a decision record about to be executed. Not for drafts
  still in motion (challenge them when they stabilize), not for low-stakes
  reversible work, and not for code review of a diff - it reviews the
  thinking an artifact rests on, not its line-by-line construction.
license: Apache-2.0
metadata:
  version: 0.1.0
  source: geraldmaron/construct
---

# Adversarial review

A working method for the last look before commitment. It exists because
review under social default is agreement-shaped: a capable model handed a
finished artifact finds three minor suggestions, praises the structure, and
approves - because finding the artifact sound feels like cooperation and
finding it broken feels like conflict. The failure this produces is
well-documented and expensive: the flaw that was visible in five minutes to
anyone actually trying to break the thing, found instead by production, by
the counterparty's lawyer, or by the hostile reader the artifact was never
tested against.

The reviewer this skill installs has one job: **break it**. Improvement is a
different activity, done by different rules, after the verdict. Every
challenge below is mandatory when this skill is engaged; the review is a
draft until its verification record is complete.

## 1. Scope - and when to stand down

Engage this method when someone is about to commit to a finished artifact
and being wrong is expensive: an architecture, data model, or security
boundary; a vendor, dependency, or build-vs-buy choice; a migration or any
hard-to-reverse change; a spec a team is about to build; a public factual
claim; a decision record about to be executed; a strategy about to be
funded.

Stand down when the artifact is still moving - challenging a half-draft
wastes the challenge and teaches the author to stabilize later, not
earlier. Stand down on low-stakes reversible work: the challenge costs more
than being wrong does. And this skill does not do code review: a diff's
bugs, style, and test coverage are a different discipline with different
tools. What this skill reviews in a code-shaped artifact is the thinking -
the design's failure modes, the alternative not taken, the claims the
approach rests on.

Reviewing your own work: the method still runs, and it works better than no
challenge, but say so in the record - a reviewer who shares the author's
context shares the author's blind spots, and the reader deserves to know
which kind of review this was.

## 2. The posture

Three rules that make the review adversarial in fact rather than in name:

- **Break, don't improve.** Suggestions, polish, and "consider also" belong
  to a later conversation. Every finding in this review is a way the
  artifact fails, not a way it could be better. If the review drifts into
  improving, it has stopped challenging.
- **Attack the strongest version.** Read the artifact as its best advocate
  would - fill gaps charitably, take its reasoning at full strength - and
  then break *that*. Breaking a weak reading proves nothing and insults the
  author; a verdict is only worth having against the steelman.
- **A clean pass is a valid outcome.** The job is to try to break it, not
  to succeed. A review that finds nothing real says so plainly - "challenged
  on all six, nothing broke" - and does not pad itself with trivia to look
  rigorous. Padding is how review inflation starts and how real findings
  learn to hide in noise.

## 3. The challenge set

Six challenges, each run and each answered in the review. "Run" means
attempted in earnest, with the result shown - not a heading with a
paragraph of reassurance under it.

1. **Strongest failure mode.** The most likely way this artifact, adopted
   as-is, produces a bad outcome - told as a concrete story: these inputs,
   this state, this sequence, this wrong result. An abstract risk ("scaling
   could be an issue") is not a failure mode until it names the load, the
   component, and the breakage.
2. **Best alternative not chosen.** The strongest option the artifact
   rejected or never considered, argued the way its advocate would argue
   it. Then: do the artifact's reasons for rejecting it actually hold? If
   the artifact never named alternatives, that is itself a finding.
3. **Load-bearing-claims audit.** List every claim the conclusion needs -
   numbers, dates, capabilities, "X supports Y", "the team can Z". For
   each: checked against what, or marked unsupported. A conclusion resting
   on an unsupported claim is not yet a conclusion, and the audit says
   which ones.
4. **Assumption inversion.** Each stated assumption (and each unstated one
   the audit surfaces) flipped: assume it is false - what breaks, and how
   would anyone find out in time? An assumption whose failure is silent and
   expensive is a finding even when the assumption is probably true.
5. **Who bears the cost.** If this is wrong, who pays - and is it the same
   party who decided? Costs landing on people absent from the artifact
   (users, a downstream team, a future maintainer, the public) are called
   out, because nobody in the room had the incentive to find those
   failures.
6. **The five-minute hostile expert.** What would a domain expert who wants
   this to be wrong notice first? Run that check literally: the obvious
   prior art not cited, the number that fails a sanity check, the missing
   case everyone in the field asks about. This challenge exists because
   artifacts are most often broken by their most checkable claim, not
   their subtlest one.

## 4. Findings and severity

Findings are ranked by consequence, worst first, each in this shape:

```
<n>. <one-line finding> [severity: fatal | serious | minor]
   Failure: <the concrete bad outcome if unaddressed>
   Evidence: <what in the artifact, or missing from it, establishes this>
   Smallest fix: <the least change that retires the finding - stated, not designed>
```

Severity honesty: **fatal** means the verdict cannot be accepted while this
stands; **serious** means accepted-with-controls at best; **minor** is
recorded and does not move the verdict. A review whose findings are all
minor supports a clean accept and says so. Never promote a minor finding to
look thorough; never demote a fatal one to be kind.

## 5. The verdict

Exactly one, first line of the review's output:

- **Accepted** - challenged on all six, nothing broke that matters.
- **Accepted with controls** - sound if the named controls are adopted;
  each control is specific enough to check later.
- **Needs validation** - a load-bearing claim or assumption must be tested
  before commitment; the review names what is validated, how, and by whom.
- **Rejected** - a fatal finding stands; the review names the smallest
  change that would reopen the question.

The verdict is addressed to whoever commits, and it is the reviewer's own -
hedged verdicts ("mostly accepted") are the agreement-shaped default
sneaking back in. If the artifact under review carries its own record (a
decision record, a verification record), the review checks it rather than
repeating it: gates the artifact claims to have run are spot-checked, and a
claimed-but-not-run gate is automatically a serious finding.

## 6. The closing gates

Before the review is called final - work shown, not work claimed:

1. **Steelman stated** - the artifact's strongest reading, in two or three
   sentences, before any finding (§2).
2. **All six run** - each challenge attempted in earnest with its result
   shown; none reduced to a reassuring paragraph (§3).
3. **Findings concrete** - every finding carries its failure story,
   evidence, and smallest fix; severities honest (§4).
4. **One verdict** - exactly one of the four, first line, unhedged (§5).
5. **Self-review disclosed** - if reviewer and author share context, the
   record says so (§1).
6. **No improvement drift** - the review contains breakage only;
   suggestions saved for after the verdict (§2).

## 7. The verification record

The review ends with a short block, exactly this shape:

```
Verification record
- Steelman stated:    answered — see <where>
- All six run:        answered — <clean: <which> | findings from: <which>>
- Findings concrete:  answered — <n> findings: <n> fatal, <n> serious, <n> minor | none
- One verdict:        answered — <accepted | accepted with controls | needs validation | rejected>
- Self-review:        answered — <independent | shared-context, disclosed>
- No improvement drift: answered — breakage only
```

A gate that was not done says `not done - <reason>` in its slot. It is
never deleted, never skipped silently.

The record is presence, not quality: whether the strongest failure mode is
genuinely the strongest is judgment, and the record never claims to have
automated it.

## 8. What is enforced, and by what

Nothing in this file is machine-enforced by this file. The posture, the
challenge set, and the record are obligations on you, made checkable for
the reader - that visibility is the enforcement tier this skill carries
everywhere it goes. An environment that separately checks the record's
presence adds a deterministic tier on top; this file works identically with
or without one, and never claims a tier it is not running under.

## References

Method identified, not incorporated - these name where the discipline comes
from, and reading them is not required to follow it:

- Heuer, *Psychology of Intelligence Analysis*, 1999 - devil's advocacy and
  competing hypotheses as institutional correctives to confirmation.
- Kahneman & Klein, "Conditions for Intuitive Expertise: A Failure to
  Disagree," American Psychologist, 2009 - when confident judgment deserves
  challenge rather than trust.
- Klein, "Performing a Project Premortem," Harvard Business Review, 2007 -
  prospective hindsight as a challenge technique (§3.4's relative).
- ICD 203, *Analytic Standards*, ODNI - review standards that separate
  sourcing, assumptions, and judgments so each can be attacked on its own
  terms.
- Red-team practice as described in *Red Team: How to Succeed by Thinking
  Like the Enemy* (Zenko, 2015) - the institutional case for a reviewer
  whose only job is to break the plan.
