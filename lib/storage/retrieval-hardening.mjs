/**
 * lib/storage/retrieval-hardening.mjs — Vector-store poisoning defenses for
 * the retrieval/recall path.
 *
 * N1 (construct-9oi4.14.1, lib/security/trust.mjs) stamps ingested content
 * with a trust label (`_trust.level`) but does nothing to the ranking or
 * shape of what gets recalled — an adversarial embedding tuned to score high
 * cosine similarity can still dominate assembled context. This module is the
 * retrieval-side hardening layer: it takes an already similarity-ranked
 * result array (from VectorClient.searchObservations/searchDocuments or the
 * hybrid-query fusion) and applies, in order:
 *
 *   1. distance/similarity sanity filtering — drop results below a floor or
 *      carrying a non-finite/out-of-range similarity (malformed or
 *      adversarially-crafted embeddings can produce these).
 *   2. duplicate-content collapse — near-identical bodies (same normalized
 *      text) keep only the highest-ranked copy, so an attacker cannot
 *      multiply one payload's presence in the assembled set.
 *   3. trust-weighted re-ranking — at equal similarity, higher N1 trust wins;
 *      unstamped records are graded EXTERNAL_UNAUTHENTICATED per policy
 *      (lib/security/trust.mjs recallTrustGrade).
 *   4. per-source recall cap — no single source may occupy more than a
 *      configurable fraction of the assembled set.
 *
 * `flagRetrievalAnomalies` is a separate, non-mutating check: it inspects
 * per-source frequency across a result set (or a caller-supplied historical
 * frequency table) and flags sources whose share is a statistical outlier,
 * for callers that want to log/alert without altering ranking.
 *
 * Pure functions only — no I/O, no LanceDB dependency — so the module is
 * unit-testable without a live vector store and composable into
 * hybrid-query.mjs, observation-store.mjs, or any future retrieval caller.
 *
 * References: CX-AUDIT-LLMSEC-001, OWASP GenAI vector/embedding weaknesses,
 * construct-9oi4.14.4 (depends on construct-9oi4.14.1).
 */

import { TRUST_LEVELS, recallTrustGrade } from '../security/trust.mjs';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_HARDENING_OPTIONS = {
  minSimilarity: 0.05,
  maxSimilarity: 1.0001,
  perSourceCapRatio: 0.34,
  duplicateSimilarityThreshold: 0.995,
};

const TRUST_RANK = [
  TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED,
  TRUST_LEVELS.EXTERNAL_AUTHENTICATED,
  TRUST_LEVELS.TEAM_AUTHORED,
  TRUST_LEVELS.TRUSTED_INTERNAL,
];

// ---------------------------------------------------------------------------
// Trust grading
// ---------------------------------------------------------------------------

// Unstamped records are the highest-risk case (N1 policy: treat as the
// least-trusted level) rather than silently defaulting to a mid-tier grade.

function trustRankOf(record) {
  const grade = recallTrustGrade(record);
  const level = grade?.level ?? TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED;
  const idx = TRUST_RANK.indexOf(level);
  return idx === -1 ? 0 : idx;
}

/**
 * Resolve a stable source identity for a recalled record, for both the
 * observations table (`source`) and the documents table (`source_path` /
 * `sourcePath`), falling back to project scope so ungrouped records still
 * collapse into one bucket rather than each counting as a unique source.
 *
 * @param {Record<string, unknown>} record
 * @returns {string}
 */
export function sourceIdentityOf(record) {
  const raw = record?.source ?? record?.sourcePath ?? record?.source_path ?? record?.project ?? 'unknown';
  return typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
}

// ---------------------------------------------------------------------------
// Distance / similarity sanity thresholds
// ---------------------------------------------------------------------------

/**
 * Drop results whose similarity is missing, non-finite, or outside the
 * plausible [minSimilarity, maxSimilarity] band. Cosine similarity for a
 * well-formed embedding pair lies in [-1, 1]; a value outside that band (or
 * exactly saturating past 1) signals a malformed or adversarially crafted
 * vector rather than a genuine semantic match.
 *
 * @param {Array<Record<string, unknown>>} results
 * @param {{ minSimilarity?: number, maxSimilarity?: number }} [opts]
 * @returns {Array<Record<string, unknown>>}
 */
export function applySanityThreshold(results, opts = {}) {
  const minSimilarity = opts.minSimilarity ?? DEFAULT_HARDENING_OPTIONS.minSimilarity;
  const maxSimilarity = opts.maxSimilarity ?? DEFAULT_HARDENING_OPTIONS.maxSimilarity;
  if (!Array.isArray(results)) return [];

  return results.filter((r) => {
    const sim = r?.similarity;
    return Number.isFinite(sim) && sim >= minSimilarity && sim <= maxSimilarity;
  });
}

// ---------------------------------------------------------------------------
// Duplicate-content collapse
// ---------------------------------------------------------------------------

