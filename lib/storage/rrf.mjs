/**
 * lib/storage/rrf.mjs — Reciprocal Rank Fusion for hybrid retrieval.
 *
 * Combines N independently-ranked result lists (e.g. BM25 keyword and cosine
 * vector) into one ranking by summing 1/(k + rank) across the lists a document
 * appears in. Fusion is by RANK, not raw score, so it merges lists whose scores
 * live on incompatible scales — BM25 is unbounded-positive, cosine is [-1,1] —
 * without any normalization or hand-tuned weighting. k smooths how much top
 * ranks dominate; 60 is the field default (Cormack, Clarke & Büttcher,
 * "Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning
 * Methods", SIGIR 2009) and the dominant fusion method across search engines.
 */

// Each ranked list is ordered best-first. A document's RRF score is the sum,
// over every list it appears in, of 1/(k + rank) where rank is 1-based.

export function reciprocalRankFusion(rankedLists, { k = 60, idOf = (x) => x.id, limit = null } = {}) {
  if (!Array.isArray(rankedLists) || rankedLists.length === 0) return [];
  if (!Number.isFinite(k) || k <= 0) throw new Error('reciprocalRankFusion: k must be a positive number');

  const scores = new Map();
  const items = new Map();

  for (const list of rankedLists) {
    if (!Array.isArray(list)) continue;
    for (let rank = 1; rank <= list.length; rank += 1) {
      const item = list[rank - 1];
      if (item == null) continue;
      const id = idOf(item);
      if (id == null) continue;
      scores.set(id, (scores.get(id) || 0) + 1 / (k + rank));
      if (!items.has(id)) items.set(id, item);
    }
  }

  // Deterministic order: by fused score desc, then id asc to break ties stably.
  const fused = [...scores.entries()]
    .sort((a, b) => (b[1] - a[1]) || String(a[0]).localeCompare(String(b[0])))
    .map(([id, score]) => ({ item: items.get(id), id, score }));

  return limit != null ? fused.slice(0, limit) : fused;
}
