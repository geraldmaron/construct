/**
 * lib/knowledge/graph.mjs — GraphRAG-style entity index + global query.
 *
 * Phase C9 foundations:
 *   - buildGraph(rootDir): derive nodes + edges from `.cx/observations/entities.json`.
 *   - detectCommunities(graph): pure-JS label propagation. Deterministic
 *     (sorted neighbor scan, lowest-id tiebreak). O(V+E) per iteration.
 *   - summarizeCommunity(community, entities): extractive summary over the
 *     member entities, ranked by degree centrality. Requires no LLM call,
 *     so the primitive works in solo mode without a provider configured.
 *   - askGlobal({ query, rootDir }): rank communities by overlap with the
 *     query terms + their members' search text, return the top communities
 *     with member entities and the question they best answer.
 *
 * Full Leiden (modularity optimization + refinement) would need an external
 * graph library and is blocked by ADR-0001 (zero-npm-core). Label propagation
 * is the deterministic alternative. Produces useful coarse communities on
 * the small graphs Construct sessions accumulate (typically <500 entities).
 * Swap implementations later by replacing `detectCommunities` only.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { rankByBm25 } from '../storage/embeddings.mjs';

const OBS_DIR = '.cx/observations';
const ENTITIES_FILE = 'entities.json';

const MAX_LP_ITERATIONS = 30;
const MAX_COMMUNITY_TOP_TERMS = 8;
const MIN_COMMUNITY_SIZE = 2;

function readEntities(rootDir) {
  const p = path.join(rootDir, OBS_DIR, ENTITIES_FILE);
  if (!existsSync(p)) return [];
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return []; }
}

/**
 * Build an undirected graph from the entity store. Nodes are entity names;
 * edges come from `relatedEntities[]`. Returns:
 *   { nodes: Map<name, entity>, adj: Map<name, Set<name>> }
 */
export function buildGraph(rootDir) {
  const entities = readEntities(rootDir);
  const nodes = new Map();
  const adj = new Map();
  for (const e of entities) {
    if (!e?.name) continue;
    nodes.set(e.name, e);
    if (!adj.has(e.name)) adj.set(e.name, new Set());
  }
  for (const e of entities) {
    if (!e?.name) continue;
    for (const other of e.relatedEntities || []) {
      if (!nodes.has(other)) continue;
      adj.get(e.name).add(other);
      adj.get(other).add(e.name);
    }
  }
  return { nodes, adj };
}

/**
 * Run synchronous label propagation. Each node starts with its own label;
 * iteratively adopt the most frequent label among neighbors, with a sorted
 * neighbor scan and lowest-id tiebreak so the result is deterministic.
 *
 * Returns: Map<name, communityId> plus a stable grouping.
 */
export function detectCommunities(graph) {
  const labels = new Map();
  const sortedNodes = [...graph.nodes.keys()].sort();
  for (const n of sortedNodes) labels.set(n, n);

  for (let iter = 0; iter < MAX_LP_ITERATIONS; iter++) {
    let changed = false;
    for (const node of sortedNodes) {
      const neighbors = [...(graph.adj.get(node) || [])].sort();
      if (neighbors.length === 0) continue;

      const counts = new Map();
      for (const nb of neighbors) {
        const lbl = labels.get(nb);
        counts.set(lbl, (counts.get(lbl) || 0) + 1);
      }

      // highest-count label, lowest-id tiebreak
      let bestLabel = labels.get(node);
      let bestCount = -1;
      const sortedLabels = [...counts.entries()].sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0] < b[0] ? -1 : 1;
      });
      if (sortedLabels.length > 0) {
        [bestLabel, bestCount] = sortedLabels[0];
      }

      if (bestCount > 0 && bestLabel !== labels.get(node)) {
        labels.set(node, bestLabel);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const communities = new Map();
  for (const [node, label] of labels) {
    if (!communities.has(label)) communities.set(label, []);
    communities.get(label).push(node);
  }
  // Stable order: by size desc, then alphabetical on canonical label
  const grouped = [...communities.entries()]
    .map(([id, members]) => ({ id, members: members.sort() }))
    .sort((a, b) => {
      if (b.members.length !== a.members.length) return b.members.length - a.members.length;
      return a.id < b.id ? -1 : 1;
    });
  return { labels, communities: grouped };
}

