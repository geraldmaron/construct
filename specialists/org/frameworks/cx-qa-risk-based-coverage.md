---
id: qa-risk-based-coverage
version: 1
appliesToRole: qa
summary: >-
  Walks a test plan from acceptance criteria through risk-based test
  selection to a coverage-gap register that names what could still slip
  through untested.
steps:
  - id: criteria-to-failure
    move: Ask how each criterion fails
    question: For each acceptance criterion, what test actually fails when the criterion is violated?
    emits: criterion-failure-map
    cites: source
  - id: risk-based-selection
    move: Select tests by risk, not by convenience
    question: Given the blast radius and effort class of the change, which behaviors carry the most risk if untested?
    emits: risk-based-selection
    cites: prior-step
  - id: verdict
    move: Run the selected tests and record the verdict
    question: Did the selected tests pass, and does coverage meet the project threshold?
    emits: verdict
    cites: source
  - id: coverage-gaps
    move: Name what is still untested
    question: Which behaviors have no test, and why were they left out?
    emits: coverage-gaps
    cites: prior-step
---

Run these four moves whenever an implementation reaches QA. Each move
produces one labeled output; the framework exists to prevent tests that
prove intent without proving the behavior actually breaks when it should.

**criteria-to-failure.** For every acceptance criterion in the incoming
implementation or PRD, name the specific test that would fail if the
criterion were violated. `criterion-failure-map` cites the acceptance
criteria and the test name/assertion that covers it — a criterion with no
corresponding failing test is not yet covered, regardless of what the
overall suite reports.

**risk-based-selection.** Using the engineer's effort class and blast radius
(when supplied), prioritize test effort toward the behaviors most likely to
break in integration, not toward the easiest tests to write.
`risk-based-selection` cites the criterion-failure map (`prior-step`): the
selection is derived from where failure is most likely and most costly, not
from convention or convenience.

**verdict.** Execute the selected tests and record PASS or FAIL, plus
coverage against the project threshold. `verdict` cites the test name and
run log line (or the coverage report) that produced the result — never an
estimated or assumed outcome. If the report isn't available, the verdict is
`unknown`.

**coverage-gaps.** Name every behavior that has no test yet, and state why
it was left out (out of scope, deferred, no reproducible case yet).
`coverage-gaps` cites the risk-based selection (`prior-step`): a gap is a
behavior that risk-based-selection identified as worth testing but that
did not make it into this pass, or a behavior the selection process missed
entirely and is now being surfaced.

Good output: a criterion-failure map where every criterion names a specific
failing test, a risk-based selection that explains why the riskiest
behaviors were tested first, a verdict citing an actual run or report, and a
coverage-gaps list that names specific untested behaviors with a reason.
Bad output: a test suite that mocks the behavior under test into
meaninglessness, a verdict asserted without a citation, or "coverage looks
good" with no gaps named.
