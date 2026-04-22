<!--
skills/roles/engineer.md — Anti-pattern guidance for the Engineer role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the engineer domain and counter-moves to avoid them.
Applies to: cx-engineer, cx-ai-engineer, cx-data-engineer, cx-platform-engineer.
-->
---
role: engineer
applies_to: [cx-engineer, cx-ai-engineer, cx-data-engineer, cx-platform-engineer]
inherits: null
version: 1
---
# Engineer — Role guidance

Load this before drafting. These are the failure modes that separate strong role output from weak role output — check your draft against each.


### 1. Writing before reading
**Symptom**: new code added to a file or module without first reading the surrounding code and its callers.
**Why it fails**: duplicates existing utilities, violates local conventions, and breaks invariants the author did not see.
**Counter-move**: read the file end-to-end and at least one caller before adding anything. Prefer reusing what is there.

### 2. Speculative abstraction
**Symptom**: interfaces, factories, or configuration options added for a future case that may never arrive.
**Why it fails**: creates surface area no one understands and no tests exercise. Adds cognitive load for every later reader.
**Counter-move**: write the simplest thing that solves the current case. Abstract only when a third instance demands it.

### 3. Silent API assumption
**Symptom**: using a library or endpoint based on a pattern seen elsewhere in the code, without checking the actual contract.
**Why it fails**: the assumption is usually close-but-wrong. Bugs surface in production, not in review.
**Counter-move**: read the library's docs or source for the specific function used. Verify the shape of the response.

### 4. Hidden coupling
**Symptom**: a change in module A silently depends on a behavior in module B that is not expressed in the interface.
**Why it fails**: any future refactor of B breaks A with no warning. The coupling is invisible until it fails.
**Counter-move**: either express the dependency in the type system or in a test that would fail if B changed.

### 5. Skipped verification
**Symptom**: marking work done without running the code, the tests, or the build.
**Why it fails**: type errors, broken imports, and runtime crashes ship to the next reviewer or to production.
**Counter-move**: run the build, run the tests, exercise the code path changed. Paste the evidence into the PR.

### 6. Oversized files and functions
**Symptom**: functions over 50 lines, files over 800 lines, or deep nesting over four levels.
**Why it fails**: the reader cannot hold the logic in their head; bugs hide in the middle third.
**Counter-move**: extract when a function does more than one thing. Split when a file mixes concerns.

### 7. Error swallowing
**Symptom**: `catch` blocks that log-and-continue, default fallbacks that mask upstream failures, empty `except:` clauses.
**Why it fails**: the system keeps running in a broken state; debugging later is impossible because the signal is gone.
**Counter-move**: handle errors explicitly at the boundary where you can make a decision. Re-raise or return a typed error otherwise.

### 8. Fixing the symptom
**Symptom**: a patch that makes the test pass or the error disappear without a clear statement of the underlying cause.
**Why it fails**: the root cause re-emerges in a different place, often worse.
**Counter-move**: explain the cause in one sentence before writing the fix. If you cannot, keep investigating.

### 9. Ignoring the diff
**Symptom**: the change includes unrelated edits — formatting churn, drive-by renames, comment cleanups.
**Why it fails**: drowns the real change in noise; reviewers cannot separate intent from accident.
**Counter-move**: one change per commit. Keep the diff narrow. Bank the drive-bys for a separate PR.

### 10. Speculating across thinking turns
**Symptom**: reasoning about which library, pattern, or abstraction to use across multiple thinking turns without reading code, calling docs, or asking.
**Why it fails**: guesses compound; the eventual choice is made from context the model built about itself, not from the codebase or the library.
**Counter-move**: two unproductive passes is the cap. Next step is a targeted read, a docs lookup (`context7_query-docs`/`WebFetch`), a NEEDS_MAIN_INPUT packet, or a default with a noted assumption.

### 11. Unbounded file reads
**Symptom**: reading files with large `limit` values without checking size first, or offset reads that fail with "out of range".
**Why it fails**: wastes context, and the failure reveals the file was smaller than assumed — a signal that the reading strategy was guess-driven.
**Counter-move**: before any `Read` over 200 lines, probe with `Glob`, `wc -l`, or a `limit: 50` read. Then request the right range.

## Self-check before shipping

- [ ] Read the surrounding file and at least one caller
- [ ] No new abstraction unless there are three concrete uses
- [ ] Library and API contracts verified from their source
- [ ] Build passes, tests pass, code path exercised
- [ ] No function over 50 lines, no file over 800, no nesting over four
- [ ] Errors handled explicitly, not swallowed
- [ ] Root cause of any bug fix is stated in one sentence
- [ ] Diff is narrow and on-topic
- [ ] No more than two consecutive thinking turns about the same decision without a tool call or input
- [ ] Any `Read` over 200 lines was preceded by a size probe
