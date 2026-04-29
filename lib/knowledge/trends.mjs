/**
 * lib/knowledge/trends.mjs — Trend detection over the observation corpus.
 *
 * Surfaces:
 *   - Recurring patterns: observations with similar embeddings that appear
 *     multiple times across roles or sessions.
 *   - Escalating risks: anti-pattern observations whose frequency is increasing
 *     over time (more recent occurrences than older ones).
 *   - Decision drift: decisions that have been re-opened or contradicted by
 *     later observations.
 *   - Hot topics: terms with the highest weighted TF across recent observations
 *     (BM25-derived importance, recency-weighted).
 *
 * All detection is zero-dep and deterministic — no external API calls.
 * Results are plain objects suitable for JSON serialisation and dashboard display.
 */

import { listObservations, getObservation } from '../observation-store.mjs';
import { embedText, cosineSimilarity, tokenize } from '../storage/embeddings.mjs';

const RECURRENCE_SIMILARITY_THRESHOLD = 0.40;
const RECURRENCE_MIN_COUNT = 2;
const ESCALATION_WINDOW_DAYS = 7;
const HOT_TOPICS_LIMIT = 10;
const TREND_LIMIT = 20;

// ── Helpers ────────────────────────────────────────────────────────────────

function daysSince(isoDate) {
  if (!isoDate) return Infinity;
  return (Date.now() - new Date(isoDate).getTime()) / 86_400_000;
}

function recencyWeight(isoDate, halfLifeDays = 14) {
  const age = daysSince(isoDate);
  return Math.pow(0.5, age / halfLifeDays);
}

// ── Recurring patterns ─────────────────────────────────────────────────────

/**
 * Cluster observations by embedding similarity. Returns groups of observations
 * that are semantically similar (likely the same recurring pattern).
 */
function clusterBySimilarity(observations) {
  const embedded = observations.map((obs) => ({
    ...obs,
    embedding: embedText(`${obs.summary || ''} ${obs.content || ''}`),
  }));

  const clusters = [];
  const assigned = new Set();

  for (let i = 0; i < embedded.length; i++) {
    if (assigned.has(i)) continue;
    const cluster = [embedded[i]];
    assigned.add(i);
    for (let j = i + 1; j < embedded.length; j++) {
      if (assigned.has(j)) continue;
      const sim = cosineSimilarity(embedded[i].embedding, embedded[j].embedding);
      if (sim >= RECURRENCE_SIMILARITY_THRESHOLD) {
        cluster.push(embedded[j]);
        assigned.add(j);
      }
    }
    if (cluster.length >= RECURRENCE_MIN_COUNT) {
      clusters.push(cluster);
    }
  }

  return clusters;
}

/**
 * Detect recurring patterns: semantically similar observations seen across
 * multiple sessions or roles.
 *
 * @returns {object[]} array of { summary, count, roles, categories, firstSeen, lastSeen, observations }
 */