function normalizeForDedup(record) {
  const text = record?.content ?? record?.body ?? record?.summary ?? '';
  return String(text).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Collapse near-identical content down to the single highest-similarity
 * copy. Exact-normalized matches always collapse; near-duplicates above
 * `duplicateSimilarityThreshold` collapse via a cheap Jaccard-on-shingles
 * check so an attacker cannot pad recall share by injecting many
 * near-identical restatements of one payload.
 *
 * @param {Array<Record<string, unknown>>} results Similarity-sorted, best first.
 * @param {{ duplicateSimilarityThreshold?: number }} [opts]
 * @returns {Array<Record<string, unknown>>}
 */
export function collapseDuplicates(results, opts = {}) {
  const threshold = opts.duplicateSimilarityThreshold ?? DEFAULT_HARDENING_OPTIONS.duplicateSimilarityThreshold;
  if (!Array.isArray(results) || results.length === 0) return [];

  const kept = [];
  const keptNormalized = [];

  for (const candidate of results) {
    const normalized = normalizeForDedup(candidate);
    const isDuplicate = keptNormalized.some((existing) => {
      if (existing === normalized) return true;
      if (!existing || !normalized) return false;
      return shingleSimilarity(existing, normalized) >= threshold;
    });
    if (isDuplicate) continue;
    kept.push(candidate);
    keptNormalized.push(normalized);
  }

  return kept;
}

// Trigram-shingle Jaccard similarity — cheap, dependency-free near-duplicate
// detection that tolerates whitespace/punctuation noise between two restated
// copies of the same payload.

function shingleSimilarity(a, b) {
  const shinglesA = shingles(a);
  const shinglesB = shingles(b);
  if (shinglesA.size === 0 || shinglesB.size === 0) return 0;

  let intersection = 0;
  for (const s of shinglesA) {
    if (shinglesB.has(s)) intersection += 1;
  }
  const union = shinglesA.size + shinglesB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function shingles(text, size = 3) {
  const set = new Set();
  for (let i = 0; i <= text.length - size; i += 1) {
    set.add(text.slice(i, i + size));
  }
  return set;
}

// ---------------------------------------------------------------------------
// Trust-weighted ranking
// ---------------------------------------------------------------------------

/**
 * Re-rank results so that, at materially equal similarity, higher-trust
 * records sort above lower-trust ones. Similarity remains the dominant sort
 * key — trust only breaks ties within an `epsilon` similarity band — so a
 * genuinely more relevant trusted result still loses to an overwhelmingly
 * better-matching one; it only wins the recall competition an adversarial
 * near-tie is designed to exploit.
 *
 * @param {Array<Record<string, unknown>>} results
 * @param {{ epsilon?: number }} [opts]
 * @returns {Array<Record<string, unknown>>}
 */
export function applyTrustWeightedRanking(results, opts = {}) {
  const epsilon = opts.epsilon ?? 0.02;
  if (!Array.isArray(results)) return [];

  return [...results].sort((a, b) => {
    const simA = Number(a?.similarity) || 0;
    const simB = Number(b?.similarity) || 0;
    if (Math.abs(simA - simB) > epsilon) return simB - simA;

    const trustDelta = trustRankOf(b) - trustRankOf(a);
    if (trustDelta !== 0) return trustDelta;

    return simB - simA;
  });
}

// ---------------------------------------------------------------------------
// Per-source recall cap
// ---------------------------------------------------------------------------

/**
 * Enforce that no single source occupies more than `perSourceCapRatio` of
 * the FINAL assembled context set — not of the raw candidate pool. The cap
 * is defined against `assembledSize` (the caller's `limit`, i.e. how many
 * results actually get assembled into context) because that is the quantity
 * OWASP/N4 policy constrains: an attacker cannot monopolize the context a
 * model actually sees, regardless of how many candidates were fetched
 * upstream. When no explicit `assembledSize`/`limit` is given, the candidate
 * pool size after this stage is the best available proxy.
 *
 * Applied after ranking, so the highest-ranked items from each source are
 * kept and the cap only trims a source's excess once it would otherwise
 * crowd out other sources. A single pass keeps up to `cap` per source, then
 * a second pass backfills any remaining assembled slots from the trimmed
 * overflow (best-ranked first) so the cap never shrinks the final set below
 * `assembledSize` while other sources have eligible candidates left.
 *
 * @param {Array<Record<string, unknown>>} results Already ranked, best first.
 * @param {{ perSourceCapRatio?: number, assembledSize?: number, limit?: number }} [opts]
 * @returns {Array<Record<string, unknown>>}
 */
export function applyPerSourceCap(results, opts = {}) {
  const ratio = opts.perSourceCapRatio ?? DEFAULT_HARDENING_OPTIONS.perSourceCapRatio;
  if (!Array.isArray(results) || results.length === 0) return [];

  const assembledSize = Math.min(
    results.length,
    opts.assembledSize ?? opts.limit ?? results.length,
  );
  const cap = Math.max(1, Math.floor(assembledSize * ratio));

  const perSourceCount = new Map();
  const kept = [];
  const overflow = [];

  for (const record of results) {
    const source = sourceIdentityOf(record);
    const count = perSourceCount.get(source) || 0;
    if (count >= cap) {
      overflow.push(record);
      continue;
    }
    perSourceCount.set(source, count + 1);
    kept.push(record);
  }

  // Backfill from overflow (still capped per source) only until the
  // assembled set reaches its target size — the cap must keep binding, so
  // a source already at its cap is never topped up again here.

  for (const record of overflow) {
    if (kept.length >= assembledSize) break;
    const source = sourceIdentityOf(record);
    const count = perSourceCount.get(source) || 0;
    if (count >= cap) continue;
    perSourceCount.set(source, count + 1);
    kept.push(record);
  }

  return kept;
}

// ---------------------------------------------------------------------------
// Combined pipeline
// ---------------------------------------------------------------------------

/**
 * Apply the full retrieval-hardening pipeline to a similarity-ranked result
 * set: sanity threshold -> duplicate collapse -> trust-weighted ranking ->
 * per-source cap -> limit. Intended as the single call site for any recall
 * path that assembles context from VectorClient search results.
 *
 * @param {Array<Record<string, unknown>>} results
 * @param {{
 *   minSimilarity?: number, maxSimilarity?: number,
 *   duplicateSimilarityThreshold?: number,
 *   perSourceCapRatio?: number, epsilon?: number, limit?: number,
 * }} [opts]
 * @returns {Array<Record<string, unknown>>}
 */
export function hardenRetrieval(results, opts = {}) {
  if (!Array.isArray(results)) return [];

  const sane = applySanityThreshold(results, opts);
  const deduped = collapseDuplicates(sane, opts);
  const ranked = applyTrustWeightedRanking(deduped, opts);
  const capped = applyPerSourceCap(ranked, opts);

  return opts.limit != null ? capped.slice(0, opts.limit) : capped;
}

// ---------------------------------------------------------------------------
// Retrieval-frequency anomaly check
// ---------------------------------------------------------------------------

/**
 * Flag sources whose share of a result set is a statistical outlier versus
 * the other sources present. Uses a leave-one-out z-score: each source's
 * count is compared against the mean/stddev of every OTHER source's count,
 * not the whole population — scoring against the full population lets a
 * large flood inflate its own reference mean/stddev enough to mask itself,
 * especially with only a handful of distinct sources. A source more than
 * `zThreshold` standard deviations above the other sources' mean is flagged;
 * if the other sources all tie (zero spread) any source strictly above that
 * shared count is flagged outright. With fewer than 3 distinct sources the
 * check is inconclusive (no meaningful distribution) and returns no flags
 * rather than a false positive.
 *
 * Non-mutating — this is a detection signal for logging/alerting, not a
 * ranking transform. Callers that want enforcement should also apply
 * `applyPerSourceCap`.
 *
 * @param {Array<Record<string, unknown>>} results
 * @param {{ zThreshold?: number }} [opts]
 * @returns {{
 *   flagged: Array<{ source: string, count: number, share: number, zScore: number }>,
 *   sourceCounts: Record<string, number>,
 * }}
 */
export function flagRetrievalAnomalies(results, opts = {}) {
  const zThreshold = opts.zThreshold ?? 2;
  const sourceCounts = {};

  if (!Array.isArray(results) || results.length === 0) {
    return { flagged: [], sourceCounts };
  }

  for (const record of results) {
    const source = sourceIdentityOf(record);
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  }

  const entries = Object.entries(sourceCounts);
  if (entries.length < 3) {
    return { flagged: [], sourceCounts };
  }

  // Leave-one-out z-score: a flood source's own count inflates the
  // population mean/stddev enough to mask itself in a plain z-score,
  // especially with few distinct sources. Scoring each candidate against
  // the mean/stddev of the OTHER sources only removes that self-masking.

  const flagged = [];
  for (const [source, count] of entries) {
    const others = entries.filter(([s]) => s !== source).map(([, c]) => c);
    const otherMean = others.reduce((sum, c) => sum + c, 0) / others.length;
    const otherVariance = others.reduce((sum, c) => sum + (c - otherMean) ** 2, 0) / others.length;
    const otherStddev = Math.sqrt(otherVariance);

    // Zero-spread tie among the other sources leaves no stddev to divide by.
    // Require the candidate to be a substantial multiple of that tied count
    // (not merely +1) before flagging, or a one-off count on top of small
    // uniform buckets (e.g. 4 vs 3,3,3) would falsely read as an outlier.

    if (otherStddev === 0) {
      if (otherMean > 0 && count >= otherMean * 2) {
        flagged.push({ source, count, share: count / results.length, zScore: Infinity });
      }
      continue;
    }

    const zScore = (count - otherMean) / otherStddev;
    if (zScore >= zThreshold) {
      flagged.push({ source, count, share: count / results.length, zScore });
    }
  }

  flagged.sort((a, b) => b.zScore - a.zScore);
  return { flagged, sourceCounts };
}
