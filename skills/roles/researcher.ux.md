<!--
skills/roles/researcher.ux.md — Anti-pattern guidance for the Researcher.ux (ux) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the researcher.ux (ux) domain and counter-moves to avoid them.
Applies to: cx-ux-researcher.
-->
---
role: researcher.ux
applies_to: [cx-ux-researcher]
inherits: researcher
version: 1
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

## Self-check before shipping
- [ ] Questions focus on past behavior, not hypothetical future
- [ ] Observed behavior weighted over self-report
- [ ] Sample size stated for every claim
- [ ] Findings describe problems, not prescribe solutions