export function detectRecurringPatterns(rootDir = process.cwd()) {
  const all = listObservations(rootDir, {});
  if (all.length === 0) return [];

  const full = all.map((e) => ({ ...e, ...getObservation(rootDir, e.id) }));
  const clusters = clusterBySimilarity(full);

  return clusters
    .map((cluster) => {
      const roles = [...new Set(cluster.map((o) => o.role).filter(Boolean))];
      const categories = [...new Set(cluster.map((o) => o.category).filter(Boolean))];
      const dates = cluster.map((o) => o.createdAt).filter(Boolean).sort();
      return {
        type: 'recurring_pattern',
        summary: cluster[0].summary || 'Recurring pattern',
        count: cluster.length,
        roles,
        categories,
        firstSeen: dates[0] || null,
        lastSeen: dates[dates.length - 1] || null,
        observations: cluster.map((o) => ({ id: o.id, summary: o.summary, role: o.role, createdAt: o.createdAt })),
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, TREND_LIMIT);
}

// ── Escalating risks ───────────────────────────────────────────────────────

/**
 * Detect escalating risks: anti-pattern observations where the frequency in
 * the recent window is higher than the baseline rate.
 *
 * @returns {object[]} array of { summary, recentCount, olderCount, escalationScore, lastSeen }
 */
export function detectEscalatingRisks(rootDir = process.cwd()) {
  const all = listObservations(rootDir, { category: 'anti-pattern' });
  if (all.length === 0) return [];

  const full = all.map((e) => ({ ...e, ...getObservation(rootDir, e.id) }));
  const clusters = clusterBySimilarity(full);

  return clusters
    .map((cluster) => {
      const recent = cluster.filter((o) => daysSince(o.createdAt) <= ESCALATION_WINDOW_DAYS);
      const older = cluster.filter((o) => daysSince(o.createdAt) > ESCALATION_WINDOW_DAYS);
      const recentRate = recent.length / Math.max(ESCALATION_WINDOW_DAYS, 1);
      const olderSpan = Math.max(
        cluster.reduce((span, o) => Math.max(span, daysSince(o.createdAt)), 0) - ESCALATION_WINDOW_DAYS,
        1,
      );
      const olderRate = older.length / olderSpan;
      const escalationScore = olderRate > 0 ? recentRate / olderRate : recentRate * 10;
      const dates = cluster.map((o) => o.createdAt).filter(Boolean).sort();
      return {
        type: 'escalating_risk',
        summary: cluster[0].summary || 'Escalating risk',
        recentCount: recent.length,
        olderCount: older.length,
        escalationScore: Number(escalationScore.toFixed(2)),
        lastSeen: dates[dates.length - 1] || null,
        observations: cluster.map((o) => ({ id: o.id, summary: o.summary, createdAt: o.createdAt })),
      };
    })
    .filter((r) => r.escalationScore > 1.5 && r.recentCount > 0)
    .sort((a, b) => b.escalationScore - a.escalationScore)
    .slice(0, TREND_LIMIT);
}

// ── Decision drift ─────────────────────────────────────────────────────────

/**
 * Detect decision drift: decision observations that are semantically similar
 * to later anti-pattern or insight observations (suggesting the decision was
 * questioned or reversed).
 *
 * @returns {object[]} array of { decision, conflictingObservations, driftScore }
 */
export function detectDecisionDrift(rootDir = process.cwd()) {
  const decisions = listObservations(rootDir, { category: 'decision' })
    .map((e) => ({ ...e, ...getObservation(rootDir, e.id) }));
  const signals = listObservations(rootDir, {})
    .filter((e) => ['anti-pattern', 'insight'].includes(e.category))
    .map((e) => ({ ...e, ...getObservation(rootDir, e.id) }));

  if (decisions.length === 0 || signals.length === 0) return [];

  return decisions
    .map((decision) => {
      const decEmbed = embedText(`${decision.summary || ''} ${decision.content || ''}`);
      const conflicting = signals
        .filter((s) => new Date(s.createdAt || 0) > new Date(decision.createdAt || 0))
        .map((s) => ({
          ...s,
          similarity: cosineSimilarity(decEmbed, embedText(`${s.summary || ''} ${s.content || ''}`)),
        }))
        .filter((s) => s.similarity >= 0.35)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 3);

      if (conflicting.length === 0) return null;

      const driftScore = conflicting.reduce((sum, s) => sum + s.similarity * recencyWeight(s.createdAt), 0);
      return {
        type: 'decision_drift',
        decision: { id: decision.id, summary: decision.summary, createdAt: decision.createdAt },
        conflictingObservations: conflicting.map((s) => ({
          id: s.id,
          summary: s.summary,
          category: s.category,
          similarity: Number(s.similarity.toFixed(3)),
          createdAt: s.createdAt,
        })),
        driftScore: Number(driftScore.toFixed(3)),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.driftScore - a.driftScore)
    .slice(0, TREND_LIMIT);
}

// ── Hot topics ─────────────────────────────────────────────────────────────

/**
 * Surface the most frequently discussed topics across recent observations,
 * weighted by recency (recent = higher weight).
 *
 * @returns {object[]} array of { term, weightedFrequency, recentCount, totalCount }
 */
export function detectHotTopics(rootDir = process.cwd()) {
  const all = listObservations(rootDir, {});
  if (all.length === 0) return [];

  const STOPWORDS = new Set([
    'the', 'and', 'for', 'are', 'was', 'with', 'this', 'that', 'from',
    'have', 'has', 'had', 'not', 'but', 'been', 'more', 'when', 'will',
    'its', 'use', 'used', 'using', 'should', 'can', 'all', 'any', 'each',
    'into', 'also', 'than', 'they', 'their', 'which', 'where', 'there',
  ]);

  const termStats = new Map();

  for (const e of all) {
    const full = getObservation(rootDir, e.id);
    const text = `${full?.summary || ''} ${full?.content || ''}`;
    const weight = recencyWeight(e.createdAt);
    const isRecent = daysSince(e.createdAt) <= ESCALATION_WINDOW_DAYS;
    const terms = [...new Set(tokenize(text).filter((t) => t.length >= 4 && !STOPWORDS.has(t)))];
    for (const term of terms) {
      const prev = termStats.get(term) || { weightedFrequency: 0, recentCount: 0, totalCount: 0 };
      termStats.set(term, {
        weightedFrequency: prev.weightedFrequency + weight,
        recentCount: prev.recentCount + (isRecent ? 1 : 0),
        totalCount: prev.totalCount + 1,
      });
    }
  }

  return [...termStats.entries()]
    .map(([term, stats]) => ({ term, ...stats }))
    .sort((a, b) => b.weightedFrequency - a.weightedFrequency)
    .slice(0, HOT_TOPICS_LIMIT);
}

// ── Full trend report ──────────────────────────────────────────────────────

/**
 * Run all detectors and return a consolidated trend report.
 *
 * @param {string} rootDir
 * @returns {{ recurringPatterns, escalatingRisks, decisionDrift, hotTopics, generatedAt }}
 */
export function buildTrendReport(rootDir = process.cwd()) {
  return {
    recurringPatterns: detectRecurringPatterns(rootDir),
    escalatingRisks: detectEscalatingRisks(rootDir),
    decisionDrift: detectDecisionDrift(rootDir),
    hotTopics: detectHotTopics(rootDir),
    generatedAt: new Date().toISOString(),
  };
}
