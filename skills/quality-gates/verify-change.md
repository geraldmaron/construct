<!--
skills/quality-gates/verify-change.md — Verify Change — Use this skill to analyze the impact of code changes and verify documentation an

Use this skill to analyze the impact of code changes and verify documentation and tests are in sync. ## Change Inventory
-->
# Verify Change

Use this skill to analyze the impact of code changes and verify documentation and tests are in sync.

## Change Inventory

1. List all files modified, added, or deleted
2. Categorize each change: feature, fix, refactor, config, test, docs
3. Identify the blast radius: what modules, APIs, or surfaces are affected

## Breaking Change Detection

- [ ] Public API signatures unchanged or versioned
- [ ] Database schema changes have a migration
- [ ] Configuration keys unchanged or explicitly migrated
- [ ] Environment variables documented if added or renamed
- [ ] Event/message contracts unchanged or versioned
- [ ] CLI flags and arguments preserved or deprecated gracefully

**Severity**: Silent breaking change = Critical. Undocumented migration = High.

## Dependency Impact

- [ ] No circular dependency introduced
- [ ] Import graph depth not significantly increased
- [ ] Shared utilities not modified in ways that affect other consumers
- [ ] New dependencies justified and audited
- [ ] Lock file updated consistently with manifest

**Severity**: Circular dependency = High. Unjustified new dependency = Medium.

## Test Sync

- [ ] New code paths have corresponding tests
- [ ] Modified code paths have updated tests
- [ ] Deleted code has corresponding test removal
- [ ] No tests reference removed or renamed identifiers
- [ ] Edge cases from the change are covered
- [ ] Test coverage did not decrease

**Severity**: New path without test = High. Stale test = Medium.

## Documentation Sync

- [ ] README updated if public interface changed
- [ ] API documentation reflects new or modified endpoints
- [ ] Inline comments updated if behavior changed
- [ ] Migration guides written for breaking changes
- [ ] Core docs updated for user-visible or architectural changes (`.cx/context.*`, `.cx/workflow.json`, `docs/README.md`, `docs/architecture.md`)
- [ ] Architecture decision records created for significant shifts

**Severity**: Stale API docs = High. Missing core-doc update for project reality changes = High. Stale comment = Low.

## Configuration Sync

- [ ] Environment variable additions documented
- [ ] Default values are safe for all environments
- [ ] Feature flags added for risky changes
- [ ] CI/CD pipeline updated if build steps changed

**Severity**: Missing env var docs = High. Unsafe default = High.

## Rollback Safety

- [ ] Database migrations are reversible
- [ ] Feature flags allow disabling the change in production
- [ ] No destructive data operations without confirmation
- [ ] Deployment can be rolled back without data loss

**Severity**: Irreversible migration = Critical. No rollback path = High.

## Review Checklist

Before approving the change:

1. Run `git diff` against the base branch to see the full scope
2. Verify each category above
3. Flag any item that is not addressed
4. Confirm all CI checks pass
5. Verify the change works in a representative environment

## Severity Reference

| Level | Meaning | Action |
|---|---|---|
| Critical | Breaking change or data risk | Must fix before merge |
| High | Missing coverage or stale docs | Should fix before merge |
| Medium | Minor drift or gap | Fix when practical |
| Low | Suggestion | Optional |
