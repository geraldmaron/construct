<!--
skills/quality-gates/verify-quality.md — Verify Quality — Use this skill to check code quality, complexity, and maintainability after chan

Use this skill to check code quality, complexity, and maintainability after changes. ## Complexity
-->
# Verify Quality

Use this skill to check code quality, complexity, and maintainability after changes.

## Complexity

- [ ] Cyclomatic complexity per function stays below 15
- [ ] Cognitive complexity per function stays below 20
- [ ] No function exceeds 50 lines (excluding comments and blank lines)
- [ ] No file exceeds 800 lines
- [ ] No nesting deeper than 4 levels; use early returns to flatten

**Severity**: Function >80 lines = High. File >800 lines = High. Nesting >5 = Medium.

## Naming

- [ ] Variables and functions use descriptive, intention-revealing names
- [ ] Boolean variables use `is`, `has`, `should`, or `can` prefixes
- [ ] No single-letter variables outside tiny loop counters
- [ ] No abbreviations unless universally understood (id, url, http)
- [ ] Types, interfaces, and components use PascalCase
- [ ] Constants use UPPER_SNAKE_CASE

**Severity**: Misleading name = High. Ambiguous abbreviation = Medium.

## Code Smells

- [ ] No dead code (unreachable branches, unused imports, commented-out blocks)
- [ ] No magic numbers or strings; extract to named constants
- [ ] No god objects or god functions that do everything
- [ ] No feature envy (function that uses another module's data more than its own)
- [ ] No shotgun surgery pattern (one change requires edits across many files)
- [ ] No primitive obsession (use domain types instead of raw strings/numbers)

**Severity**: Dead code = Medium. God function = High. Magic number = Low.

## DRY Violations

- [ ] No duplicated logic blocks (3+ lines repeated 2+ times)
- [ ] Shared patterns extracted into utility functions or modules
- [ ] No copy-paste drift where cloned code diverged silently
- [ ] Configuration values defined once and referenced

**Severity**: Exact duplication = Medium. Diverged clone = High.

## Error Handling

- [ ] All error paths handled explicitly; no silent swallowing
- [ ] Errors include context for debugging (what failed, with what input)
- [ ] User-facing errors are friendly; developer-facing errors are detailed
- [ ] Async errors caught (unhandled promise rejections, goroutine panics)
- [ ] Resource cleanup in finally/defer blocks

**Severity**: Silent swallow = High. Missing async catch = High. No context = Medium.

## Immutability

- [ ] Functions return new values instead of mutating inputs
- [ ] Collections updated via spread/copy, not in-place mutation
- [ ] Shared state minimized; prefer local scope

**Severity**: Mutation of shared state = High. Local mutation = Low.

## Type Safety

- [ ] No use of `any` or equivalent escape hatches without justification
- [ ] Null/undefined handled with type narrowing or optional chaining
- [ ] Generic types used where they reduce duplication without obscuring intent

**Severity**: Unchecked `any` = Medium. Missing null check = High.

## Readability

- [ ] Functions do one thing and are named for what they do
- [ ] Control flow is linear and predictable (no spaghetti)
- [ ] Related code is colocated; unrelated code is separated
- [ ] Abstractions are justified by actual reuse, not speculation

**Severity**: Tangled control flow = High. Speculative abstraction = Medium.

## Severity Reference

| Level | Meaning | Action |
|---|---|---|
| Critical | Correctness risk or architectural violation | Must fix |
| High | Significant maintainability problem | Should fix |
| Medium | Quality concern worth addressing | Fix when practical |
| Low | Style preference or minor suggestion | Optional |
