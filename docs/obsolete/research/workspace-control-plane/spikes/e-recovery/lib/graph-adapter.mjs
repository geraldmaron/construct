/**
 * lib/graph-adapter.mjs (spike e-recovery) — thin wrapper over the real
 * relational graph store (lib/graph/relational/, construct-b0nny.3) for the
 * harness's graph_update stage and the final reconciliation check.
 *
 * Isolation follows the exact pattern tests/functional/graph-relational-
 * store.functional.test.mjs already established: CX_HOME_OVERRIDE (+ HOME)
 * pointed at a scratch directory so graphDbPath's machine-scoped state root
 * (~/.construct/projects/<key>/graph/graph.db) never touches the real
 * project's graph, keyed off a scratch PROJECT dir with no git remote. The
 * harness runs as a child process, so these env vars are set by the driver
 * before spawning it — this module just imports the real store modules by
 * absolute path from the repo root.
 *
 * graph_update stage uses enqueueOutboxEvent + drainOutbox — the identical
 * code path `construct graph update` runs — because that is what a real
 * workflow's graph-update stage would do (declare an incremental delta, not
 * rebuild the whole graph). The reconciliation check uses reconcileGraph
 * with the workflow's own declared node/edge set as the "fresh" side: a full
 * rebuild-from-repo-source fresh seed (what `construct graph reconcile`
 * normally diffs against) isn't meaningful against a synthetic sandbox with
 * no real repo to scan, so this reconciles the workflow's own authoritative
 * declaration against live state instead — the same reconcileGraph function,
 * a scoped fresh-seed. computeTrustDecision is also exposed, unmodified,
 * for the outbox-drained / no-dead-letter / no-gap consistency proof.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = process.env.SPIKE_E_REPO_ROOT;
if (!REPO_ROOT) throw new Error('graph-adapter.mjs requires SPIKE_E_REPO_ROOT in the environment');

function repoImport(relPath) {
  return import(pathToFileURL(path.join(REPO_ROOT, relPath)).href);
}

const { enqueueOutboxEvent, drainOutbox, outboxState } = await repoImport('lib/graph/relational/outbox.mjs');
const { reconcileGraph, computeTrustDecision } = await repoImport('lib/graph/relational/reconcile.mjs');
const { loadGraph } = await repoImport('lib/graph/relational/sqlite-store.mjs');
const { sqliteAvailable } = await repoImport('lib/graph/relational/sqlite-db.mjs');

export { sqliteAvailable, outboxState, computeTrustDecision, loadGraph };

/**
 * Declare the work/artifact/edge triple for one run as outbox deltas and
 * drain them — the real incremental-update path.
 */
export function applyGraphDelta(rootDir, { workId, artifactId, artifactHash, runId }) {
  enqueueOutboxEvent(rootDir, {
    eventType: 'node_upsert',
    payload: { id: workId, type: 'work', name: workId, attrs: {} },
    origin: 'spike-e-recovery',
    declared: true,
  });
  enqueueOutboxEvent(rootDir, {
    eventType: 'node_upsert',
    payload: { id: artifactId, type: 'artifact', name: artifactId, attrs: { hash: artifactHash, runId } },
    origin: 'spike-e-recovery',
    declared: true,
  });
  enqueueOutboxEvent(rootDir, {
    eventType: 'edge_upsert',
    payload: { from: workId, to: artifactId, rel: 'produces' },
    origin: 'spike-e-recovery',
    declared: true,
  });
  return drainOutbox(rootDir);
}

/**
 * Build the exact node/edge set graph_update declares for one run — used
 * both to seed the outbox (applyGraphDelta, indirectly) and as the "fresh"
 * side of the reconciliation diff, so reconcile can prove "what this
 * workflow believes it wrote" matches "what live state actually holds".
 */
export function ownFreshSeed({ workId, artifactId, artifactHash, runId }) {
  return {
    nodes: [
      { id: workId, type: 'work', name: workId, attrs: {} },
      { id: artifactId, type: 'artifact', name: artifactId, attrs: { hash: artifactHash, runId } },
    ],
    edges: [
      { from: workId, to: artifactId, rel: 'produces' },
    ],
  };
}

export function reconcileOwnSeed(rootDir, seed) {
  return reconcileGraph(rootDir, seed);
}
