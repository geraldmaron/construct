/**
 * lib/graph/history.mjs — append-only graph build snapshots and historical queries.
 *
 * Each full `writeGraph` archives the previous JSONL snapshot under
 * `.construct/graph/history/<generatedAt>/` before overwrite. Incremental edits
 * (lib/graph/incremental.mjs) mutate live state without creating history entries;
 * only full rebuilds are history-granular.
 *
 * Query helpers answer retrospective questions against retained snapshots plus the
 * live graph's tombstone, alias, and merge/release evidence edges. Compaction
 * prunes old full snapshots only; provenance nodes and evidence edges in the
 * live graph are never removed.
 */

import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, copyFileSync,
} from 'node:fs';
import path from 'node:path';
import { graphDir, loadGraph } from './store.mjs';

const HISTORY_DIR = 'history';
export const DEFAULT_MAX_SNAPSHOTS = 10;
export const MIN_RETAINED_SNAPSHOTS = 2;

const PROVENANCE_EDGE_RELS = new Set(['merged_in', 'released_in']);

export function historyRoot(rootDir, targetId = null) {
  return path.join(graphDir(rootDir, targetId), HISTORY_DIR);
}

function snapshotDirName(generatedAt) {
  return String(generatedAt).replace(/[:.]/g, '-');
}

function readJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  const out = [];
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip malformed line */ }
  }
  return out;
}

function loadSnapshotFromDir(dir) {
  const metaPath = path.join(dir, 'meta.json');
  let meta = null;
  try { meta = JSON.parse(readFileSync(metaPath, 'utf8')); } catch { /* no meta */ }
  return {
    dir,
    generatedAt: meta?.generatedAt || null,
    nodes: readJsonl(path.join(dir, 'nodes.jsonl')),
    edges: readJsonl(path.join(dir, 'edges.jsonl')),
    meta,
  };
}

/**
 * Archive the current JSONL graph files before a full overwrite. No-op when no
 * prior graph exists or the snapshot for that generatedAt is already present.
 */
export function archiveGraphBeforeWrite(rootDir, { targetId = null } = {}) {
  const dir = graphDir(rootDir, targetId);
  const nodesFile = path.join(dir, 'nodes.jsonl');
  if (!existsSync(nodesFile)) return { archived: false, reason: 'no-prior-graph' };

  let generatedAt;
  try {
    const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    generatedAt = meta.generatedAt || new Date().toISOString();
  } catch {
    generatedAt = new Date().toISOString();
  }

  const snapDir = path.join(historyRoot(rootDir, targetId), snapshotDirName(generatedAt));
  if (existsSync(snapDir)) return { archived: false, reason: 'snapshot-exists', generatedAt, dir: snapDir };

  mkdirSync(snapDir, { recursive: true });
  for (const name of ['nodes.jsonl', 'edges.jsonl', 'meta.json']) {
    const src = path.join(dir, name);
    if (existsSync(src)) copyFileSync(src, path.join(snapDir, name));
  }
  return { archived: true, generatedAt, dir: snapDir };
}

/**
 * @returns {{ generatedAt: string, dir: string }[]}
 */
export function listSnapshots(rootDir, { targetId = null } = {}) {
  const root = historyRoot(rootDir, targetId);
  if (!existsSync(root)) return [];
  const out = [];
  for (const name of readdirSync(root, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const dir = path.join(root, name.name);
    const snap = loadSnapshotFromDir(dir);
    if (snap.generatedAt) out.push({ generatedAt: snap.generatedAt, dir });
  }
  return out.sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt));
}

export function earliestSnapshotDate(rootDir, { targetId = null } = {}) {
  const snaps = listSnapshots(rootDir, { targetId });
  return snaps[0]?.generatedAt || null;
}

export function graphAtTime(rootDir, timestamp, { targetId = null } = {}) {
  const targetMs = Date.parse(timestamp);
  const live = loadGraph(rootDir, { targetId });
  if (live.exists && live.meta?.generatedAt) {
    const liveMs = Date.parse(live.meta.generatedAt);
    if (targetMs >= liveMs) {
      return {
        ok: true,
        generatedAt: live.meta.generatedAt,
        nodes: [...live.nodes.values()],
        edges: live.edges,
        meta: live.meta,
        source: 'live',
      };
    }
  }

  const snaps = listSnapshots(rootDir, { targetId });
  if (snaps.length === 0) {
    return {
      ok: false,
      reason: 'no-history',
      message: `no history available before ${timestamp}`,
    };
  }
  const eligible = snaps.filter((s) => Date.parse(s.generatedAt) <= targetMs);
  if (eligible.length === 0) {
    return {
      ok: false,
      reason: 'no-history',
      message: `no history available before ${timestamp}`,
      earliestAvailable: snaps[0].generatedAt,
    };
  }
  const snap = loadSnapshotFromDir(eligible[eligible.length - 1].dir);
  return {
    ok: true,
    generatedAt: snap.generatedAt,
    nodes: snap.nodes,
    edges: snap.edges,
    meta: snap.meta,
    source: 'snapshot',
  };
}

function edgeKey(e) {
  return `${e.from}|${e.rel}|${e.to}`;
}

function findReplacementInNodes(nodeId, nodes) {
  for (const n of nodes) {
    if (n.id === nodeId && n.type === 'tombstone' && n.attrs?.supersededBy) {
      return { replacedBy: n.attrs.supersededBy, via: 'tombstone' };
    }
    const aliases = n.attrs?.aliases || [];
    if (aliases.includes(nodeId)) {
      return { replacedBy: n.id, via: 'alias' };
    }
  }
  return null;
}

