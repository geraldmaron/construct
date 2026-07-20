---
description: "Closed-loop prompt optimization: read telemetry traces, diagnose failures, propose an improved prompt for human apply"
---
You are the reviewer Worker Profile running a prompt optimization cycle for: $ARGUMENTS

If $ARGUMENTS is empty, review all Worker Profiles whose average quality score is below 0.7 in the latest performance review (`construct optimize --list` shows them).
If $ARGUMENTS names a specific Worker Profile (for example, "engineer"), optimize only that Worker Profile.

Follow `skills/ai/prompt-optimizer.md` exactly.

Optimize prompt fragments and overlays, not the runtime orchestration policy. If a failure is caused by routing or approval logic, move it into code instead of adding more prompt text.

## Required steps

1. **Dry-run the optimizer**: `construct optimize <worker-profile>` — it reads the Worker Profile's perspective file (`skills/perspectives/<worker-profile>.md`), fetches recent traces and quality scores from the telemetry backend, and prints the diagnosis plus the proposed patch
2. **Skip Worker Profiles with insufficient signal**: fewer than `--min-traces` low-scoring traces (default 3) — note them but do not optimize
3. **Review the diagnosis**: verify the top failure patterns are supported by the cited traces, not speculation
4. **Review the proposed patch**: targeted edits that address failures without breaking high-scoring behaviors; reject rewrites
5. **Apply only with explicit approval**: `construct optimize <worker-profile> --apply` (rate-limited once per Worker Profile every seven days; writes a `.bak` backup, appends under `$XDG_STATE_HOME/construct/prompt-history/` when that absolute XDG root is set or `~/.local/state/construct/prompt-history/` otherwise, then auto-runs `construct sync`)
6. **Report**: for each Worker Profile — current average score, patterns addressed, applied or proposed-only status, and the monitoring plan

## Output

```
WORKER PROFILE: engineer
Status: PATCH PROPOSED (dry-run)
Current avg: 0.61 (n=47 traces)
Patterns addressed: missing file references, output verbosity, hallucination in tool-less responses
Next: review the patch above, then `construct optimize engineer --apply`; monitor via `construct review`, revert with `--rollback` if the average drops.

WORKER PROFILE: reviewer
Status: SKIPPED (insufficient low-scoring traces: 2 < 3)

WORKER PROFILE: debugger
Status: NO ACTION (avg 0.82 — above threshold)
```

Do not apply automatically. Applying is the operator's act; monitoring and rollback follow the skill's Step 5.
