<!--
skills/quality-gates/verify-module.md — Verify Module — Use this skill to check that a module or package is structurally complete and re

Use this skill to check that a module or package is structurally complete and ready for use. ## Exports
-->
# Verify Module

Use this skill to check that a module or package is structurally complete and ready for use.

## Exports

- [ ] Public API is explicitly exported (barrel file, `__init__.py`, `mod.rs`, etc.)
- [ ] Internal helpers are not exposed in the public surface
- [ ] Export names are stable and follow project naming conventions
- [ ] Re-exports are intentional, not accidental leaks

**Severity**: Accidental internal export = High. Missing public export = High.

## Types

- [ ] All public functions have typed parameters and return values
- [ ] Shared data structures have explicit type definitions
- [ ] No use of `any` or equivalent without documented justification
- [ ] Nullable fields are explicitly marked and handled
- [ ] Generic types are constrained appropriately

**Severity**: Untyped public API = High. Unconstrained generic = Medium.

## Tests

- [ ] Unit tests exist for all public functions
- [ ] Edge cases covered: empty input, null, boundary values, error paths
- [ ] Tests are colocated or clearly mapped to the module
- [ ] Test file naming follows project convention
- [ ] Coverage meets minimum threshold (80%)
- [ ] Tests run independently without shared mutable state

**Severity**: No tests for public function = High. Below coverage = Medium.

## Error Handling

- [ ] All error conditions documented or typed (error types, result types)
- [ ] Errors include enough context for callers to act
- [ ] No panics or unhandled exceptions in library code
- [ ] Async errors propagated correctly
- [ ] Resource cleanup handled in all exit paths

**Severity**: Unhandled panic in library = Critical. Missing error context = Medium.

## Documentation

- [ ] README exists with: purpose, installation, usage example, API summary
- [ ] Public functions have doc comments explaining behavior, not implementation
- [ ] Parameters and return values described
- [ ] Side effects documented
- [ ] Examples are runnable and correct

**Severity**: No README = Medium. No doc comments on public API = Medium.

## Dependencies

- [ ] Only necessary dependencies imported
- [ ] No circular dependencies with sibling modules
- [ ] External dependencies pinned to compatible ranges
- [ ] No vendored code without justification

**Severity**: Circular dependency = High. Unnecessary dependency = Low.

## Structure

- [ ] Single responsibility: module does one coherent thing
- [ ] Files within the module are organized by concern
- [ ] No file exceeds 800 lines
- [ ] Entry point is obvious (index, main, mod, __init__)
- [ ] Internal structure matches project conventions

**Severity**: Mixed responsibilities = High. Oversized file = Medium.

## Configuration

- [ ] Configurable values externalized (not hardcoded)
- [ ] Defaults are safe and documented
- [ ] Required configuration fails fast with clear error on missing values

**Severity**: Hardcoded config = Medium. Silent missing config = High.

## Completeness Checklist

A module is ready when all of these are true:

1. Public API is typed, exported, and documented
2. Tests exist and pass with adequate coverage
3. Errors are handled and propagated correctly
4. Dependencies are minimal and justified
5. Structure follows project conventions
6. README provides enough context to use the module without reading source
