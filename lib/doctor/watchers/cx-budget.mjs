/**
 * lib/doctor/watchers/cx-budget.mjs — .cx/ disk budget maintenance.
 *
 * When project .cx/ usage crosses the configured cap, runs age/count prune.
 * When still over cap after retention prune, emergency-reclaims oldest
 * traces and worker logs (hard-reject categories only).
 *
 * Tick: 15 min.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { record } from '../audit.mjs';
import { escalate } from '../escalate.mjs';
import {
  measureUsage,
  planPrune,
  executePrune,
  planEmergencyReclaim,
} from '../../resources/budget.mjs';

export const name = 'cx-budget';
export const intervalMs = 15 * 60 * 1000;

function projectRoot() {
  return process.env.CONSTRUCT_PROJECT_ROOT || process.cwd();
}

export async function tick() {
  const actions = [];
  const escalations = [];
  const root = projectRoot();
  const cxDir = join(root, '.cx');
  if (!existsSync(cxDir)) {
    return { actions, escalations, notes: [{ skipped: 'no .cx directory' }] };
  }

  const before = measureUsage(root, process.env);
  if (before.totalCxUsageRatio <= 0.8) {
    return { actions, escalations, notes: [{ usageRatio: before.totalCxUsageRatio }] };
  }

  const planned = planPrune(root, process.env);
  let reclaimed = { removed: [], bytesFreed: 0 };
  if (planned.length) {
    reclaimed = executePrune(planned);
    record({
      kind: 'action',
      watcher: name,
      action: 'prune',
      target: '.cx/',
      summary: `retention prune removed ${reclaimed.removed.length} file(s), freed ${reclaimed.bytesFreed} bytes`,
      context: { planned: planned.length, removed: reclaimed.removed.length },
    });
    actions.push({ type: 'prune', target: '.cx/', removed: reclaimed.removed.length });
  }

  const afterPrune = measureUsage(root, process.env);
  if (afterPrune.totalCxUsageRatio > 1) {
    const emergency = planEmergencyReclaim(root, 0, process.env);
    if (emergency.length) {
      const emergencyResult = executePrune(emergency);
      record({
        kind: 'action',
        watcher: name,
        action: 'emergency-reclaim',
        target: '.cx/traces|.cx/runtime/worker',
        summary: `emergency reclaim removed ${emergencyResult.removed.length} file(s), freed ${emergencyResult.bytesFreed} bytes`,
        context: emergencyResult,
      });
      actions.push({ type: 'emergency-reclaim', removed: emergencyResult.removed.length });
    }
  }

  const after = measureUsage(root, process.env);
  if (after.totalCxUsageRatio > 1) {
    const usedMb = Math.round(after.totalCxBytes / 1024 / 1024);
    const capMb = Math.round(after.totalCxCap / 1024 / 1024);
    const r = await escalate({
      watcher: name,
      eventType: 'service.down',
      summary: `.cx/ still over cap after prune (${usedMb}MB / ${capMb}MB) — raise resources.disk.totalCxMaxMb or delete load-bearing state manually`,
      context: { usageRatio: after.totalCxUsageRatio, usedMb, capMb },
    });
    escalations.push({ eventType: 'service.down', result: r });
  }

  return {
    actions,
    escalations,
    notes: [{
      usageBefore: before.totalCxUsageRatio,
      usageAfter: after.totalCxUsageRatio,
      bytesFreed: reclaimed.bytesFreed,
    }],
  };
}
