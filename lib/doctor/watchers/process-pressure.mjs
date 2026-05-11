/**
 * lib/doctor/watchers/process-pressure.mjs — continuous process pressure guard.
 *
 * Runs the existing runtime-pressure cleanup on a recurring tick instead of
 * only at `construct up` start. Any killed process is recorded; if the same
 * service-class has been killed >=2 times in the last hour, escalates so
 * cx-sre can investigate the underlying churn.
 *
 * Tick: 60s.
 */

import { record, recent } from '../audit.mjs';
import { escalate } from '../escalate.mjs';
import { runPressureRelease } from '../../runtime-pressure.mjs';

export const name = 'process-pressure';
export const intervalMs = 60 * 1000;

export async function tick() {
  const actions = [];
  const escalations = [];

  const report = runPressureRelease({ env: process.env });

  if (Array.isArray(report?.killed) && report.killed.length > 0) {
    for (const proc of report.killed) {
      record({
        kind: 'action',
        watcher: name,
        action: 'kill',
        target: proc.command || proc.pid || 'unknown',
        summary: `killed stale process ${proc.command || ''} (pid ${proc.pid || '?'}, ${proc.reason || 'pressure rule'})`,
        context: proc,
      });
      actions.push({ type: 'kill', target: proc.command || proc.pid });
    }

    const hourAgo = Date.now() - 60 * 60 * 1000;
    const recentKills = recent({ watcher: name, kind: 'action', since: hourAgo, limit: 50 })
      .filter((e) => e.action === 'kill');
    const byClass = {};
    for (const k of recentKills) {
      const cls = String(k.target || '').split(/[\s/]/)[0] || 'unknown';
      byClass[cls] = (byClass[cls] || 0) + 1;
    }
    for (const [cls, count] of Object.entries(byClass)) {
      if (count >= 2) {
        const r = await escalate({
          watcher: name,
          eventType: 'service.down',
          summary: `${cls} killed ${count} times in last hour — repeated pressure churn`,
          context: { class: cls, killCount: count, report },
        });
        escalations.push({ eventType: 'service.down', class: cls, result: r });
      }
    }
  }

  return { actions, escalations, notes: [{ pressureTriggered: !!report?.pressureTriggered, killed: report?.killed?.length || 0 }] };
}
