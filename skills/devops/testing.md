<!--
skills/devops/testing.md — Testing Strategy — Use this skill when planning test coverage, selecting test types, or establishin

Use this skill when planning test coverage, selecting test types, or establishing testing practices. ## Test Pyramid
-->
# Testing Strategy

Use this skill when planning test coverage, selecting test types, or establishing testing practices.

## Test Pyramid

### Unit Tests (70%)
- Test individual functions, methods, and classes in isolation
- Fast: entire suite runs in seconds
- Mock external dependencies (database, network, file system)
- One assertion per test when practical
- Name tests for the behavior they verify

### Integration Tests (20%)
- Test interactions between components
- Use real databases (Docker containers) when practical
- Test API endpoints end-to-end within the service
- Verify serialization, query behavior, and error propagation
- Slower than unit tests; run in CI, not necessarily on every save

### End-to-End Tests (10%)
- Test critical user flows through the full system
- Use browser automation (Playwright, Cypress) for web
- Cover the happy path and the most important error paths
- Flaky by nature; invest in deterministic waits and stable selectors
- Run in CI; gate deployment on these passing

## Test Structure (AAA)

```
Arrange: set up preconditions and inputs
Act: execute the behavior under test
Assert: verify the expected outcome
```

- One act per test
- Minimize arrangement; use factories or fixtures
- Assertions should be specific and descriptive

## Coverage Targets

| Category | Minimum | Target |
|---|---|---|
| Overall | 80% | 90% |
| Critical paths | 95% | 100% |
| Utility functions | 90% | 95% |
| Error handling | 80% | 90% |

- Measure branch coverage, not just line coverage
- Coverage is a floor, not a ceiling; high coverage does not guarantee quality
- Uncovered code should have documented justification

## Test Naming

Use descriptive names that explain the scenario:
- `returns empty array when no results match`
- `throws validation error when email is missing`
- `retries three times before failing`

Avoid: `test1`, `testCreate`, `it works`

## Mocking Guidelines

- Mock external dependencies, not internal implementation
- Prefer fakes (in-memory database) over mocks when practical
- Verify mock interactions only when the interaction itself is the behavior
- Reset mocks between tests to prevent state leakage
- Avoid mocking what you do not own; use integration tests instead

## Test Data

- Use factories or builders for test data creation
- Randomize non-essential fields to catch hidden dependencies
- Use realistic data shapes and sizes
- Clean up test data after each test or use transactions with rollback
- Never use production data in tests

## Flaky Test Management

- Quarantine flaky tests immediately; do not let them erode CI trust
- Fix or delete within one sprint
- Common causes: timing, shared state, external dependencies, race conditions
- Use retry as a diagnostic tool, not a fix

## Performance Testing

- Load test: expected traffic for baseline
- Stress test: beyond expected traffic to find breaking point
- Soak test: sustained load to find memory leaks and resource exhaustion
- Benchmark critical paths with repeatable measurements
- Automate performance regression detection in CI

## Security Testing

- SAST: static analysis in CI on every commit
- DAST: dynamic scanning against staging environment
- Dependency scanning: `audit` commands in CI
- Penetration testing: quarterly or after major changes
- See `skills/security/pentest.md` for detailed web testing guidance
