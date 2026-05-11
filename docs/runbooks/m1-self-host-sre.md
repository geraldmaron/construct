# M1 — 7-day SRE-only self-host test

The first milestone of "Construct runs on Construct." Scoped to reliability: doctor + cx-sre handle infra issues on this repo for 7 days without paging the user. Subsequent milestones add more personas (M2: + QA/Security/Docs-Keeper; M3: + dev loop; ...; Mfinal: full org).

## Pre-flight

```
# Doctor and roles are on by default; explicit ON only required if user disabled them.
unset CONSTRUCT_DOCTOR
unset CONSTRUCT_ROLES

# Optional: tighten budgets for the test if you want stricter cost ceilings.
# Defaults: $1/persona/day, $10/total/day. Override per-persona via CONSTRUCT_BUDGET_SRE=N.

# Start the daemon stack (spawns doctor next to dashboard/cm/opencode).
node bin/construct up
```

Verify the daemon is up:

```
node bin/construct doctor status   # expects: running, pid, 4 watchers listed
node bin/construct doctor logs --limit=10   # expects: cost + disk samples on first tick
```

## What to expect during the run

The doctor watchers tick on these intervals:

- process-pressure: every 60s
- service-health: every 60s
- disk: every 5 min
- cost: every 10 min

Most ticks produce one or two `sample` entries (no action). When something is actually wrong, you'll see `action` and possibly `escalate` entries in the audit log.

## Daily check

```
node bin/construct doctor report --since=24h
```

Read sections in this order:

1. **Health verdict** at the bottom — quick green/yellow signal.
2. **L0 actions** — what the doctor did. Expect mostly disk rotations and occasional process kills.
3. **L0 → L1 escalations** — should be rare. Each entry corresponds to a bd issue that needs cx-sre dispatch.
4. **L1 events emitted** — the broader signal stream. High `secrets.detected` count usually means a hook misfire, not real secrets.
5. **Pending invocations** — anything `unresolved` is waiting for the next session to dispatch cx-sre.
6. **Cost** — track daily burn against caps.

## When cx-sre gets paged

Construct surfaces pending role invocations at session-start. You'll see a "Pending role invocations" section listing the bd issues. Dispatch via the existing Task path:

```
# In a Claude Code session:
> Dispatch cx-sre for incident <bd-id> (fingerprint <fp>).
```

cx-sre stays inside its fence (`docs/runbooks/**`, `docs/incidents/**`) and writes either a runbook or an incident report, optionally adding `next:cx-engineer` as a bd label for follow-up code fixes. The agent-tracker hook auto-enqueues that handoff for the next session.

## Acceptance criteria (binary, end of 7 days)

The test passes if **all** of these hold:

- [ ] Doctor ran the entire 7 days (no manual restart needed). `doctor report --since=7d` shows samples on every day.
- [ ] All real-world infra issues that occurred during the window were detected by L0 watchers (no silent service deaths).
- [ ] All cx-sre escalations resolved cleanly: bd issue closed, runbook or incident report filed, fence respected (no commits made by cx-sre).
- [ ] No L2 user touches were required for **routine** reliability issues — only for novel ones (where "novel" means: no matching runbook existed before).
- [ ] Cost stayed within budget (`CONSTRUCT_BUDGET_SRE=$1/day` default; total `$10/day`).
- [ ] Zero hook regressions: full test suite still passes at end of window.

## Failure modes — what to do

- **Doctor died unexpectedly**: read `~/.construct/.runtime/doctor.log`. If memory pressure, raise `CONSTRUCT_PRESSURE_GUARD_SWAP_GB`. If exception, file a bd bug + restart with `node bin/construct up`.
- **Watcher errors in audit log** (`kind: error`): inspect the watcher source; reproduce with `node bin/construct doctor tick`.
- **cx-sre dispatch failed**: check `~/.cx/role-pending.jsonl` — entry should have a `bdIssueId`. If null, bd was unreachable when the gateway tried to create the issue; the audit log will say `bd-create-failed`.
- **Budget exhausted**: increase the relevant `CONSTRUCT_BUDGET_*` env var or wait for the day to roll over. Gateway returns `budget-exhausted` reason but events still record to the bus.

## Stopping the test

```
node bin/construct down   # stops doctor + dashboard + services
node bin/construct doctor report --since=7d > docs/incidents/$(date +%Y-%m-%d)-m1-report.md
```

File the report into `docs/incidents/` as the formal M1 artifact and close `construct-x6c` with the verdict.

## What success unlocks

If M1 passes, M2 (+ QA + Security + Docs Keeper) starts. The cost story scales linearly with persona count, so M2's daily cap should be ~$25/day total to leave headroom.
