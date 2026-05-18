/**
 * lib/doctor/watchers/handoffs.mjs — periodic handoff cleanup tick.
 *
 * Runs `autoCleanHandoffs` against the project root on a 30-min schedule.
 * Resolved handoffs older than `handoffsMaxDays` move to .cx/handoffs/archive/;
 * archived handoffs older than 2× retention get deleted. Live handoffs are
 * never touched — open work is sacred. Each tick records a one-line audit
 * entry so the doctor log shows what was done and why.
 */

import { record } from '../audit.mjs';
import { autoCleanHandoffs } from '../../handoffs/cleanup.mjs';

export const name = 'handoffs';
export const intervalMs = 30 * 60 * 1000;

export async function tick() {
  try {
    const { result } = autoCleanHandoffs(process.cwd(), process.env);
    if (result.moved.length === 0 && result.deleted.length === 0 && (result.warnings || []).length === 0) {
      return;
    }
    record({
      watcher: name,
      event: 'cleanup',
      moved: result.moved.map((a) => ({ from: a.from, to: a.to, bytes: a.bytes, reason: a.reason })),
      deleted: result.deleted.map((a) => ({ path: a.path, bytes: a.bytes, reason: a.reason })),
      warnings: result.warnings || [],
    });
  } catch (err) {
    record({ watcher: name, event: 'error', message: err?.message || 'unknown' });
  }
}
