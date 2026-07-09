/**
 * lib/doctor/watchers/source-targets.mjs — registered source-target health watcher.
 *
 * Ticks hourly. Reuses lib/doctor/source-target-health.mjs (filesystem + env
 * only, zero outbound fetch) to surface directory targets whose path vanished
 * and corpus caches past their TTL, recording an audit action per hard problem
 * so doctor reports source-target drift between Oracle ticks. A project with no
 * registered targets returns a silent pass (no noise).
 */

import { record } from '../audit.mjs';
import { checkSourceTargetHealth } from '../source-target-health.mjs';

export const name = 'source-targets';
export const intervalMs = 60 * 60 * 1000;

function projectRoot() {
  return process.env.CONSTRUCT_PROJECT_ROOT || process.cwd();
}

export async function tick() {
  const actions = [];
  const escalations = [];
  const root = projectRoot();

  const { configured, findings } = checkSourceTargetHealth({ cwd: root });
  if (!configured) {
    return { actions, escalations, notes: [{ configured: 0 }] };
  }

  const problems = findings.filter((f) => !f.ok && !f.optional);
  for (const problem of problems) {
    record({
      kind: 'action',
      watcher: name,
      action: 'source-target-unhealthy',
      target: 'sources.targets',
      summary: problem.label,
    });
    actions.push({ type: 'source-target-unhealthy', target: 'sources.targets' });
  }

  return { actions, escalations, notes: [{ configured, problems: problems.length }] };
}
