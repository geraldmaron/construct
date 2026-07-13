---
intake: none
---

# GH #248 re-repro on current version (1.5.5, `fix/bash-log-secret-redaction` @ `1cef275d`)

Bead: `construct-72gqn.2` (W0.3). Original issue filed against Construct CLI `v1.0.21`/`v1.0.23`,
claiming `construct orchestrate run --json --strategy orchestrated` reports `status:"completed"`
with an empty `tasks` array and no specialist output payload.

## Repro command (original issue's shape, adapted — no `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` env
needed on this version)

```
node ./bin/construct orchestrate run --json 'Return only JSON {"ok":true}' \
  --strategy orchestrated --host claude-code
```

**Result: the symptom still reproduces on current code**, but the root cause is now precisely
isolated and is *not* what the original issue assumed.

## Root cause (confirmed by direct code read + three live reproductions)

`lib/orchestration/flow-selection.mjs:routeRequest` computes **two independent specialist lists**:

- `specialists` — from `selectSpecialists({ track, ... })` using the **real** execution track
  returned by `determineExecutionTrack` (`lib/orchestration/classification.mjs:407`). For a short
  request with no scope signal, `determineExecutionTrack` falls through to
  `EXECUTION_TRACKS.immediate` (fileCount≤1, moduleCount≤1, no "end to end"/"ship"/"full" keyword)
  — and the `immediate` track's `selectSpecialists` branch returns `[]` unconditionally.
- `policySpecialists` — from the same call with `track` force-upgraded (`immediate → focused`),
  which is **never empty**.
- `displaySpecialists = specialists.length ? specialists : policySpecialists` — the **displayed**
  `routePath.specialistSequence` in the JSON output uses this fallback, so it always shows at
  least one specialist even when the real `specialists` array (the one `buildTasks` actually
  consumes, `runtime.mjs:124`) is empty.

So a caller who passes `--strategy orchestrated` gets back `effectiveStrategy: "orchestrated"`,
`constructCapabilitiesActive: [...]`, `status: "completed"`, and a non-empty
`routePath.specialistSequence` — while `tasks: []`, because `buildTasks(route)` used the *real*
(empty) `route.specialists`, not the displayed one. **The requested/effective strategy and the
track-based specialist-selection classifier are evaluated independently and never cross-checked;
the JSON output does not disclose the mismatch.**

## Three live reproductions (this session, inline backend, no API key needed)

| Request | `routePath.specialistSequence` (displayed) | real track | `tasks` |
|---|---|---|---|
| `Return only JSON {"ok":true}` | `["cx-engineer"]` | immediate | `[]` |
| `Design and implement a rate limiter for the API layer, then review and test it` | `["cx-reviewer"]` | immediate (no scope signal) | `[]` |
| same request + `--file-count 3` | `["cx-architect","cx-engineer","cx-reviewer","cx-qa"]` | orchestrated | 4 tasks, `status:"completed-prepare-only"`, `executor:"inline:prepared"` |

The third row is the honest case: once the track classifier agrees the work is orchestrated
scope, `finalizeRun` correctly reports `completed-prepare-only` (not a bare `"completed"`) and
populates tasks. The first two rows show `status:"completed"` (not `-prepare-only`) with zero
tasks and no disclosure — this is the `#248`-class defect, still live.

## Disposition

**Not closing #248** — re-scoping it. The original report's literal claim (orchestrated mode
returns metadata-only JSON) is still true today, but for a different reason than the report could
have known in v1.0.21/23: it is not that specialist output is missing from an otherwise-correct
run, it's that **track classification can silently downgrade a `--strategy orchestrated` request
to zero specialists without the response disclosing the downgrade**, and — separately — even in
that empty-task case `status` reads `"completed"` rather than the more honest
`"completed-prepare-only"`/`"completed-immediate"` used elsewhere in the same taxonomy.

Reconciled into the wave-1 plan two ways:
- **H9.2** (typed outputSchema + honest description) should also cover this: the `orchestration_run`
  description should note that `requestedStrategy`/`effectiveStrategy` can diverge from the actual
  specialist count, and the status taxonomy should not use bare `"completed"` for a zero-task run.
- **H9.3** (terminal-result contract test) will assert a `"completed"` status with `tasks:[]` is
  never emitted — closing exactly this gap — as part of "every terminal state carries an honest
  marker."

No code changed in this bead (repro-only). Comment posted to #248 pending user review before
closing or re-scoping the GitHub issue itself (posting to GitHub is an explicit-permission action).

## Addendum (H9.2 landed, commit `b8788515`)

H9.2 closed the **disclosure** half of this finding, not by forbidding a bare `"completed"` +
empty-`tasks` response — on reflection, that combination is legitimately honest for a genuinely
trivial request (nothing is wrong with a run correctly deciding it needs zero specialists). The
actual defect was that a caller reading `routePath.specialistSequence` alone could not tell a real
dispatch from the display-fallback's hypothetical one. Fixed by adding the real `specialists`
array to `hostAdapterMetadata` (mirroring `shapeRun`, which already had it) — a caller now sees
`specialists: []` alongside `routePath.specialistSequence: ["cx-engineer"]` in the same `--json`
payload and can tell them apart, instead of `routePath` being the only specialist-list field in
that output.

H9.2 separately fixed the taxonomy-consistency bug this repro surfaced as a side effect:
`hostAdapterMetadata` (what `--json` actually calls) echoed the raw `run.status`, never
`shapeRun`'s `deriveHonestRunStatus` taxonomy — so a *different* class of run (top-level-degraded,
or all-tasks-prepared) could print bare `"completed"` in `--json` while the human-readable text
output for the identical run correctly said `degraded`/`completed-prepare-only`. That inconsistency
is now gone; both readers derive status from the same function.

**Revised scope for H9.3** (terminal-result contract test): assert `specialists` is present and,
whenever `tasks.length === 0`, is consistent with it (both empty) — not that `status:"completed"`
with empty `tasks` can never occur. Also assert `hostAdapterMetadata` and `shapeRun` never disagree
on `status`/`degraded` for the same run (regression coverage for the taxonomy-consistency fix).
