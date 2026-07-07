/**
 * lib/doctor/watchers/graph-staleness.mjs — dependency graph freshness watcher.
 *
 * Ticks every 30 minutes. When registry/contracts/workflow seeds changed since
 * the last `construct matrix build`, records an audit entry so doctor surfaces
 * stale-graph drift without waiting for the next Oracle tick.
 */

import { existsSync } from 'node:fs';

import { record } from '../audit.mjs';
import { checkGraphStaleness } from '../../graph/staleness.mjs';
import { isConstructPackageRepo } from '../../host-disposition.mjs';
import { configPath } from '../../config-dir.mjs';

export const name = 'graph-staleness';
export const intervalMs = 30 * 60 * 1000;

function projectRoot() {
  return process.env.CONSTRUCT_PROJECT_ROOT || process.cwd();
}

export async function tick() {
  const actions = [];
  const escalations = [];
  const root = projectRoot();
  const graphDir = configPath(root, 'graph');

  if (!existsSync(graphDir) && !isConstructPackageRepo(root)) {
    return { actions, escalations, notes: [{ skipped: 'no graph and not construct package repo' }] };
  }

  const state = checkGraphStaleness(root);
  if (!state.present) {
    return { actions, escalations, notes: [{ present: false }] };
  }
  if (!state.stale) {
    return { actions, escalations, notes: [{ present: true, stale: false }] };
  }

  record({
    kind: 'action',
    watcher: name,
    action: 'graph-stale',
    target: '.cx/graph/',
    summary: state.staleReason,
    context: { storedHash: state.storedHash, currentHash: state.currentHash },
  });
  actions.push({ type: 'graph-stale', target: '.cx/graph/' });

  return { actions, escalations, notes: [state] };
}
