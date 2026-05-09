/**
 * lib/engine/reranker-mmr.mjs — Maximal Marginal Relevance (MMR) Reranker plugin.
 *
 * Re-orders a fused candidate list to balance relevance against diversity:
 *
 *     MMR(d) = λ · sim(d, q) − (1 − λ) · max_{d'∈S} sim(d, d')
 *
 * where S is the set of already-selected docs. λ defaults to 0.7 — favoring
 * relevance, but enough diversity weight to drop near-duplicates. λ=1 gives
 * pure relevance ranking; λ=0 gives pure novelty.
 *
 * Two similarity sources are supported on the candidate objects:
 *   - `embedding` (Array | Float32Array) — cosine similarity to the query
 *     embedding (passed via opts.queryEmbedding) and to other candidates'
 *     embeddings. Highest fidelity.
 *   - text fallback — Jaccard similarity over tokenized title+body when no
 *     embedding is available. Used by callers that haven't migrated to the
 *     engine path yet.
 *
 * The function returns at most `topK` items in MMR order with a `.mmrScore`
 * field added. Callers using this purely for deduplication can pass
 * `topK = candidates.length` to keep all items but reorder for diversity.
 */

import { tokenize, cosineSimilarity } from '../storage/embeddings.mjs';

function jaccard(a, b) {
  if (!a || !b) return 0;
  const setA = new Set(tokenize(`${a.title || ''} ${a.body || ''}`));
  const setB = new Set(tokenize(`${b.title || ''} ${b.body || ''}`));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersect = 0;
  for (const t of setA) if (setB.has(t)) intersect++;
  return intersect / (setA.size + setB.size - intersect);
}

function similarity(a, b) {
  if (a?.embedding && b?.embedding) {
    return cosineSimilarity(a.embedding, b.embedding);
  }
  return jaccard(a, b);
}

function relevance(candidate, queryEmbedding) {
  if (queryEmbedding && candidate?.embedding) {
    return cosineSimilarity(queryEmbedding, candidate.embedding);
  }
  return candidate?.score ?? 0;
}

export function create({ lambda = 0.7 } = {}) {
  return {
    meta: { id: 'mmr', lambda },
    async rerank(query, candidates, opts = {}) {
      if (!Array.isArray(candidates) || candidates.length === 0) return [];
      const lambdaEff = opts.lambda ?? lambda;
      const topK = opts.topK ?? candidates.length;
      const queryEmbedding = opts.queryEmbedding || null;

      const remaining = [...candidates];
      const selected = [];

      while (selected.length < topK && remaining.length > 0) {
        let bestIndex = 0;
        let bestScore = -Infinity;

        for (let i = 0; i < remaining.length; i++) {
          const cand = remaining[i];
          const rel = relevance(cand, queryEmbedding);
          let maxSim = 0;
          for (const sel of selected) {
            const s = similarity(cand, sel);
            if (s > maxSim) maxSim = s;
          }
          const score = lambdaEff * rel - (1 - lambdaEff) * maxSim;
          if (score > bestScore) {
            bestScore = score;
            bestIndex = i;
          }
        }

        const [chosen] = remaining.splice(bestIndex, 1);
        selected.push({ ...chosen, mmrScore: bestScore });
      }

      return selected;
    },
  };
}

export default create;
