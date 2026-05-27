/**
 * lib/intake/classify.mjs — Profile-aware triage classification for intake packets.
 *
 * Deterministic, keyword-driven classifier that maps a raw intake signal onto
 * the active org profile's loop. Returns a triage object with: intakeType,
 * rdStage, primaryOwner, recommendedChain, recommendedAction, risk,
 * requiresApproval, confidence, rationale.
 *
 * Classification MUST be a pure function of (sourcePath, extractedText,
 * related, profile). Same input must yield identical output across runs.
 * Outcomes-aware re-ranking is deliberately not consulted here: cached
 * success-rate history would make the same file classify differently
 * across runs, which is a non-determinism bug. Outcomes can influence
 * downstream routing, but never classify.
 *
 * NO LLM call. The daemon path must remain synchronous and cheap; intent
 * verification belongs in offline measurement, not inline classification.
 *
 * Default profile is `rnd` so existing R&D users see no behavior change.
 * The `tests/intake/golden-rnd.test.mjs` test locks that invariant.
 */

import path from 'node:path';

// Backward-compatible exports. Default to RND values for any module that
// imports these constants directly (the symbol surface predates B2 and is
// referenced by intake-config, prepare, and tests).
import rndTable from './tables/rnd.mjs';
export const INTAKE_TYPES = rndTable.INTAKE_TYPES;
export const RD_STAGES = rndTable.STAGES;

export const RECOMMENDED_ACTIONS = [
  'summarize',
  'clarify',
  'research',
  'create-hypothesis',
  'draft-prd',
  'draft-rfc',
  'draft-adr',
  'create-experiment',
  'diagnose',
  'implement',
  'evaluate',
  'release-review',
  'create-runbook',
  'archive',
];

// Static profile to table map. New curated profiles register themselves here.
// Custom profiles (escape hatch) declare classificationTable as a repo-relative
// path; that path is loaded dynamically in classifyRdIntake when a profile arg
// supplies it.
import operationsTable from './tables/operations.mjs';
import creativeTable from './tables/creative.mjs';
import researchTable from './tables/research.mjs';

const TABLES = {
  rnd: rndTable,
  operations: operationsTable,
  creative: creativeTable,
  research: researchTable,
};

// Filename patterns are explicit intent signals. A match adds FILENAME_BOOST
// to the named intakeType, which is enough to outweigh one or two stray body
// keywords from a different type but not a clear keyword majority.
const FILENAME_BOOST = 0.4;
const FILENAME_HINTS = [
  { re: /postmortem/i, intakeType: 'incident' },
  { re: /incident-report|incident_report/i, intakeType: 'incident' },
  { re: /^adr[-_]/i, intakeType: 'architecture' },
  { re: /\badr[-_]\d/i, intakeType: 'architecture' },
  { re: /^rfc[-_]/i, intakeType: 'architecture' },
  { re: /^prd[-_]/i, intakeType: 'requirement' },
  { re: /security|cve|vulnerability/i, intakeType: 'security' },
  { re: /research|study|literature/i, intakeType: 'research' },
  { re: /eval|metric|benchmark/i, intakeType: 'eval-finding' },
  { re: /-bug\b|\bbug-/i, intakeType: 'bug' },
  { re: /runbook/i, intakeType: 'ops' },
];

