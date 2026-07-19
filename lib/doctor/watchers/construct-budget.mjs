/**
 * lib/doctor/watchers/construct-budget.mjs — .construct/ disk budget maintenance.
 *
 * When project .construct/ usage crosses the configured cap, runs age/count prune.
 * When still over cap after retention prune, emergency-reclaims oldest
 * traces and worker logs (hard-reject categories only).
 *
 * Tick: 15 min.
 */

import { existsSync } from 'node:fs';

import { record } from '../audit.mjs';
import { escalate } from '../escalate.mjs';
import {
  measureUsage,
  planPrune,
  executePrune,
  planEmergencyReclaim,
} from '../../resources/budget.mjs';
import { projectConfigDir } from '../../config-dir.mjs';

export const name = 'construct-budget';
export const intervalMs = 15 * 60 * 1000;

function projectRoot() {
  return process.env.CONSTRUCT_PROJECT_ROOT || process.cwd();
}

export async function tick() {
  const actions = [];
  const escalations = [];
  const root = projectRoot();
  const constructDir = projectConfigDir(root);
  if (!existsSync(constructDir)) {
    return { actions, escalations, notes: [{ skipped: 'no .construct directory' }] };
  }

  const before = measureUsage(root, process.env);
  if (before.totalConstructUsageRatio <= 0.8) {
    return { actions, escalations, notes: [{ usageRatio: before.totalConstructUsageRatio }] };
  }

  const planned = planPrune(root, process.env);
  let reclaimed = { removed: [], bytesFreed: 0 };
  if (planned.length) {
    reclaimed = executePrune(planned);
    record({
      kind: 'action',
      watcher: name,
      action: 'prune',
      target: '.construct/',
      summary: `retention prune removed ${reclaimed.removed.length} file(s), freed ${reclaimed.bytesFreed} bytes`,
      context: { planned: planned.length, removed: reclaimed.removed.length },
    });
    actions.push({ type: 'prune', target: '.construct/', removed: reclaimed.removed.length });
  }

  const afterPrune = measureUsage(root, process.env);
  if (afterPrune.totalConstructUsageRatio > 1) {
    const emergency = planEmergencyReclaim(root, 0, process.env);
    if (emergency.length) {
      const emergencyResult = executePrune(emergency);
      record({
        kind: 'action',
        watcher: name,
        action: 'emergency-reclaim',
        target: 'state-root:traces|state-root:runtime/worker',
        summary: `emergency reclaim removed ${emergencyResult.removed.length} file(s), freed ${emergencyResult.bytesFreed} bytes`,
        context: emergencyResult,
      });
      actions.push({ type: 'emergency-reclaim', removed: emergencyResult.removed.length });
    }
  }

  const after = measureUsage(root, process.env);
  if (after.totalConstructUsageRatio > 1) {
    const usedMb = Math.round(after.totalConstructBytes / 1024 / 1024);
    const capMb = Math.round(after.totalConstructCap / 1024 / 1024);
    const r = await escalate({
      watcher: name,
      eventType: 'service.down',
      summary: `.construct/ still over cap after prune (${usedMb}MB / ${capMb}MB) — raise resources.disk.totalConstructMaxMb or delete load-bearing state manually`,
      context: { usageRatio: after.totalConstructUsageRatio, usedMb, capMb },
    });
    escalations.push({ eventType: 'service.down', result: r });
  }

  return {
    actions,
    escalations,
    notes: [{
      usageBefore: before.totalConstructUsageRatio,
      usageAfter: after.totalConstructUsageRatio,
      bytesFreed: reclaimed.bytesFreed,
    }],
  };
}
