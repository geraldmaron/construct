/**
 * lib/engine/consolidate.mjs — sleep-time consolidation for the observation store.
 *
 * Periodically clusters near-duplicate observations by cosine similarity and
 * merges each cluster into a single consolidated insight that records the
 * representative, hit count, member ids, and last-seen timestamp. Optionally
 * summarises clusters via a Compressor plugin (or via any LM the operator
 * wires in) — when no summariser is provided, the representative observation's
 * own summary is kept verbatim.
 *
 * Supersede (the mem0/Letta decision layer): clustering alone left every
 * near-duplicate live, so search returned N restatements of the same fact. The
 * supersede pass keeps only the highest-salience member of a tight cluster live
 * and archives the rest behind a `supersededBy` pointer — salience (the
 * observation's confidence) decides the winner, the newest breaks a tie. The
 * winner becomes the cluster representative, so the kept insight points at the
 * most valuable member rather than the lexically-first one.
 *
 * Outputs:
 *   .cx/observations/consolidated.json    list of insight clusters
 *   .cx/observations/archive/<id>.json    observations demoted to cold archive
 *                                         (superseded members carry supersededBy)
 *
 * The pass is idempotent: re-running it on a stable corpus produces the same
 * cluster set. It is safe to schedule as a cron / launchd job, run in the
 * embed daemon, or invoke ad-hoc as `construct memory consolidate`.
 *
 * Plugin entry points:
 *   `summariser`  - any object with `compress(text, opts)` (Compressor contract)
 *                   that generates a one-line cluster summary from member text.
 */

import fs from 'node:fs';
import path from 'node:path';
import { cosineSimilarity } from '../storage/embeddings.mjs';

const OBS_DIR = '.cx/observations';
const ARCHIVE_DIR = '.cx/observations/archive';
const CONSOLIDATED_FILE = 'consolidated.json';
const VECTORS_FILE = 'vectors.json';
const INDEX_FILE = 'index.json';

const DEFAULTS = {
  similarityThreshold: 0.95,
  archiveAfterDays: 60,
  archiveBelowConfidence: 0.5,
  // Supersede only collapses a member that is a true restatement of the winner,
  // a stricter bar than the cluster-forming threshold: cluster-adjacent is not
  // the same as duplicate.
  supersedeDuplicates: true,
  supersedeThreshold: 0.97,
  maxStored: 5000,
  // Archive retention: keep at most this many archived files, and delete
  // anything older than archiveRetainDays. Both bounds apply.
  archiveRetainDays: 365,
  archiveMaxFiles: 1000,
};