// Title-level negative keywords flip a classification away from a misleading
// body match. A postmortem describes a bug in retrospect but is not a bug
// report; an incident-report uses crash vocabulary but is an incident.
// Penalty is applied only when the override matches the doc's title or first
// H1, never on stray body mentions.
const TITLE_PENALTY = 0.5;
const TITLE_OVERRIDES = [
  { re: /^#\s*postmortem\b/im, penalize: 'bug' },
  { re: /^#\s*incident\s+report\b/im, penalize: 'bug' },
  { re: /^#\s*post-mortem\b/im, penalize: 'bug' },
  { re: /^#\s*architecture\s+decision\b/im, penalize: 'bug' },
  { re: /^#\s*adr[-:\s]/im, penalize: 'bug' },
  { re: /^#\s*security\s+(advisory|finding)\b/im, penalize: 'bug' },
];

function resolveTable(profile) {
  if (!profile) return rndTable;
  const id = typeof profile === 'string' ? profile : profile.id;
  return TABLES[id] || rndTable;
}

function normalize(text) {
  return String(text || '').toLowerCase();
}

function countMatches(haystack, keywords) {
  let hits = 0;
  const matched = [];
  for (const kw of keywords) {
    if (haystack.includes(kw)) {
      hits += 1;
      matched.push(kw);
    }
  }
  return { hits, matched };
}

function buildSignalText({ sourcePath, extractedText, related }) {
  const basename = sourcePath ? path.basename(sourcePath) : '';
  const slug = basename.replace(/[._-]/g, ' ');
  const body = extractedText ? extractedText.slice(0, 4000) : '';
  const relatedTitles = (related || []).map((r) => r?.title || '').join(' ');
  return normalize(`${slug} ${body} ${relatedTitles}`);
}

// Look for a filename-pattern hint. The basename, not the full path, is
// scanned so directory names cannot accidentally bias the classification.
function filenameHintFor(sourcePath) {
  if (!sourcePath) return null;
  const base = path.basename(sourcePath);
  for (const hint of FILENAME_HINTS) {
    if (hint.re.test(base)) return hint.intakeType;
  }
  return null;
}

// Detect title-level overrides on the raw extracted text (case-insensitive,
// multiline anchored to ^# so only true H1s match).
function titlePenaltiesFor(extractedText) {
  const penalties = {};
  const text = String(extractedText || '');
  for (const rule of TITLE_OVERRIDES) {
    if (rule.re.test(text)) {
      penalties[rule.penalize] = (penalties[rule.penalize] || 0) + TITLE_PENALTY;
    }
  }
  return penalties;
}

/**
 * Classify an intake signal against the active profile (defaults to RND).
 *
 * Backward-compatible: callers that did not pass a `profile` arg keep getting
 * RND output for the same input. Output is deterministic. The optional `cwd`
 * argument is accepted for backward compatibility with prior callers but is
 * not consulted; outcomes-aware re-ranking is intentionally absent from the
 * classify path to preserve determinism.
 *
 * @param {object} input
 * @param {string} [input.sourcePath]
 * @param {string} [input.extractedText]
 * @param {Array} [input.related]
 * @param {string|object} [input.profile] - profile id (string) or full profile object
 * @param {string} [input.cwd] - accepted for backward compatibility, ignored
 */
export function classifyRdIntake({ sourcePath = '', extractedText = '', related = [], profile = null } = {}) {
  const table = resolveTable(profile);
  const signal = buildSignalText({ sourcePath, extractedText, related });
  const filenameHint = filenameHintFor(sourcePath);
  const titlePenalties = titlePenaltiesFor(extractedText);

  // Score every entry whose keywords contribute either a body hit or a
  // filename hint. An entry with no signal at all is skipped.
  const scored = [];
  for (const entry of table.CLASSIFICATION_TABLE) {
    const { hits, matched } = countMatches(signal, entry.keywords);
    const filenameBoost = filenameHint === entry.intakeType ? FILENAME_BOOST : 0;
    const penalty = titlePenalties[entry.intakeType] || 0;
    const score = hits + filenameBoost - penalty;
    if (hits === 0 && filenameBoost === 0) continue;
    scored.push({ entry, hits, matched, score, filenameBoost, penalty });
  }

  if (scored.length === 0) {
    return {
      ...table.UNKNOWN_TRIAGE,
      confidence: 0.3,
      rationale: 'No classification keywords matched filename, content excerpt, or related-doc titles.',
    };
  }

  // Deterministic ranking: highest score wins; ties broken by table order
  // (stable sort preserves CLASSIFICATION_TABLE order, which is curated).
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const runnerUp = scored[1] || null;

  // Confidence calibration: if the runner-up is within 0.1 of the winner,
  // the signal is ambiguous and confidence is capped at 0.5. Otherwise a
  // bounded ramp on raw hits: floor 0.4, +0.2 per hit, clamped at 1.0.
  const margin = runnerUp ? best.score - runnerUp.score : Infinity;
  const ambiguous = margin < 0.1;
  const baseConfidence = Math.min(1, 0.4 + 0.2 * best.hits);
  const confidence = ambiguous ? Math.min(0.5, baseConfidence) : baseConfidence;

  const matchedList = best.matched.slice(0, 4).join(', ');
  const rationaleParts = [];
  if (best.hits > 0) {
    rationaleParts.push(`matched ${best.hits} keyword${best.hits === 1 ? '' : 's'} (${matchedList || 'filename'})`);
  }
  if (best.filenameBoost > 0) rationaleParts.push('filename hint');
  if (best.penalty > 0) rationaleParts.push('title override applied');
  if (ambiguous && runnerUp) {
    rationaleParts.push(`ambiguous vs ${runnerUp.entry.intakeType} (margin ${margin.toFixed(2)})`);
  }
  const rationale = `Classified as ${best.entry.intakeType}: ${rationaleParts.join('; ')}.`;

  const { entry } = best;
  return {
    intakeType: entry.intakeType,
    rdStage: entry.rdStage,
    primaryOwner: entry.primaryOwner,
    recommendedChain: [...entry.recommendedChain],
    recommendedAction: entry.recommendedAction,
    risk: entry.risk,
    requiresApproval: entry.requiresApproval,
    confidence,
    rationale,
  };
}

export function formatTriageLine(sourcePath, triage) {
  const basename = sourcePath ? path.basename(sourcePath) : '(unknown source)';
  if (!triage || triage.intakeType === 'unknown') {
    return `${basename} → unclassified · owner: ${triage?.primaryOwner ?? 'orchestrator'} · next: ${triage?.recommendedAction ?? 'summarize'}`;
  }
  const ownerLabel = triage.primaryOwner ?? 'unassigned';
  return `${basename} → ${triage.intakeType} / ${triage.rdStage} · owner: ${ownerLabel} · next: ${triage.recommendedAction}`;
}
