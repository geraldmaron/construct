/**
 * lib/engine/fuser-rrf.mjs — Reciprocal Rank Fusion (RRF) Fuser plugin.
 *
 * Combines multiple ranked lists into a single ranking using:
 *
 *     RRF(d) = Σ 1 / (k + rank_i(d))
 *
 * where rank_i(d) is the 1-based position of document d in the i-th ranker's
 * output (or treated as if d were past the end of the list when absent), and
 * k is a smoothing constant (60 by default, the value used in the original
 * Cormack et al. 2009 paper and in production search systems like
 * Elasticsearch/Vespa).
 *
 * RRF replaces the previous weighted-sum fusion in lib/knowledge/rag.mjs that
 * had a correctness asymmetry: BM25 only scored a top-2K window, so chunks
 * outside that window contributed 0 from BM25 even when they had high cosine.
 * RRF is corpus-agnostic — only ranks matter, not raw scores — so the
 * asymmetry disappears.
 *
 * Plugin contract (Fuser):
 *   meta: { id, k }
 *   fuse(rankedLists, opts) → ranked[]
 *
 * `rankedLists` is either an array of arrays (each pre-sorted, highest-first)
 * or a Record<channelName, ranked[]>. Both shapes are supported so legacy
 * callers using the weighted-sum default can swap in RRF without rewriting
 * their call site.
 */

const DEFAULT_K = 60;

function toLists(input) {
  if (Array.isArray(input)) return input;
  if (input && typeof input === 'object') return Object.values(input);
  return [];
}

export function create({ k = DEFAULT_K } = {}) {
  return {
    meta: { id: 'rrf', k },
    fuse(rankedLists, opts = {}) {
      const kEff = opts.k ?? k;
      const lists = toLists(rankedLists);
      const merged = new Map();

      for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (let rank = 0; rank < list.length; rank++) {
          const doc = list[rank];
          if (!doc?.id) continue;
          const contribution = 1 / (kEff + rank + 1);
          const prev = merged.get(doc.id) || { ...doc, score: 0 };
          prev.score = (prev.score || 0) + contribution;
          merged.set(doc.id, prev);
        }
      }

      return [...merged.values()].sort((a, b) => b.score - a.score);
    },
  };
}

export default create;