function readJsonOrEmpty(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function readObservation(rootDir, id) {
  const filePath = path.join(rootDir, OBS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  return readJsonOrEmpty(filePath, null);
}

function archiveObservation(rootDir, id, supersededBy = null) {
  const src = path.join(rootDir, OBS_DIR, `${id}.json`);
  if (!fs.existsSync(src)) return false;
  const archiveDir = path.join(rootDir, ARCHIVE_DIR);
  fs.mkdirSync(archiveDir, { recursive: true });
  const dest = path.join(archiveDir, `${id}.json`);

  // A superseded member records what replaced it before leaving the live store,
  // so the archive stays auditable and a future undo knows the winner.
  if (supersededBy) {
    const record = readJsonOrEmpty(src, null);
    if (record) {
      record.supersededBy = supersededBy;
      record.supersededAt = new Date().toISOString();
      fs.writeFileSync(dest, JSON.stringify(record, null, 2) + '\n');
      fs.unlinkSync(src);
      return true;
    }
  }
  fs.renameSync(src, dest);
  return true;
}

function daysAgo(dateStr) {
  if (!dateStr) return Infinity;
  return (Date.now() - new Date(dateStr).getTime()) / (24 * 60 * 60 * 1000);
}

// The winner of a near-duplicate cluster is the member worth keeping live:
// highest salience (confidence) first, then the most recent restatement, then a
// stable id tiebreak so the choice is deterministic across runs.
function rankForSupersede(a, b) {
  const conf = (b.confidence || 0) - (a.confidence || 0);
  if (conf !== 0) return conf;
  const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  if (bt !== at) return bt - at;
  return String(a.id).localeCompare(String(b.id));
}

/**
 * Greedy single-pass clustering. Each observation is added to the existing
 * cluster whose centroid has highest cosine similarity, provided that
 * similarity exceeds `threshold`. Otherwise a new cluster is opened. The
 * centroid is recomputed as a running mean as members join.
 *
 * Stable across runs because the input is sorted by id before clustering.
 */
function greedyCluster(records, threshold) {
  const sorted = [...records].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const clusters = [];

  for (const record of sorted) {
    if (!record.embedding || record.embedding.length === 0) {
      clusters.push({
        centroid: [],
        members: [record],
      });
      continue;
    }
    let bestIdx = -1;
    let bestSim = threshold;
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      if (cluster.centroid.length !== record.embedding.length) continue;
      const sim = cosineSimilarity(record.embedding, cluster.centroid);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      const cluster = clusters[bestIdx];
      const n = cluster.members.length;
      const next = new Array(record.embedding.length);
      for (let j = 0; j < record.embedding.length; j++) {
        next[j] = (cluster.centroid[j] * n + record.embedding[j]) / (n + 1);
      }
      cluster.centroid = next;
      cluster.members.push(record);
    } else {
      clusters.push({
        centroid: [...record.embedding],
        members: [record],
      });
    }
  }

  return clusters;
}

async function buildSummary(cluster, summariser) {
  const representative = cluster.members[0];
  const baseText = representative?.summary || representative?.content || '';
  if (!summariser || typeof summariser.compress !== 'function') return baseText;
  try {
    const merged = cluster.members
      .map((m) => m?.summary || m?.content || '')
      .filter(Boolean)
      .join(' ');
    return await summariser.compress(merged, { ratio: 0.4, maxTokens: 60 });
  } catch {
    return baseText;
  }
}

/**
 * Run a consolidation pass against a project root.
 *
 * @param {string} rootDir
 * @param {object} [opts]
 * @param {number} [opts.similarityThreshold=0.95]
 * @param {number} [opts.archiveAfterDays=60]
 * @param {number} [opts.archiveBelowConfidence=0.5]
 * @param {boolean} [opts.supersedeDuplicates=true] - archive tight restatements, keeping the highest-salience member live
 * @param {number} [opts.supersedeThreshold=0.97] - cosine bar a member must clear against the winner to be superseded
 * @param {number} [opts.maxStored=5000]
 * @param {object} [opts.summariser] - Compressor-shaped plugin
 * @returns {Promise<{ clustersBefore: number, clusters: number, archived: string[], superseded: Array<{id: string, supersededBy: string}>, stored: number }>}
 */
export async function consolidate(rootDir, opts = {}) {
  const settings = { ...DEFAULTS, ...opts };
  const obsRoot = path.join(rootDir, OBS_DIR);
  if (!fs.existsSync(obsRoot)) {
    return { clustersBefore: 0, clusters: 0, archived: [], stored: 0 };
  }

  const vectorsPath = path.join(obsRoot, VECTORS_FILE);
  const vectors = readJsonOrEmpty(vectorsPath, []);
  const records = vectors.map((v) => {
    const full = readObservation(rootDir, v.id);
    if (!full) return null;
    return {
      id: v.id,
      embedding: v.embedding || [],
      summary: full.summary || '',
      content: full.content || '',
      tags: full.tags || [],
      role: full.role || null,
      category: full.category || null,
      confidence: typeof full.confidence === 'number' ? full.confidence : 0.8,
      createdAt: full.createdAt || null,
    };
  }).filter(Boolean);

  const clustersBefore = records.length;

  const archived = [];
  const liveRecords = records.filter((r) => {
    const old = daysAgo(r.createdAt) > settings.archiveAfterDays;
    const lowConfidence = r.confidence < settings.archiveBelowConfidence;
    if (old && lowConfidence) {
      if (archiveObservation(rootDir, r.id)) archived.push(r.id);
      return false;
    }
    return true;
  });

  const clusters = greedyCluster(liveRecords, settings.similarityThreshold);

  // Supersede tight restatements: rank each multi-member cluster by salience so
  // the winner leads (it becomes the representative), then archive any member
  // that duplicates the winner closely enough to be the same fact.
  const superseded = [];
  if (settings.supersedeDuplicates) {
    for (const cluster of clusters) {
      if (cluster.members.length < 2) continue;
      cluster.members.sort(rankForSupersede);
      const winner = cluster.members[0];
      cluster.supersededIds = [];
      for (const loser of cluster.members.slice(1)) {
        const tight = winner.embedding?.length && loser.embedding?.length &&
          cosineSimilarity(winner.embedding, loser.embedding) >= settings.supersedeThreshold;
        if (!tight) continue;
        if (archiveObservation(rootDir, loser.id, winner.id)) {
          archived.push(loser.id);
          superseded.push({ id: loser.id, supersededBy: winner.id });
          cluster.supersededIds.push(loser.id);
        }
      }
    }
  }

  const consolidated = [];
  for (const cluster of clusters) {
    const representative = cluster.members[0];
    const summary = await buildSummary(cluster, settings.summariser);
    const lastSeen = cluster.members.reduce((acc, m) => {
      if (!m.createdAt) return acc;
      return acc && new Date(acc) > new Date(m.createdAt) ? acc : m.createdAt;
    }, null);
    consolidated.push({
      id: `consolidated:${representative.id}`,
      representativeId: representative.id,
      hitCount: cluster.members.length,
      summary,
      role: representative.role,
      category: representative.category,
      tags: [...new Set(cluster.members.flatMap((m) => m.tags || []))].slice(0, 10),
      memberIds: cluster.members.map((m) => m.id),
      supersededIds: cluster.supersededIds || [],
      avgConfidence:
        cluster.members.reduce((acc, m) => acc + (m.confidence || 0), 0) /
        Math.max(cluster.members.length, 1),
      lastSeen,
    });
  }

  consolidated.sort((a, b) => (b.hitCount - a.hitCount) || (a.id < b.id ? -1 : 1));

  if (consolidated.length > settings.maxStored) {
    const dropped = consolidated.slice(settings.maxStored);
    for (const insight of dropped) {
      for (const memberId of insight.memberIds) {
        if (archiveObservation(rootDir, memberId)) archived.push(memberId);
      }
    }
    consolidated.length = settings.maxStored;
  }

  fs.mkdirSync(obsRoot, { recursive: true });
  fs.writeFileSync(
    path.join(obsRoot, CONSOLIDATED_FILE),
    JSON.stringify(consolidated, null, 2) + '\n'
  );

  if (archived.length > 0) {
    const indexPath = path.join(obsRoot, INDEX_FILE);
    const index = readJsonOrEmpty(indexPath, []);
    const archivedSet = new Set(archived);
    const filtered = index.filter((entry) => !archivedSet.has(entry.id));
    if (filtered.length !== index.length) {
      fs.writeFileSync(indexPath, JSON.stringify(filtered, null, 2) + '\n');
    }
  }

  const archivePruned = pruneArchive(rootDir, settings);

  return {
    clustersBefore,
    clusters: consolidated.length,
    archived,
    superseded,
    archivePruned,
    stored: consolidated.length,
  };
}

// Prune the cold archive directory: delete files older than archiveRetainDays,
// then keep at most archiveMaxFiles by mtime descending. Returns number deleted.
export function pruneArchive(rootDir, opts = {}) {
  const settings = { ...DEFAULTS, ...opts };
  const archiveDir = path.join(rootDir, ARCHIVE_DIR);
  if (!fs.existsSync(archiveDir)) return 0;

  const cutoffMs = Date.now() - settings.archiveRetainDays * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(archiveDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const full = path.join(archiveDir, f);
      const stat = fs.statSync(full);
      return { name: f, path: full, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  let deleted = 0;
  const kept = [];
  for (const file of files) {
    if (file.mtime < cutoffMs) {
      try { fs.unlinkSync(file.path); deleted += 1; } catch { /* best effort */ }
    } else {
      kept.push(file);
    }
  }
  if (kept.length > settings.archiveMaxFiles) {
    for (const file of kept.slice(settings.archiveMaxFiles)) {
      try { fs.unlinkSync(file.path); deleted += 1; } catch { /* best effort */ }
    }
  }
  return deleted;
}
