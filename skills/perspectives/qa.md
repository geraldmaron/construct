---
name: perspectives-qa
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [test-suite, code-diff]
artifactType: guidance
perspective: qa
applies_to:
  - qa
inherits: null
version: 2
scopes:
  - rnd
cap: 1
---
# QA. Perspective guidance

Load this before drafting. These are the failure modes that separate strong Worker Profile output from weak Worker Profile output. check your draft against each.


### 1. Testing the mock
**Symptom**: the test asserts that the mock was called with the expected arguments. and that is all it asserts.
**Why it fails**: the test passes regardless of whether the real system would. Mocks drift from the real contract silently.
**Counter-move**: assert on observable outputs or state. Use mocks for isolation, not as the thing being tested.

### 2. Coverage as proxy for quality
**Symptom**: the bar is "80% line coverage" with no attention to whether the covered lines exercise meaningful behavior.
**Why it fails**: coverage rises by adding trivial assertions. Real bugs live in the uncovered branches and the edge cases.
**Counter-move**: pair line coverage with behavior coverage. For each requirement, name the test that would catch its regression.

### 3. Happy path only
**Symptom**: every test exercises the success path. Error handling, timeouts, partial failures, and malformed input are untested.
**Why it fails**: production spends most of its time off the happy path. Untested code paths fail in the worst way.
**Counter-move**: for every happy-path test, write at least one error-path test. Malformed input, dependency failure, timeout.

### 4. Flaky test denial
**Symptom**: intermittent failures are re-run until green and ignored.
**Why it fails**: the flake signals a real race condition, timing assumption, or environmental dependency that will eventually cause a production incident.
**Counter-move**: investigate every flake. Either fix the race or quarantine the test with a tracked ticket.

### 5. Tests that test the implementation
**Symptom**: the test breaks every time the implementation is refactored, even when behavior is unchanged.
**Why it fails**: discourages refactoring. Engineers delete or weaken tests to unblock themselves.
**Counter-move**: test through public interfaces. Assert on outcomes, not on internal call patterns.

### 6. Missing regression coverage for fixes
**Symptom**: a bug is fixed without a test that would have caught it.
**Why it fails**: the same bug regresses in six months and nobody remembers it was a bug.
**Counter-move**: every bug fix includes a test that fails against the broken code and passes against the fix.

### 7. Golden-path E2E only
**Symptom**: the E2E suite validates one long happy journey and nothing else.
**Why it fails**: the suite is slow, fragile, and still leaves most integration failure modes uncovered.
**Counter-move**: cover critical user flows with focused E2E tests. Cover component behavior at lower tiers.

### 8. Shipping without exercising the change
**Symptom**: tests pass but no one has actually used the feature as a user would.
**Why it fails**: the tests validate assumptions; the user discovers what the assumptions missed.
**Counter-move**: for any user-facing change, run the feature manually at least once before marking done.



## Artifact authorship contract

Load `skills/docs/artifact-authorship.md` before drafting typed artifacts as **qa**.

### Framing
Risk-based test strategy mapped to acceptance criteria.

### Template population
- Use the manifest template for the artifact type. Fill every required section or write `unknown` with owner and decision-by date.
- Prefer evidence callouts and explicit open questions over confident filler.

### Storytelling
- Lead with the decision the reader must make. Escalate certainty only with evidence. Keep unknowns visible.

### Adversarial review
Which AC cannot be tested as written?

### Anti-fabrication
No invented pass rates.

### Cross-persona handoffs
engineer for harness gaps; accessibility when UI AC exist.

### Self-check (authorship)
- [ ] Framing questions answered
- [ ] Template sections populated or explicitly unknown
- [ ] Triggered specialists consulted or queued with dates
- [ ] Strongest counter-argument named
- [ ] No unsourced load-bearing claims

## Self-check before shipping

- [ ] Tests assert on outcomes, not on mock call patterns
- [ ] Each requirement has a test that would catch its regression
- [ ] Error paths have at least one test each
- [ ] No intermittent failures accepted; investigated or quarantined
- [ ] Tests survive refactors that preserve behavior
- [ ] Every bug fix has a regression test
- [ ] E2E covers critical flows; component tests cover the rest
- [ ] User-facing changes exercised manually before sign-off
