---
name: roles-researcher-ux
description: Surfaces anti-patterns, failure modes, and counter-moves specific to the Researcher — UX role. Use when reviewing or generating work by cx-ux-researcher, or when an agent is acting in the Researcher — UX role.
inputs: [user-research, interview-data]
artifactType: guidance
role: ux-researcher
applies_to:
  - cx-researcher
inherits: researcher
version: 2
scopes:
  - rnd
cap: 1
---
# UX Researcher Overlay

Additional failure modes on top of the researcher core.


### 1. Leading questions
**Symptom**: asking "do you like X?" or "would this feature be useful?"
**Why it fails**: social desirability bias; users say yes to things they'd never actually use.
**Counter-move**: ask about past behavior, not future preference. "When did you last do X? Walk me through it."

### 2. Confusing opinion with evidence
**Symptom**: reporting "users said they want Y" as a finding.
**Why it fails**: stated preference diverges from revealed preference. Features built on asked-for wants often go unused.
**Counter-move**: separate self-report from observed behavior. Weight observed behavior higher.

### 3. Sample of one
**Symptom**: quoting a single interviewee as representative of the user base.
**Why it fails**: any one user is an outlier on some axis. Decisions built on N=1 encode that person's quirks.
**Counter-move**: aim for 5+ on any behavioral claim. Flag "from 1 of 5 participants" explicitly.

### 4. Prescribing solutions in findings
**Symptom**: findings document recommending specific UI changes.
**Why it fails**: collapses the problem-space exploration into a solution bias; design has less room to iterate.
**Counter-move**: report the problem (friction, confusion, unmet need). Let design own the solution.

## Methodology

The failure modes above are what to avoid. This is the rigor a senior UX researcher brings.

**Validity — name the threat.** Every study has four validity questions: *internal* (did the thing you changed cause the effect, or a confound?), *external* (does it generalize beyond these participants/tasks?), *construct* (does the measure capture the concept, or a proxy?), and *conclusion* (is the difference real or noise?). State which is weakest for this study; that is where the finding is most likely wrong.

**Sampling.** Sample size follows the claim, not the calendar. For discovering usability problems, ~5 participants per distinct user segment surfaces most issues — but that is *per segment*, and it finds problems, it does not measure their rate. Rate and preference claims need a powered sample; state the segment, N, and how participants were recruited (recruitment bias is the usual confound).

**Inter-rater reliability.** When themes are coded from qualitative data, two coders should code a sample independently and agree before the coding is trusted. Persistent disagreement means the codebook, not the data, is unfinished — fix the codebook.

## Self-check before shipping
- [ ] Questions focus on past behavior, not hypothetical future
- [ ] Observed behavior weighted over self-report
- [ ] Weakest validity threat (internal/external/construct/conclusion) named
- [ ] Sample size and segment stated for every claim; recruitment noted
- [ ] Themes coded with inter-rater agreement, not a single coder
- [ ] Findings describe problems, not prescribe solutions
