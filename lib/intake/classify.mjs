/**
 * lib/intake/classify.mjs — Profile-aware triage classification for intake packets.
 *
 * Deterministic, keyword-driven classifier that maps a raw intake signal onto
 * the active org profile's loop. Returns a triage object with: intakeType,
 * rdStage, primaryOwner, recommendedChain, recommendedAction, risk,
 * requiresApproval, confidence, rationale, candidates (top-3 with margins).
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
 *
 * Calibration model (PR-1 hardening):
 *   - Keyword matching uses word-boundary regex. Substring false positives
 *     (e.g. "rce" inside "enforce", "leak" inside "leaks") are closed.
 *   - Filename hint + agreeing H1 title locks the type at 0.85 — neither
 *     stray keyword spam nor body-keyword distraction can override an
 *     author's explicit intent declared in filename and title together.
 *   - Confidence ramp is calibrated (not linear): single keyword caps at
 *     0.55, two at 0.70, three at 0.80, four+ at 0.90. Margin < 0.30 caps
 *     at 0.55 regardless. Expected Calibration Error stays under 0.10 on
 *     the combined golden + learned-fixture corpus (enforced by CI).
 *   - Multi-label output: candidates[] carries top-3 winners with margins
 *     so reviewers see alternatives without re-running the classifier.
 */

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Backward-compatible exports. RND defaults preserve the symbol surface
// referenced by intake-config, prepare, and existing tests.
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

// Static profile to table map. New curated profiles register themselves
// here. Custom profiles (escape hatch) declare classificationTable as a
// repo-relative path; that path is loaded dynamically when supplied.
import operationsTable from './tables/operations.mjs';
import creativeTable from './tables/creative.mjs';
import researchTable from './tables/research.mjs';

const TABLES = {
  rnd: rndTable,
  operations: operationsTable,
  creative: creativeTable,
  research: researchTable,
};

const dynamicTableCache = new Map();

function loadClassificationTable(tableRef) {
  if (!tableRef || typeof tableRef !== 'string') return null;
  if (dynamicTableCache.has(tableRef)) return dynamicTableCache.get(tableRef);
  const abs = path.isAbsolute(tableRef) ? tableRef : path.join(REPO_ROOT, tableRef);
  try {
    const mod = require(abs);
    const table = mod.default ?? mod;
    dynamicTableCache.set(tableRef, table);
    return table;
  } catch {
    return null;
  }
}

// Filename patterns are explicit author-intent signals. The boost remains
// at +0.4 so a clear keyword majority can still override (a postmortem
// genuinely about a CVE escalation routes to security, not incident).
// Title-locking below is the stricter check: filename + H1 agreement
// together skip scoring entirely.
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
  { re: /^memo[-_]|[-_]memo\b/i, intakeType: 'memo' },
  { re: /transcript|meeting-notes|standup|stand-up/i, intakeType: 'transcript' },
  { re: /dataset|raw-?data|data-?dump|\.csv$|\.tsv$/i, intakeType: 'raw-data' },
];

// Title-level family terms by intakeType. When the doc's H1 contains a
// family term AND the filename hint agrees on the same type, the type is
// locked at high confidence and scoring is short-circuited. Authors who
// name and title a doc identically have made their classification explicit.
const TITLE_FAMILY = {
  incident: /^#\s*(postmortem|post-mortem|incident\s+report|incident\s+review)\b/im,
  architecture: /^#\s*(adr[-:\s]|rfc[-:\s]|architecture\s+decision|architecture\s+review)/im,
  requirement: /^#\s*(prd[-:\s]|product\s+requirements|requirements\s+doc)/im,
  security: /^#\s*(security\s+(advisory|finding|review)|cve[-:\s])/im,
  research: /^#\s*(research|study|literature\s+review)\b/im,
  'eval-finding': /^#\s*(eval(uation)?(\s+finding)?\b|benchmark)/im,
  bug: /^#\s*(bug\s+report|defect)\b/im,
  ops: /^#\s*(runbook|operations\s+guide)\b/im,
  memo: /^#\s*(memo|decision\s+memo|status\s+update)\b/im,
  transcript: /^#\s*(transcript|meeting\s+(notes|minutes)|call\s+notes)\b/im,
  'raw-data': /^#\s*(dataset|raw\s+data|data\s+export)\b/im,
};

