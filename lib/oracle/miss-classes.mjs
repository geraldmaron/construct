/**
 * lib/oracle/miss-classes.mjs — Oracle miss-class taxonomy (Layer 3 input).
 *
 * Encodes the four systemic miss classes from
 * docs/notes/research/2026-07-continuous-work-audit/oracle-miss-report.md (M1–M4)
 * as structured data the learning loop and miss-analysis job consume instead of
 * re-parsing prose on every classification.
 */

export const MISS_CLASSES = Object.freeze([
  {
    id: 'M1',
    name: 'vocabulary-gap',
    summary:
      "Oracle's verdict vocabulary cannot express dormant, opt-in, test-only, disconnected, or 'analysis did not run' states.",
    citation: 'oracle-miss-report.md § M1 — Vocabulary gap',
    earliestDetectionStage: 'producer-level',
    remedyClass: 'evidence-status-vocabulary',
  },
  {
    id: 'M2',
    name: 'scope-gap',
    summary:
      "Oracle's read model never inspects open PR branches, deploy/template artifacts, or tracker-vs-git consistency.",
    citation: 'oracle-miss-report.md § M2 — Scope gap',
    earliestDetectionStage: 'authoring-ci-time',
    remedyClass: 'deterministic-layer-1-or-pr-diff-gate',
  },
  {
    id: 'M3',
    name: 'liveness-gap',
    summary:
      'Oracle (or a co-dependent daemon) stalled with no independent third-party liveness prober escalating.',
    citation: 'oracle-miss-report.md § M3 — Liveness gap (meta-miss)',
    earliestDetectionStage: 'producer-level',
    remedyClass: 'independent-liveness-prober',
  },
  {
    id: 'M4',
    name: 'integration-gap',
    summary:
      'Tracker truth (bd) and code truth (git) are unreconciled sources of record with no cross-check.',
    citation: 'oracle-miss-report.md § M4 — Integration gap',
    earliestDetectionStage: 'authoring-ci-time',
    remedyClass: 'deterministic-layer-1-invariant',
  },
]);

const CLASSIFIERS = Object.freeze([
  {
    classId: 'M1',
    patterns: [
      /\bvocabular(y|ies)\b/i,
      /\bhealthy\b.*\battention\b|\bdegraded\b/i,
      /\binvisible to oracle\b/i,
      /\bno (way|detector) to (express|say)\b/i,
      /\bevidence.status\b/i,
      /\branAnalysis\b|\bresultStatus\b/i,
      /\bfalse success\b/i,
    ],
  },
  {
    classId: 'M2',
    patterns: [
      /\bunmerged branch\b/i,
      /\bopen pr\b|\bpr branch\b/i,
      /\btemplate artifact\b/i,
      /\bbranch.only\b|\bbranch only\b/i,
      /\bdeploy artifact\b/i,
      /\bdockerfile.*missing\b/i,
    ],
  },
  {
    classId: 'M3',
    patterns: [
      /\bself.shut\b|\bself shut\b/i,
      /\bheartbeat frozen\b|\bstalled\b/i,
      /\bmaxIdleTicks\b/i,
      /\bno (independent )?liveness\b/i,
      /\bdaemon (died|dead|stalled)\b/i,
      /\bdoctor.*also (dead|died)\b/i,
    ],
  },
  {
    classId: 'M4',
    patterns: [
      /\bclosed bead\b.*\bsha\b/i,
      /\btracker.*git\b|\bbd.*git\b/i,
      /\bnot reachable from (origin\/)?main\b/i,
      /\bunreconciled\b/i,
      /\bintegration gap\b/i,
      /\bmerge.base\b.*\bclosed\b/i,
    ],
  },
]);

export function missClassById(classId) {
  return MISS_CLASSES.find((c) => c.id === classId || c.name === classId) || null;
}

/**
 * Classifies a miss description against the M1–M4 taxonomy. Returns the best
 * matching class or null when no pattern matches (candidate new class).
 *
 * @param {string} description
 * @returns {{ classId: string, className: string, confidence: 'high'|'medium'|'low', citation: string, matchCount: number } | null}
 */
export function classifyMissDescription(description) {
  const text = String(description || '');
  if (!text.trim()) return null;

  let best = null;
  for (const { classId, patterns } of CLASSIFIERS) {
    const hits = patterns.filter((p) => p.test(text));
    if (hits.length === 0) continue;
    const entry = {
      classId,
      className: missClassById(classId)?.name || classId,
      confidence: hits.length >= 2 ? 'high' : 'medium',
      citation: missClassById(classId)?.citation || 'oracle-miss-report.md',
      matchCount: hits.length,
    };
    if (!best || entry.matchCount > best.matchCount) best = entry;
  }
  return best;
}

export function earliestDetectionStageForClass(classId) {
  return missClassById(classId)?.earliestDetectionStage || 'unknown';
}

export function remedyClassForClass(classId) {
  return missClassById(classId)?.remedyClass || 'unknown';
}
