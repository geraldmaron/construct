# Document shapes

Three literal skeletons. Drop unused sections visibly. No shape drops the
four-way separation, checkable acceptance, or non-goals.

**Full requirements document / PRD** (reader: builders, and a later checker)
```
<Title: the capability, plainly>
Status / Author - Contributors / Created - Last updated / Tags
Outcome: what is true when this is done - the one-paragraph version
Users: who this is for and who else is affected - experience, not internals
Context: only what a builder needs; history goes elsewhere
Decided: the standing decisions this builds on, attributed
Outcomes: numbered, observable
Success measures: observations or measurements; thresholds sourced or
  labeled chosen, by whom
Constraints: labeled, sourced
Assumptions: [assumed], each with what settles it
Non-goals: one line each, with reasons
Acceptance criteria: numbered, each a stranger-checkable observation
Priorities: critical path / now / next / later
Risks: concrete failure stories, or "deferred to adversarial review"
Open questions: earned only - who answers, what is blocked
```

**One-page brief** (reader: someone deciding whether to invest more time)
```
<Title>
Status / Author - Contributors / Created - Last updated / Tags
Outcome: two sentences
The three lists that matter most here: outcomes, constraints, non-goals
Acceptance: the three to five criteria that define done
Open: only what blocks starting
```

**Change-request addendum** (reader: someone holding the original artifact)
```
<Title: the change, plainly>
Status / Author - Contributors / Created - Last updated / Tags
What changes: outcome/constraint/criterion, quoted before and after
Why: the event or evidence that forced it
What it invalidates: which existing criteria, assumptions, priorities move
Not changing: adjacent things a reader might assume moved, and did not
```
