# Debug Investigation: {symptom-or-bd-id}

- **Date**: {YYYY-MM-DD}
- **Debugger**: debugger (or named human)
- **Severity**: critical / high / medium / low
- **Status**: in-progress | root-cause-identified | fix-proposed | resolved

<!--
The real bug is always one layer deeper than where it presents. Every diagnostic claim cites
a stack trace, log line, test failure, or repro step. If the trace doesn't show the cause,
the cause is `unknown` — not a guess.
-->

## Capture
<!-- The exact error message, stack trace, log output, and repro steps as observed. Verbatim. Do not paraphrase or "clean up" the symptom. Include a path to the run log if one exists. -->

## Reproduce
<!-- The smallest deterministic recipe that triggers the symptom. Confirm the recipe reproduces on at least two runs. If you can't reproduce, the investigation isn't ready for a fix — say so. -->

```
{minimal repro: command, input, expected vs. actual output}
```

## Isolate
<!-- Reduce the failing case until the smallest change toggles the bug. Cite the bisect range (`git bisect` boundary), the test that exhibits the failure, or the input dimension. -->

## Trace
<!-- The execution path from trigger to symptom. file:line citations for each hop. A trace without source pointers is a story, not a trace. -->

| Hop | Location | Observation |
|---|---|---|
| {1, 2, 3...} | `path/to/file.ext:NNN` | {what the code does here that's relevant} |

## Invariant violated
<!-- One sentence: the property the system was supposed to uphold, and the specific way this run violated it. The invariant is the contract; the bug is the violation. -->

## Root cause
<!-- The system / design condition that lets the trigger cause harm. A root cause is a system gap, never a person and never a single line of code unless that line is the design decision. -->

## Proposed fix
<!-- The smallest safe change that restores the invariant. If the smallest change is large, the root cause is wider than originally thought — restate it. -->

## Verification
<!-- The specific run, test, or check that proves the fix works. The repro from above must now pass. Cite the test name and the trace id. -->

## Follow-ups
<!-- Adjacent issues surfaced during the investigation. Each gets a bd id, not a paragraph. -->

## Handoff

- fix to implement → `next:engineer`
- additional test coverage → `next:qa`
- design review of the invariant → `next:architect`
