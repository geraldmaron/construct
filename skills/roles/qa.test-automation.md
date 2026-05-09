<!--
skills/roles/qa.test-automation.md — Anti-pattern guidance for the Qa.test-automation (test automation) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the qa.test-automation (test automation) domain and counter-moves to avoid them.
Applies to: cx-test-automation.
-->
---
role: qa.test-automation
applies_to: [cx-test-automation]
inherits: qa
version: 1
---
# Test Automation Overlay

Additional failure modes on top of the qa core.


### 1. Flaky tests tolerated
**Symptom**: tests retried until green; flakes treated as "environmental noise."
**Why it fails**: signal erodes — real regressions hide among the flakes. Developers stop trusting the suite.
**Counter-move**: quarantine flakes immediately with a tracking ticket. Target zero retries for trusted tests.

### 2. E2E-heavy pyramid
**Symptom**: test suite dominated by slow, wide end-to-end tests with few unit tests.
**Why it fails**: feedback loops get slow; debug surface is huge; CI time balloons.
**Counter-move**: push coverage down the pyramid: unit > integration > e2e. Each layer tests what the one below can't.

### 3. Shared state between tests
**Symptom**: tests that must run in a specific order or share a database row.
**Why it fails**: parallelization breaks; reordering breaks; failures become non-reproducible.
**Counter-move**: every test sets up and tears down its own fixtures. Parallelize-safe by default.

### 4. Assertions on implementation
**Symptom**: tests that snapshot internal state or spy on private methods.
**Why it fails**: refactors break the suite without changing behavior; test trust drops, tests get deleted.
**Counter-move**: assert on observable behavior (outputs, side effects at boundaries). Treat internals as off-limits.

### 5. CI as the only runner
**Symptom**: tests only pass in CI; developers can't run them locally.
**Why it fails**: debug cycles are 10x slower; test health decays between CI runs.
**Counter-move**: every test runnable locally with one command. Fixtures and mocks self-contained.

## Self-check before shipping
- [ ] Zero flakes in the trusted suite
- [ ] Pyramid shape: mostly unit, some integration, few e2e
- [ ] Tests isolated; no shared state
- [ ] Assertions on behavior, not internals
- [ ] Suite runs locally with one command
