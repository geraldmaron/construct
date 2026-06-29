<!--
tests/functional/README.md. Discipline doc for the functional test layer.

End-to-end checks that exercise a feature in an isolated filesystem, the same
way it would behave in a real session. Distinct from unit tests in tests/.
-->

# Functional tests

End-to-end checks that exercise a feature in an isolated filesystem, the same way it would behave in a real session. Distinct from unit tests in `tests/`.

## When to add one

Every change that touches more than one of these surfaces needs a functional test here:

- A hook that writes to `.cx/` or `~/.cx/`
- A learning loop (observation capture, research persistence, outcome capture, prompt improvement)
- A profile or intake table that drives routing
- A CLI subcommand that reads or writes durable state
- Any pipeline where the value only shows up after multiple steps run together

If a defect would slip past unit tests because each unit looks fine in isolation, it belongs here.

## Pattern

Every functional test:

1. Creates a fresh `mkdtempSync` directory. No shared fixtures.
2. Spawns the real binary or imports the real module, no mocks beyond what production uses.
3. Asserts on durable artifacts (files, JSONL lines, vector indexes), not return values alone.
4. Verifies the next-step contract: if A1 writes an observation, A1's functional test reads it back with `searchObservations` to prove the loop closes.
5. Cleans up. The tmpdir is deleted on success.

### Isolation contract

Durable writes must stay under the fixture root — never the developer's real `HOME`,
`~/.cx`, or repo `profiles/`. When a test redirects `process.env.HOME`, it must
restore the prior value in `finally`, `after`, or `t.after` (parallel `node --test`
shares one process environment).

- Use `tests/helpers/isolation-contract.mjs` (`assertPathUnderRoot`) after APIs that
  resolve project-scoped storage (`exportTurns`, `resolveProjectScopedPath`, etc.).
- Create a Construct project marker (`.cx/` or `package.json` + `.cx/`) in the
  fixture when exercising project-scoped commands.
- `tests/test-isolation.test.mjs` flags files that assign `HOME` without an in-file
  restore signal.

## Run

```bash
npm run test:functional
```

Or a single file:

```bash
node --test tests/functional/a1-session-reflect.functional.test.mjs
```

These run as part of `npm test` so the gate fails the same way locally as in CI.

## Test runner

`node --test` (via `scripts/run-tests.mjs`) is the sole supported test runner. The suite
was fully ported off `ava` in `construct-m7k2-fix-tests`; do not reintroduce alternate
runners or discovery globs that bypass `scripts/run-tests.mjs`.

Beads concurrency is covered by `beads-concurrent-write.functional.test.mjs` (optimistic
locking, no legacy file-lock fallback).

## Why this exists

CI is a backstop, not a primary gate. If a learning loop only fails when components interact, a unit-test green checkmark gives a false sense of safety. The vector-index regression in A1's first commit is the canonical example: `addObservation` was async, the hook forgot to await it, every unit test passed, and the vector write was killed by `process.exit`. A functional test that asserted `vectors.json` exists would have caught it locally in seconds.

Functional tests are how Construct keeps that kind of class-of-bug from reaching CI.
