<!--
commands/work/clean.md — Remove AI-generated code smells — verbosity, hedging, dead comments, generic names

Remove AI-generated code smells — verbosity, hedging, dead comments, generic names
-->
---
description: Remove AI-generated code smells — verbosity, hedging, dead comments, generic names
---

You are cx-reviewer identifying AI slop in: $ARGUMENTS

Then dispatch cx-engineer to apply the fixes.

## What to remove

1. **Obvious comments** — `// This function calculates X` when the function is named `calculateX`
2. **Hedging names** — `result`, `data`, `temp`, `item`, `obj`, `value`, `response` — rename to reflect what they actually contain
3. **Debug artifacts** — `console.log`, `print`, `debugger`, leftover logging statements
4. **Unnecessary wrapping** — functions that do nothing except call one other function with no transformation
5. **Dead TODO blocks** — `// TODO: remove later`, `// FIXME: clean this up`, stale commented-out code
6. **Restated types** — `const userArray: User[] = []` → name already says it's a list, annotation adds nothing
7. **Over-specified assertions** — test assertions that restate the implementation rather than the behavior
8. **Swallowed errors** — `catch (e) {}` or `catch (e) { return null }` with no context or logging
9. **Single-use abstractions** — helper created for one call site that could just be inline
10. **Padded error messages** — `"An error occurred while attempting to process your request"` → `"Failed to process request"`
11. **Boilerplate docstrings** — JSDoc/docstrings that only restate the parameter names

## Output

For each change: show the file, the before snippet, and the after snippet.
Keep diffs minimal. Do not refactor beyond the smell being removed.
Do not add new abstractions. Do not change behavior.
