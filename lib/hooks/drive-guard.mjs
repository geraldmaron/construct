#!/usr/bin/env node
/**
 * lib/hooks/drive-guard.mjs — Drive guard hook — enforces that work/drive commands follow the orchestration policy.
 *
 * Runs as PreToolUse on Bash for construct do/drive commands. Validates that the requested goal is routed through the orchestrator rather than bypassing the policy.
 */
// Stop hook — blocks session stop when drive mode is active and acceptance criteria lack evidence.
// Reads .cx/drive-state.json (active loop manifest) + .cx/workflow.json (acceptance criteria).
// Superior to OmO's boulder: tracks per-criterion evidence, iteration history, momentum score.
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const cwd = input?.cwd || process.cwd();
const driveStatePath = join(cwd, '.cx', 'drive-state.json');
const workflowPath = join(cwd, '.cx', 'workflow.json');

if (!existsSync(driveStatePath)) process.exit(0);

let driveState = {};
try { driveState = JSON.parse(readFileSync(driveStatePath, 'utf8')); } catch { process.exit(0); }

if (!driveState.active || driveState.canStop) process.exit(0);

// Collect all acceptance criteria from non-done workflow tasks
let allCriteria = [];
let pendingTaskCount = 0;
try {
  const wf = JSON.parse(readFileSync(workflowPath, 'utf8'));
  const activeTasks = (wf.tasks || []).filter(t => t.status !== 'done' && t.status !== 'skipped');
  pendingTaskCount = activeTasks.length;
  for (const t of activeTasks) {
    for (const c of (t.acceptanceCriteria || [])) {
      if (!allCriteria.includes(c)) allCriteria.push(c);
    }
  }
} catch { /* no workflow — rely on todo count */ }

const criteriaStatus = driveState.criteriaStatus || {};
const metCriteria = allCriteria.filter(c => criteriaStatus[c]?.met);
const unmetCriteria = allCriteria.filter(c => !criteriaStatus[c]?.met);
const pendingTodos = driveState.pendingTodos || 0;
const iteration = driveState.iteration || 1;
const momentum = driveState.momentumScore != null ? Math.round(driveState.momentumScore * 100) : null;

// Decide whether to block
const hasPendingWork = (unmetCriteria.length > 0) || (allCriteria.length === 0 && (pendingTodos > 0 || pendingTaskCount > 0));

if (!hasPendingWork) {
  // All criteria met or no criteria defined and no pending work — allow stop
  process.exit(0);
}

// Emit rich drive-state report
const lines = [
  `[drive-guard] Drive mode active — iteration ${iteration}. Cannot stop yet.`,
  '',
];

if (unmetCriteria.length > 0) {
  lines.push(`Unmet criteria (${unmetCriteria.length}/${allCriteria.length}):`);
  for (const c of unmetCriteria) lines.push(`  ✗ ${c}`);
  lines.push('');
}

if (metCriteria.length > 0) {
  lines.push(`Verified criteria (${metCriteria.length}/${allCriteria.length}):`);
  for (const c of metCriteria) {
    const ev = criteriaStatus[c]?.evidence || 'recorded';
    lines.push(`  ✓ ${c} — ${ev.slice(0, 80)}`);
  }
  lines.push('');
}

if (allCriteria.length === 0) {
  lines.push(`Remaining tasks: ${pendingTodos} todos, ${pendingTaskCount} workflow tasks`);
  lines.push('');
}

if (momentum != null) lines.push(`Momentum: ${momentum}% (iteration ${iteration})`);

lines.push('');
lines.push(`[drive-guard] Record evidence by updating .cx/drive-state.json criteriaStatus, then criteria will pass.`);
lines.push(`[drive-guard] To mark a criterion met: set criteriaStatus["<criterion>"] = { met: true, evidence: "..." }`);

process.stderr.write(lines.join('\n') + '\n');
process.exit(2);