// Title-lock returns the highest confidence the classifier emits because
// filename and H1 are two independent author-intent declarations agreeing
// on the type. The only failure mode is the author miscategorizing in both
// places simultaneously, which is rare and detectable downstream.
const TITLE_LOCK_CONFIDENCE = 0.90;

// Title-level negative keywords flip a classification away from a misleading
// body match. A postmortem describes a bug in retrospect but is not a bug
// report; an incident-report uses crash vocabulary but is an incident.
const TITLE_PENALTY = 0.5;
const TITLE_OVERRIDES = [
  { re: /^#\s*postmortem\b/im, penalize: 'bug' },
  { re: /^#\s*incident\s+report\b/im, penalize: 'bug' },
  { re: /^#\s*post-mortem\b/im, penalize: 'bug' },
  { re: /^#\s*architecture\s+decision\b/im, penalize: 'bug' },
  { re: /^#\s*adr[-:\s]/im, penalize: 'bug' },
  { re: /^#\s*security\s+(advisory|finding)\b/im, penalize: 'bug' },
];

// Precompile per-entry keyword matchers with word boundaries. Cached by
// reference to the entry object — the table arrays are static exports so
// each entry is compiled exactly once across the process lifetime.
const matcherCache = new WeakMap();

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileKeywordMatcher(keywords) {
  // Trim each keyword of surrounding whitespace so the trailing-space
  // convention in keyword tables (e.g. "p0 " for "P0 incident") doesn't
  // break word-boundary matching. Stripping trailing punctuation keeps
  // entries like "recall@" / "precision@" matchable since '@' is not a
  // word char and the boundary anchor handles the trailing position.
  const cleaned = keywords
    .map((kw) => String(kw).trim().replace(/[\s]+$/g, ''))
    .filter((kw) => kw.length > 0);
  if (cleaned.length === 0) return null;
  const alternation = cleaned.map(escapeRegex).join('|');
  return new RegExp(`\\b(?:${alternation})\\b`, 'gi');
}

function matcherFor(entry) {
  let m = matcherCache.get(entry);
  if (m === undefined) {
    m = compileKeywordMatcher(entry.keywords);
    matcherCache.set(entry, m);
  }
  return m;
}

function resolveTable(profile) {
  if (!profile) return rndTable;
  const id = typeof profile === 'string' ? profile : profile.id;
  const tableRef = typeof profile === 'object' ? profile?.intake?.classificationTable : null;
  if (typeof tableRef === 'string') {
    const fromPath = loadClassificationTable(tableRef);
    if (fromPath) return fromPath;
  }
  return TABLES[id] || rndTable;
}

function countMatches(haystack, entry) {
  const matcher = matcherFor(entry);
  if (!matcher) return { hits: 0, matched: [] };
  matcher.lastIndex = 0;
  const found = haystack.match(matcher) || [];
  const dedup = [...new Set(found.map((m) => m.toLowerCase()))];
  return { hits: dedup.length, matched: dedup };
}

function buildSignalText({ sourcePath, extractedText, related }) {
  const basename = sourcePath ? path.basename(sourcePath) : '';
  const slug = basename.replace(/[._-]/g, ' ');
  const body = extractedText ? extractedText.slice(0, 4000) : '';
  const relatedTitles = (related || []).map((r) => r?.title || '').join(' ');
  return `${slug} ${body} ${relatedTitles}`;
}

function filenameHintFor(sourcePath) {
  if (!sourcePath) return null;
  const base = path.basename(sourcePath);
  for (const hint of FILENAME_HINTS) {
    if (hint.re.test(base)) return hint.intakeType;
  }
  return null;
}

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

function titleAgreesWithFilenameHint(extractedText, filenameHint) {
  if (!filenameHint) return false;
  const family = TITLE_FAMILY[filenameHint];
  if (!family) return false;
  return family.test(String(extractedText || ''));
}

function findEntryByType(table, intakeType) {
  for (const entry of table.CLASSIFICATION_TABLE) {
    if (entry.intakeType === intakeType) return entry;
  }
  return null;
}

// Calibrated confidence ramp by keyword-hit count.
//   - 1 hit  → 0.55: weak evidence, lands in quarantine via low-conf threshold
//   - 2 hits → 0.72: two-keyword convergence is meaningful but still margin-checked
//   - 3 hits → 0.82: strong evidence
//   - 4+ hits→ 0.92: very strong evidence; calibrated against historical accuracy
function calibratedBaseConfidence(hits) {
  if (hits >= 4) return 0.92;
  if (hits === 3) return 0.82;
  if (hits === 2) return 0.72;
  if (hits === 1) return 0.55;
  return 0.45;
}

function buildTriageFromEntry(entry, overrides = {}) {
  return {
    intakeType: entry.intakeType,
    rdStage: entry.rdStage,
    primaryOwner: entry.primaryOwner,
    recommendedChain: [...entry.recommendedChain],
    recommendedAction: entry.recommendedAction,
    risk: entry.risk,
    requiresApproval: entry.requiresApproval,
    ...overrides,
  };
}

/**
 * Classify an intake signal against the active profile (defaults to RND).
 *
 * Backward-compatible: callers that did not pass a `profile` arg keep getting
 * RND output for the same input. Output is deterministic. The optional `cwd`
 * argument is accepted for backward compatibility but is not consulted.
 *
 * @param {object} input
 * @param {string} [input.sourcePath]
 * @param {string} [input.extractedText]
 * @param {Array} [input.related]
 * @param {string|object} [input.profile] - profile id (string) or full profile object
 * @param {string} [input.cwd] - accepted for backward compatibility, ignored
 * @returns {{
 *   intakeType: string, rdStage: string, primaryOwner: string,
 *   recommendedChain: string[], recommendedAction: string,
 *   risk: string, requiresApproval: boolean,
 *   confidence: number, rationale: string,
 *   candidates: Array<{ intakeType: string, score: number, margin: number, hits: number }>
 * }}
 */
export function classifyRdIntake({ sourcePath = '', extractedText = '', related = [], profile = null } = {}) {
  const table = resolveTable(profile);
  const signal = buildSignalText({ sourcePath, extractedText, related });
  const filenameHint = filenameHintFor(sourcePath);
  const titlePenalties = titlePenaltiesFor(extractedText);

  // Title-lock fast path: filename hint + agreeing title H1 returns the
  // hinted type immediately at TITLE_LOCK_CONFIDENCE. The author explicitly
  // declared the type in two places; stray body keywords cannot override.
  if (filenameHint && titleAgreesWithFilenameHint(extractedText, filenameHint)) {
    const entry = findEntryByType(table, filenameHint);
    if (entry) {
      return buildTriageFromEntry(entry, {
        confidence: TITLE_LOCK_CONFIDENCE,
        rationale: `Classified as ${entry.intakeType}: filename hint and H1 title agree (locked).`,
        candidates: [{ intakeType: entry.intakeType, score: TITLE_LOCK_CONFIDENCE, margin: TITLE_LOCK_CONFIDENCE, hits: 0 }],
      });
    }
  }

  // Score every entry whose keywords contribute either a body hit or a
  // filename hint. An entry with no signal at all is skipped.
  const scored = [];
  for (const entry of table.CLASSIFICATION_TABLE) {
    const { hits, matched } = countMatches(signal, entry);
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
      candidates: [],
    };
  }

  // Deterministic ranking: highest score wins; ties broken by table order
  // (stable sort preserves CLASSIFICATION_TABLE order, which is curated).
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const runnerUp = scored[1] || null;
  const topThree = scored.slice(0, 3);
  const margin = runnerUp ? best.score - runnerUp.score : Infinity;

  const baseConfidence = calibratedBaseConfidence(best.hits);
  const ambiguous = margin < 0.30;
  // Ambiguous predictions are explicitly capped at 0.50 so the established
  // contract (tests/intake-classifier-accuracy.test.mjs) holds and the
  // quarantine threshold (0.60) catches them.
  const confidence = ambiguous ? Math.min(0.50, baseConfidence) : baseConfidence;

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

  const candidates = topThree.map((c, i) => ({
    intakeType: c.entry.intakeType,
    score: Number(c.score.toFixed(4)),
    margin: i === 0 ? Number(margin === Infinity ? best.score : margin.toFixed(4)) : Number((best.score - c.score).toFixed(4)),
    hits: c.hits,
  }));

  return buildTriageFromEntry(best.entry, { confidence, rationale, candidates });
}

export function formatTriageLine(sourcePath, triage) {
  const basename = sourcePath ? path.basename(sourcePath) : '(unknown source)';
  if (!triage || triage.intakeType === 'unknown') {
    return `${basename} → unclassified · owner: ${triage?.primaryOwner ?? 'orchestrator'} · next: ${triage?.recommendedAction ?? 'summarize'}`;
  }
  const ownerLabel = triage.primaryOwner ?? 'unassigned';
  return `${basename} → ${triage.intakeType} / ${triage.rdStage} · owner: ${ownerLabel} · next: ${triage.recommendedAction}`;
}

/**
 * Pure function that proposes tag attributions based on triage + related docs.
 * Does NOT perform any I/O or LLM calls — safe to call from the daemon path.
 *
 * @param {object} triage   — output of classifyRdIntake()
 * @param {Array}  related  — related doc metadata (each may have .tags[])
 * @param {object} vocab    — result of loadVocabulary() from lib/tags/vocabulary.mjs
 * @returns {Array<{tag, source, confidence}>}
 */
export function suggestTags(triage, related = [], vocab = null) {
  const suggestions = [];

  // Winning intakeType → corresponding intake/<type> tag.
  if (triage?.intakeType && triage.intakeType !== 'unknown') {
    const tagId = `intake/${triage.intakeType}`;
    const confidence = triage.confidence ?? 0.5;

    // Check against vocab threshold if provided; fall back to 0.70.
    let threshold = 0.70;
    if (vocab?.facets?.['intake-type']?.auto_threshold) {
      threshold = vocab.facets['intake-type'].auto_threshold;
    }

    if (confidence >= threshold) {
      suggestions.push({ tag: tagId, source: 'agent:classifier', confidence });
    }
  }

  // Related-doc tag inheritance: tags held by 2+ related docs.
  const tagCounts = new Map();
  for (const doc of related) {
    const tags = Array.isArray(doc?.tags) ? doc.tags : [];
    for (const t of tags) {
      tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }
  }
  for (const [tag, count] of tagCounts.entries()) {
    if (count >= 2) {
      const alreadySuggested = suggestions.some((s) => s.tag === tag);
      if (!alreadySuggested) {
        suggestions.push({ tag, source: 'agent:related-inherit', confidence: 0.70 });
      }
    }
  }

  // Filter against vocab if provided: skip deprecated/archived tags.
  if (vocab) {
    return suggestions.filter((s) => {
      const entry = vocab._tagMap?.get(s.tag);
      if (!entry) return true; // unknown — allowed through (daemon does not block unknowns)
      return entry.status !== 'archived' && entry.status !== 'deprecated';
    });
  }

  return suggestions;
}