/**
 * Extractive community summary. Picks the top-N members by intra-community
 * degree (the "central" nodes of the cluster) and harvests their summaries
 * into a short text block. Deterministic and dependency-free.
 */
export function summarizeCommunity(group, graph) {
  if (!group?.members?.length) return { id: group?.id, size: 0, topMembers: [], summary: '' };
  const memberSet = new Set(group.members);
  const scored = group.members.map((name) => {
    const neighbors = graph.adj.get(name) || new Set();
    let degree = 0;
    for (const nb of neighbors) if (memberSet.has(nb)) degree++;
    return { name, degree };
  }).sort((a, b) => {
    if (b.degree !== a.degree) return b.degree - a.degree;
    return a.name < b.name ? -1 : 1;
  });

  const topMembers = scored.slice(0, MAX_COMMUNITY_TOP_TERMS);
  const lines = [];
  for (const { name } of topMembers) {
    const entity = graph.nodes.get(name);
    if (!entity) continue;
    const summary = (entity.summary || '').trim();
    if (summary) lines.push(`- ${entity.name}: ${summary}`);
    else lines.push(`- ${entity.name}`);
  }
  return {
    id: group.id,
    size: group.members.length,
    topMembers: topMembers.map((m) => m.name),
    summary: lines.join('\n'),
  };
}

/**
 * Global query over the entity graph. Builds the graph, detects communities,
 * scores each community by BM25 over its concatenated member summaries, and
 * returns the top communities with members.
 *
 * Intentionally returns structured data instead of a synthesized prose
 * answer: the LM-based response synthesis is the next layer up and belongs
 * in the persona prompt, not in this retrieval primitive. Solo mode can
 * consume the raw result without calling an external model.
 *
 * @param {object} args
 * @param {string} args.query  - natural-language question
 * @param {string} args.rootDir - project root containing `.cx/observations/`
 * @param {number} [args.topK=5] - max communities to return
 * @param {number} [args.minSize=MIN_COMMUNITY_SIZE] - skip singleton communities
 * @returns {{ query, communities: Array<{ id, size, topMembers, summary, score }>, totalEntities, totalCommunities }}
 */
export function askGlobal({ query, rootDir, topK = 5, minSize = MIN_COMMUNITY_SIZE } = {}) {
  if (!query || typeof query !== 'string') {
    return { query: query || '', communities: [], totalEntities: 0, totalCommunities: 0 };
  }
  const graph = buildGraph(rootDir);
  if (graph.nodes.size === 0) {
    return { query, communities: [], totalEntities: 0, totalCommunities: 0 };
  }

  const { communities } = detectCommunities(graph);
  const eligible = communities.filter((g) => g.members.length >= minSize);
  if (eligible.length === 0) {
    return {
      query,
      communities: [],
      totalEntities: graph.nodes.size,
      totalCommunities: communities.length,
    };
  }

  const summaries = eligible.map((group) => summarizeCommunity(group, graph));
  const docs = summaries.map((s, i) => ({
    id: String(i),
    text: `${s.topMembers.join(' ')}\n${s.summary}`,
  }));
  const ranked = rankByBm25(docs, query, { limit: topK });

  const out = [];
  for (const r of ranked) {
    const summary = summaries[Number(r.id)];
    if (!summary) continue;
    out.push({ ...summary, score: r.score });
  }

  return {
    query,
    communities: out,
    totalEntities: graph.nodes.size,
    totalCommunities: communities.length,
  };
}
