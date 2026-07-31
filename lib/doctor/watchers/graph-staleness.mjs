/**
 * lib/doctor/watchers/graph-staleness.mjs — dependency graph freshness watcher.
 *
 * Ticks every 30 minutes. When registry/contracts/workflow seeds changed since
 * the last `construct graph build`, records an audit entry so doctor surfaces
 * stale-graph drift without waiting for the next Oracle tick.
 *
 * Also drains the relational graph store's transactional outbox
 * when one exists, before the staleness check — one of
 * the design's named applier-trigger surfaces (design doc §4). When the
 * post-drain trust decision (lib/graph/relational/reconcile.mjs) says
 * incremental state should not be trusted (a dead-lettered event, a source
 * that drifted with no matching outbox delta, an applied-log gap), records a
 * `graph-incremental-untrusted` action so doctor surfaces the need for
 * `construct graph reconcile` without waiting for a user to notice.
 */

import { existsSync } from 'node:fs';

import { record } from '../audit.mjs';
import { checkGraphStaleness, computeSourceHashes } from '../../graph/staleness.mjs';
import { isConstructPackageRepo } from '../../host-disposition.mjs';
import { configPath } from '../../config-dir.mjs';
import { sqliteAvailable, graphDbExists } from '../../graph/relational/sqlite-db.mjs';
import { drainOutbox, outboxState } from '../../graph/relational/outbox.mjs';
import { computeTrustDecision } from '../../graph/relational/reconcile.mjs';

export const name = 'graph-staleness';
export const intervalMs = 30 * 60 * 1000;

function projectRoot() {
  return process.env.CONSTRUCT_PROJECT_ROOT || process.cwd();
}

function drainAndCheckTrust(root) {
  if (!(sqliteAvailable() && graphDbExists(root))) return null;
  try {
    const drain = drainOutbox(root);
    const trust = computeTrustDecision(root, { freshSourceHashes: computeSourceHashes(root) });
    return { drain, trust };
  } catch {
    return null;
  }
}

export async function tick() {
  const actions = [];
  const escalations = [];
  const root = projectRoot();
  const graphDir = configPath(root, 'graph');
  const relationalPresent = sqliteAvailable() && graphDbExists(root);

  if (!existsSync(graphDir) && !isConstructPackageRepo(root) && !relationalPresent) {
    return { actions, escalations, notes: [{ skipped: 'no graph and not construct package repo' }] };
  }

  const incremental = drainAndCheckTrust(root);
  if (incremental && !incremental.trust.trustIncremental) {
    record({
      kind: 'action',
      watcher: name,
      action: 'graph-incremental-untrusted',
      target: '.construct/graph/',
      summary: incremental.trust.reasons.join('; '),
      context: { outbox: outboxState(root) },
    });
    actions.push({ type: 'graph-incremental-untrusted', target: '.construct/graph/' });
  }

  const state = checkGraphStaleness(root);
  if (!state.present) {
    return { actions, escalations, notes: [{ present: false }, ...(incremental ? [{ incremental }] : [])] };
  }
  if (!state.stale) {
    return { actions, escalations, notes: [{ present: true, stale: false }, ...(incremental ? [{ incremental }] : [])] };
  }

  record({
    kind: 'action',
    watcher: name,
    action: 'graph-stale',
    target: '.construct/graph/',
    summary: state.staleReason,
    context: { storedHash: state.storedHash, currentHash: state.currentHash },
  });
  actions.push({ type: 'graph-stale', target: '.construct/graph/' });

  return { actions, escalations, notes: [state, ...(incremental ? [{ incremental }] : [])] };
}
