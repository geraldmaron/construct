<!--
examples/seed-observations/patterns.md — engineering patterns for Construct memory seed corpus.

Each entry becomes one observation in the store. Format: ## Category, then pattern entries
with **Pattern name** and description. Imported via `construct bootstrap`.
-->

# Engineering Patterns

## Code Quality

**Read before edit** — Always read the target file with the Read tool before writing or editing. Editing without reading produces stale edits that fail with "oldString not found".

**Parallel tool calls for independent work** — When two tool calls don't depend on each other's output, issue them in the same message. Cuts wall time roughly in half for multi-file operations.

**Probe before bulk read** — Use Glob or Grep to identify which files are relevant before reading them. Bulk-reading 10 files to find the one that matters burns context and slows response.

**Edit smallest possible diff** — Target the exact lines that need to change. Large oldString blocks with unchanged surrounding context are fragile when the file is modified concurrently.

## Testing

**Run targeted test first** — Before running the full suite, run only the affected test file. Faster feedback loop; full suite confirms no regressions.

**Assert the contract, not the implementation** — Tests that check internal state (private variables, call counts) break on refactors that don't change behavior. Test the public output.

**Table-driven tests for edge cases** — When a function has many input/output pairs to verify, a single table-driven test is more maintainable than N separate `it()` blocks.

## Git Discipline

**Branch, test, merge** — Never commit directly to main. Branch for every feature or fix, verify tests pass, then merge.

**Commit message: why, not what** — The diff already shows what changed. The commit message should explain why. "fix dry-run bypass" is less useful than "fix: dry-run skipped mkdirp calls, causing 31 phantom files in test home".

**Atomic commits** — One logical change per commit. Mixing a bug fix with a refactor makes bisect and revert painful.

## Agent Dispatch

**Route through Construct** — Construct is the single dispatch point. Invoking specialist agents directly bypasses context injection and workflow tracking.

**Subagent for isolated subtasks** — Use Task tool dispatch when a subtask has a clear input/output contract and doesn't need the parent conversation history. Keeps the main context lean.

**Timeout specialist calls** — Agent dispatch without a timeout can block indefinitely. Set `timeout: 120_000` as a floor; use 300_000 for heavy analysis tasks.
