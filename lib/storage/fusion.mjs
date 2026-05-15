/**
 * lib/storage/fusion.mjs — score fusion for hybrid retrieval.
 *
 * Exposes two fusion strategies for combining ranked results from
 * multiple retrieval signals (lexical, vector, metadata, recency):
 *
 *   fuseScores({ vector, lexical, metadata, recency }, weights)
 *     — weighted linear combination, returns the final score and
 *       component scores so callers can debug retrieval drift.
 *
 *   reciprocalRankFusion(rankedLists, { k })
 *     — RRF: finalScore = Σ 1 / (k + rank_i) for each list a doc appears in.
 *       Order-insensitive across lists; robust to score-scale mismatch
 *       between lexical (BM25) and vector (cosine) backends.
 *
 * Default weights match the source plan: vector 0.45, lexical 0.35,
 * metadata 0.15, recency 0.05. Callers override per-query when needed
 * (e.g. weight metadata higher for filter-driven queries).
 */

export const DEFAULT_WEIGHTS = Object.freeze({
  vector: 0.45,
  lexical: 0.35,
  metadata: 0.15,
  recency: 0.05,
});

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Compute a fused score from component signals.
 *
 * @param {object} components
 * @param {number} [components.vector]    cosine similarity in [0, 1]
 * @param {number} [components.lexical]   normalized lexical score in [0, 1]
 * @param {number} [components.metadata]  metadata-match score in [0, 1]
 * @param {number} [components.recency]   freshness score in [0, 1]
 * @param {object} [weights]
 * @returns {{ vector, lexical, metadata, recency, finalScore, weights }}
 */
export function fuseScores(components = {}, weights = DEFAULT_WEIGHTS) {
  const v = clamp01(components.vector);
  const l = clamp01(components.lexical);
  const m = clamp01(components.metadata);
  const r = clamp01(components.recency);
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const finalScore = clamp01(v * w.vector + l * w.lexical + m * w.metadata + r * w.recency);
  return { vector: v, lexical: l, metadata: m, recency: r, finalScore, weights: w };
}

/**
 * Reciprocal Rank Fusion across N ranked lists. Each list is an array
 * of `{ id, ... }` objects ordered by descending relevance.
 *
 * @param {Array<Array<object>>} rankedLists
 * @param {object} [opts]
 * @param {number} [opts.k=60]
 * @returns {Array<{ id, rrfScore, appearsIn: number }>}
 */
export function reciprocalRankFusion(rankedLists, { k = 60 } = {}) {
  if (!Array.isArray(rankedLists) || rankedLists.length === 0) return [];
  const scores = new Map();
  for (const list of rankedLists) {
    if (!Array.isArray(list)) continue;
    list.forEach((item, idx) => {
      if (!item?.id) return;
      const rrf = 1 / (k + idx + 1);
      const prev = scores.get(item.id) || { id: item.id, rrfScore: 0, appearsIn: 0 };
      prev.rrfScore += rrf;
      prev.appearsIn += 1;
      scores.set(item.id, prev);
    });
  }
  return [...scores.values()].sort((a, b) => b.rrfScore - a.rrfScore);
}

/**
 * Compute a normalized recency score in [0, 1] given a timestamp and
 * a half-life in days. A doc updated today scores ~1, a doc older than
 * 4× the half-life scores near 0.
 */
export function recencyScore(updatedAt, { halfLifeDays = 30, now = Date.now() } = {}) {
  if (!updatedAt) return 0;
  const ts = updatedAt instanceof Date ? updatedAt.getTime() : Date.parse(updatedAt);
  if (!Number.isFinite(ts)) return 0;
  const ageMs = Math.max(0, now - ts);
  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
  if (halfLifeMs <= 0) return 0;
  return clamp01(Math.pow(0.5, ageMs / halfLifeMs));
}
