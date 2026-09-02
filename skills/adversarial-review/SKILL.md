---
name: adversarial-review
description: >-
  Challenges a finished deliverable, plan, or decision before anyone
  commits: the strongest case against it, the failure it hides, the
  assumption doing the work. Use when the person says things like: poke
  holes in this; tell me why this will fail; argue the other side; be the
  skeptic; what's wrong with this plan; we're too excited about this; find
  the weak point before we commit. Not for building or fixing the thing
  itself, and not a substitute for the review a licensed professional must
  give.
license: Apache-2.0
metadata:
  version: 0.3.0
  source: geraldmaron/construct
---

# Adversarial review

A working method for the last look before commitment. Review under social
default is agreement-shaped: a capable model finds minor suggestions,
praises structure, and approves. The reviewer this skill installs has one
job: **break it**. Improvement is a different activity, after the verdict.
Every challenge below is mandatory when this skill is engaged.

## 1. Scope - and when to stand down

Engage when someone is about to commit to a finished artifact and being
wrong is expensive: architecture, data model, or security boundary; vendor,
dependency, or build-vs-buy; migration or hard-to-reverse change; a spec
about to be built; a public factual claim; a decision record about to be
executed; a strategy about to be funded.

Stand down when the artifact is still moving - challenging a half-draft
wastes the challenge. Stand down on low-stakes reversible work. This skill
does not do code review of a diff; what it reviews in a code-shaped
artifact is the thinking - failure modes, alternatives not taken, claims
the approach rests on. Applying nothing is a designed outcome.

Self-review: the method still runs, but say so in the record - a reviewer
who shares the author's context shares the author's blind spots.

## 2. The posture

- **Break, don't improve.** Findings are ways the artifact fails, not ways
  it could be better. If the review drifts into improving, it has stopped
  challenging.
- **Attack the strongest version.** Read as its best advocate would, then
  break *that*. Breaking a weak reading proves nothing.
- **A clean pass is valid.** "Challenged on all six, nothing broke" is
  honest. Padding with trivia is how real findings hide in noise.

## 3. The challenge set

Six challenges, each run and answered - attempted in earnest, result shown:

1. **Strongest failure mode.** The most likely bad outcome if adopted as-is
   - concrete story: these inputs, this state, this sequence, this wrong
   result. Abstract risk is not a failure mode until it names load,
   component, and breakage.
2. **Best alternative not chosen.** The strongest option rejected or never
   considered, argued as its advocate would. Do the artifact's rejection
   reasons hold? Never naming alternatives is itself a finding.
3. **Load-bearing-claims audit.** Every claim the conclusion needs -
   numbers, dates, capabilities. For each: checked against what, or
   unsupported.
4. **Assumption inversion.** Flip each assumption (stated and unstated):
   if false, what breaks, and how would anyone find out in time?
5. **Who bears the cost.** If wrong, who pays - and is it the same party
   who decided? Costs on absent parties are called out.
6. **The five-minute hostile expert.** What would a domain expert who wants
   this wrong notice first? Prior art, sanity-check numbers, missing cases.

## 4. Findings and severity

```
<n>. <one-line finding> [severity: fatal | serious | minor]
   Failure: <concrete bad outcome if unaddressed>
   Evidence: <what in the artifact, or missing, establishes this>
   Smallest fix: <least change that retires the finding - stated, not designed>
```

**fatal** blocks accept; **serious** means accepted-with-controls at best;
**minor** does not move the verdict. Never promote minors to look thorough;
never demote fatals to be kind.

## 5. The verdict

Exactly one, first line, as `VERDICT:`:

- **Accepted** - all six challenged, nothing that matters broke.
- **Accepted with controls** - sound if named, checkable controls are adopted.
- **Needs validation** - a load-bearing claim must be tested first; name
  what, how, and by whom.
- **Rejected** - a fatal finding stands; name the smallest change that
  reopens the question.

No hedged verdicts. If the artifact carries its own record, spot-check
claimed gates; claimed-but-not-run is a serious finding.

## 6. Closing gates

1. Steelman stated (two or three sentences) before findings.
2. All six run with results shown.
3. Findings concrete - failure, evidence, smallest fix; severities honest.
4. One verdict - exactly one of four, first line, unhedged.
5. Self-review disclosed when shared context.
6. No improvement drift - breakage only.

## Closing record

When finalizing, use the template in
[references/verification-record.md](references/verification-record.md).
Method sources: [references/sources.md](references/sources.md).
