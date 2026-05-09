<!--
examples/seed-observations/anti-patterns.md — recurring mistakes for Construct memory seed corpus.

Each entry becomes one observation in the store with category "anti-pattern". Imported via
`construct bootstrap`.
-->

# Anti-Patterns

## Context Waste

**Reading the whole file to find one function** — Use Grep to locate the line number, then Read with offset/limit to read only that section. Reading a 500-line file to find a 10-line function burns ~5k tokens.

**Re-reading already-loaded files** — If the file content is already in context, reading it again is pure waste. Check context before issuing another Read.

**Sequential tool calls that could be parallel** — Issuing Glob, then Read, then Grep one at a time when they're independent triples the latency. Batch independent calls in one message.

## Code Authoring

**Guessing a function signature** — Never guess an API or function signature. Read the source or check the docs first. Wrong signatures produce runtime errors that cost a full round-trip to fix.

**Editing without reading** — Issuing an Edit without a prior Read produces "oldString not found" failures when the file differs from assumptions. Always read first.

**Creating new files instead of editing existing ones** — Adding a new file when the logic belongs in an existing one fragments the codebase. Check for the right home first.

**Commenting what the code already says** — `// increment counter` above `count++` adds noise. Comments earn their place by explaining non-obvious constraints, not restating syntax.

## Testing

**Testing the mock instead of the behavior** — A test that only verifies that a mock was called doesn't confirm the real behavior. Prefer integration-level assertions over spy counts.

**Skipping the failing test to make CI green** — Skipping tests hides regressions. Fix the failure or delete the test with a comment explaining why it no longer applies.

## Git

**Amending a pushed commit** — `git commit --amend` after a push requires force-push, which rewrites shared history. Use a new commit instead.

**Committing without running tests** — Tests exist to catch regressions before they land on main. A green build is the only signal that a change is safe to ship.

## Agent Behavior

**Stopping without surfacing incomplete tasks** — An agent that stops while tasks are `in_progress` or have unmet acceptance criteria leaves the user without visibility. Surface the state before stopping.

**Making assumptions about user intent** — When a requirement is ambiguous, ask one targeted question rather than guessing and building the wrong thing.
