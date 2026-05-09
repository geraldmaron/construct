<!--
rules/common/testing.md — test coverage requirements and TDD workflow.

Defines minimum 80% coverage, TDD red-green-refactor cycle,
AAA test structure, and descriptive naming conventions.
-->
# Testing Requirements

## Minimum Test Coverage: 80%

Test Types (ALL required):
1. **Unit Tests** - Individual functions, utilities, components
2. **Integration Tests** - API endpoints, database operations
3. **E2E Tests** - Critical user flows (framework chosen per language)

## Test-Driven Development

MANDATORY workflow:
1. Write test first (RED)
2. Run test - it should FAIL
3. Write minimal implementation (GREEN)
4. Run test - it should PASS
5. Refactor (IMPROVE)
6. Verify coverage (80%+)

## Troubleshooting Test Failures

1. Check test isolation
2. Verify mocks are correct
3. Fix implementation, not tests (unless tests are wrong)

## Test Structure (AAA Pattern)

Prefer Arrange-Act-Assert:

```
// Arrange - set up test data
// Act - call the function under test
// Assert - verify the result
```

### Test Naming

Use descriptive names that explain the behavior under test:

```
returns empty array when no items match query
throws error when required config is missing
falls back to default when service is unavailable
```