export function whatReplaced(rootDir, nodeId, { targetId = null } = {}) {
  const live = loadGraph(rootDir, { targetId });
  const liveHit = findReplacementInNodes(nodeId, [...live.nodes.values()]);
  if (liveHit) return { ok: true, nodeId, ...liveHit };

  for (const snap of [...listSnapshots(rootDir, { targetId })].reverse()) {
    const loaded = loadSnapshotFromDir(snap.dir);
    const hit = findReplacementInNodes(nodeId, loaded.nodes);
    if (hit) return { ok: true, nodeId, ...hit, snapshotAt: loaded.generatedAt };
  }

  return { ok: true, nodeId, replacedBy: null, via: null };
}

function activeNodeIds(nodes) {
  return new Set(nodes.filter((n) => n.type !== 'tombstone').map((n) => n.id));
}

function tombstoneTargets(nodes) {
  const out = new Map();
  for (const n of nodes) {
    if (n.type === 'tombstone' && n.attrs?.supersededBy) out.set(n.id, n.attrs.supersededBy);
  }
  return out;
}

export function whatChangedBetween(rootDir, t1, t2, { targetId = null } = {}) {
  const left = graphAtTime(rootDir, t1, { targetId });
  const right = graphAtTime(rootDir, t2, { targetId });
  if (!left.ok) return left;
  if (!right.ok) return right;

  const ids1 = activeNodeIds(left.nodes);
  const ids2 = activeNodeIds(right.nodes);
  const rightTombstones = tombstoneTargets(right.nodes);
  const changes = [];
  const renamedTargets = new Set();

  for (const id of ids1) {
    if (ids2.has(id)) continue;
    const replacedBy = rightTombstones.get(id) || whatReplaced(rootDir, id, { targetId }).replacedBy;
    if (replacedBy && ids2.has(replacedBy)) {
      changes.push({ kind: 'renamed', from: id, to: replacedBy, via: rightTombstones.has(id) ? 'tombstone' : 'alias' });
      renamedTargets.add(replacedBy);
    } else {
      changes.push({ kind: 'removed', id });
    }
  }

  for (const id of ids2) {
    if (ids1.has(id) || renamedTargets.has(id)) continue;
    changes.push({ kind: 'added', id });
  }

  const edges1 = new Set(left.edges.map(edgeKey));
  const edges2 = new Set(right.edges.map(edgeKey));
  const edgeChanges = [];
  for (const key of edges1) {
    if (!edges2.has(key)) edgeChanges.push({ kind: 'removed', edge: key });
  }
  for (const key of edges2) {
    if (!edges1.has(key)) edgeChanges.push({ kind: 'added', edge: key });
  }

  return {
    ok: true,
    from: left.generatedAt,
    to: right.generatedAt,
    changes,
    edgeChanges,
  };
}

export function whichReleaseRemoved(rootDir, nodeId, { targetId = null } = {}) {
  const graph = loadGraph(rootDir, { targetId });
  const matches = graph.edges.filter((e) => e.rel === 'released_in' && e.to === nodeId);
  if (matches.length === 0) {
    return { ok: true, nodeId, release: null };
  }

  let best = null;
  for (const edge of matches) {
    const releaseNode = graph.nodes.get(edge.from);
    const tag = releaseNode?.attrs?.tag
      || (releaseNode?.name?.startsWith('release:') ? releaseNode.name.slice('release:'.length) : null)
      || releaseNode?.name
      || edge.from;
    const timestamp = releaseNode?.attrs?.timestamp || '';
    if (!best || String(timestamp) > String(best.timestamp)) {
      best = { tag, timestamp, evidenceId: edge.from };
    }
  }
  return { ok: true, nodeId, release: best?.tag || null, evidence: best };
}

export function provenanceFingerprint(graph) {
  const tombstones = [...graph.nodes.values()]
    .filter((n) => n.type === 'tombstone')
    .map((n) => ({ id: n.id, supersededBy: n.attrs?.supersededBy || null, removedByRelease: n.attrs?.removedByRelease || null }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const aliases = [...graph.nodes.values()]
    .filter((n) => (n.attrs?.aliases || []).length > 0)
    .map((n) => ({ id: n.id, aliases: [...(n.attrs?.aliases || [])].sort() }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const evidenceEdges = graph.edges
    .filter((e) => PROVENANCE_EDGE_RELS.has(e.rel))
    .map((e) => edgeKey(e))
    .sort();
  return JSON.stringify({ tombstones, aliases, evidenceEdges });
}

/**
 * Drop oldest full-graph snapshots beyond the retention cap. Live-graph
 * tombstones, aliases, and merge/release evidence edges are untouched.
 */
export function compactHistory(rootDir, { maxSnapshots = DEFAULT_MAX_SNAPSHOTS, targetId = null } = {}) {
  const graph = loadGraph(rootDir, { targetId });
  const before = provenanceFingerprint(graph);
  const snaps = listSnapshots(rootDir, { targetId });
  const keep = Math.max(MIN_RETAINED_SNAPSHOTS, maxSnapshots);
  if (snaps.length <= keep) {
    return { ok: true, pruned: 0, retained: snaps.length, provenancePreserved: true, fingerprint: before };
  }

  const sorted = [...snaps].sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt));
  const prune = sorted.slice(0, sorted.length - keep);
  for (const snap of prune) {
    rmSync(snap.dir, { recursive: true, force: true });
  }

  const afterGraph = loadGraph(rootDir, { targetId });
  const after = provenanceFingerprint(afterGraph);
  return {
    ok: true,
    pruned: prune.length,
    retained: keep,
    provenancePreserved: before === after,
    fingerprintBefore: before,
    fingerprintAfter: after,
  };
}
