#!/usr/bin/env node
/**
 * lib/hooks/session-tracking-refresh.mjs — keep the project's tracking
 * surfaces current at session end.
 *
 * Runs as a Stop hook in parallel with the other Stop-time hooks. Touches
 * three surfaces:
 *
 *   - `.cx/context.md` + `.cx/context.json` — refresh Active Work, Recent
 *     Decisions, and Architecture Notes from the session's observations,
 *     commits, and bead state changes.
 *   - `plan.md` — sync the bead-status table with current `bd show <id>`
 *     truth; if every referenced bead has closed and the plan has been
 *     idle for >1h, archive a copy to `.cx/handoffs/<date>-plan-landed.md`
 *     and reset `plan.md` to the standard template.
 *
 * Best-effort. Failures degrade silently. Wall-clock budgeted at 2000 ms
 * total — bd shells out, and a plan with several bead refs needs one
 * `bd show` per ref. Exits 0 on any error so the session close path is
 * never blocked.
 *
 * Only runs inside Construct projects (presence of `.cx/`) — same gate as
 * the other Stop hooks.
 *
 * @lifecycle Stop
 * @matcher  *
 * @p95ms 2000
 * @maxBlockingScope none (Stop, non-blocking)
 * @exits 0 = pass
 */

import { existsSync } from 'node:fs';
import { readHookInput } from './_lib/input.mjs';
import { logHookFailure } from './_lib/log.mjs';
import { projectConfigDir } from '../config-dir.mjs';

const HARD_BUDGET_MS = 2000;
const startedAt = Date.now();

const input = readHookInput();
const cwd = input?.cwd || process.cwd();

// Only run inside Construct projects.
if (!existsSync(projectConfigDir(cwd))) process.exit(0);

const deadline = setTimeout(() => process.exit(0), HARD_BUDGET_MS);
deadline.unref();

try {
  // Order matters. archivePlanIfLanded reads plan.md's mtime to decide
  // whether the plan has been idle long enough to retire. syncPlanFile
  // mutates plan.md when bead statuses drift — which bumps mtime and
  // makes the plan look "recently touched" to the archive check. Run
  // archive first (true idle mtime), then sync the survivor.
  const { archivePlanIfLanded, syncPlanFile, refreshContextMd } = await import('../tracking-surfaces.mjs');
  await archivePlanIfLanded({ rootDir: cwd });
  await syncPlanFile({ rootDir: cwd });
  await refreshContextMd({ rootDir: cwd });
} catch (err) {
  logHookFailure({ hook: 'session-tracking-refresh', err, phase: 'refresh' });
}

const elapsed = Date.now() - startedAt;
if (elapsed > HARD_BUDGET_MS) {
  try {
    process.stderr.write(`[session-tracking-refresh] over budget: ${elapsed}ms\n`);
  } catch { /* stderr closed */ }
}

process.exit(0);
