/**
 * lib/intake/classify.mjs — Profile-aware triage classification for intake packets.
 *
 * Deterministic, keyword-driven classifier that maps a raw intake signal onto
 * the active org profile's loop. Returns a triage object with: intakeType,
 * rdStage, primaryOwner, recommendedChain, recommendedAction, risk,
 * requiresApproval, confidence, rationale.
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

// Static profile → table map. New curated profiles register themselves here.
// Custom profiles (escape hatch) declare classificationTable as a repo-relative
// path; that path is loaded dynamically in classifyRdIntake when a profile arg
// supplies it.
import operationsTable from './tables/operations.mjs';
import creativeTable from './tables/creative.mjs';
import researchTable from './tables/research.mjs';
import { outcomeBoost } from '../outcomes/aggregate.mjs';

// Outcome boost is a soft re-rank applied when a cwd is supplied. Capped at
// ±0.05 in outcomeBoost itself, so the primary keyword signal (integer hits)
// always dominates. Returns 0 if no outcome data exists for the role.
function outcomeBoostFor(cwd, role) {
  if (!cwd || !role) return 0;
  try { return outcomeBoost(cwd, role); } catch { return 0; }
}

const TABLES = {
  rnd: rndTable,
  operations: operationsTable,
  creative: creativeTable,
  research: researchTable,
};

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

/**
 * Classify an intake signal against the active profile (defaults to RND).
 *
 * Backward-compatible: callers that did not pass a `profile` arg keep getting
 * RND output, byte-identical to the pre-B2 behavior.
 *
 * @param {object} input
 * @param {string} [input.sourcePath]
 * @param {string} [input.extractedText]
 * @param {Array} [input.related]
 * @param {string|object} [input.profile] - profile id (string) or full profile object
 */
export function classifyRdIntake({ sourcePath = '', extractedText = '', related = [], profile = null, cwd = null } = {}) {
  const table = resolveTable(profile);
  const signal = buildSignalText({ sourcePath, extractedText, related });

  let best = null;
  for (const entry of table.CLASSIFICATION_TABLE) {
    const { hits, matched } = countMatches(signal, entry.keywords);
    if (hits === 0) continue;
    const boost = cwd ? outcomeBoostFor(cwd, entry.primaryOwner) : 0;
    const score = hits + boost;
    if (!best || score > best.score) {
      best = { entry, hits, matched, score };
    }
  }

  if (!best) {
    return {
      ...table.UNKNOWN_TRIAGE,
      confidence: 0.3,
      rationale: 'No classification keywords matched filename, content excerpt, or related-doc titles.',
    };
  }

  const { entry, hits, matched } = best;
  const confidence = Math.min(1, 0.4 + 0.2 * hits);
  const matchedList = matched.slice(0, 4).join(', ');
  const rationale = `Matched ${hits} keyword${hits === 1 ? '' : 's'} for ${entry.intakeType}: ${matchedList}.`;

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
