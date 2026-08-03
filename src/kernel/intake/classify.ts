/**
 * kernel/intake/classify.ts — workspace-preset-aware triage classification.
 * Ported from construct-legacy lib/intake/classify.mjs.
 *
 * A deterministic, keyword-driven classifier that maps a raw intake signal onto
 * the active preset's loop. Classification MUST be a pure function of
 * (sourcePath, extractedText, related, preset): the same input yields identical
 * output across runs, forever. Outcome-aware re-ranking is deliberately not
 * consulted — cached success-rate history would make the same file classify
 * differently on a second run, which is a non-determinism bug, not a feature.
 * Outcomes may influence downstream routing; never classification.
 *
 * No model call. Classification stays synchronous and cheap; intent
 * verification belongs in offline measurement, not inline.
 *
 * Calibration model, carried over unchanged:
 *   - Keyword matching is word-boundary anchored, so substring false positives
 *     ("rce" inside "enforce", "leak" inside "leaks") cannot fire.
 *   - A filename hint plus an agreeing H1 title locks the type and skips
 *     scoring: two independent author-intent declarations beat stray body
 *     keywords.
 *   - The confidence ramp is calibrated, not linear: 1 hit caps at 0.55, 2 at
 *     0.72, 3 at 0.82, 4+ at 0.92. A margin under 0.30 caps the result at 0.50
 *     regardless, so an ambiguous call lands below the 0.60 quarantine line.
 *
 * Where the v2 header comment and v2's code disagreed on a constant (the header
 * said a title lock scored 0.85 and two hits 0.70; the code used 0.90 and 0.72),
 * the code is the behavior under test, so the code is what was ported and the
 * prose here was corrected to match it.
 */

import path from 'node:path';
import { DEFAULT_TABLE, TABLES } from './table.ts';
import type { ClassificationEntry, ClassificationTable, Triage } from './table.ts';

export interface RelatedDoc {
  readonly title?: string;
  readonly tags?: readonly string[];
}

export interface ClassifyInput {
  readonly sourcePath?: string;
  readonly extractedText?: string;
  readonly related?: readonly RelatedDoc[];
  /** A preset id registered in TABLES, or a table to use directly. */
  readonly preset?: string | ClassificationTable | null;
}

export interface Candidate {
  readonly intakeType: string;
  readonly score: number;
  readonly margin: number;
  readonly hits: number;
}

export interface TriageResult extends Triage {
  readonly confidence: number;
  readonly rationale: string;
  readonly candidates: readonly Candidate[];
}

/**
 * Filename patterns are explicit author-intent signals. The boost stays at +0.4
 * so a clear keyword majority can still override it — a postmortem genuinely
 * about a CVE escalation routes to security, not incident. Title-locking below
 * is the stricter check.
 */
const FILENAME_BOOST = 0.4;

const FILENAME_HINTS: readonly { re: RegExp; intakeType: string }[] = [
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

/**
 * Title-level family terms by intakeType. When the doc's H1 carries a family
 * term AND the filename hint agrees on the same type, the type locks at high
 * confidence and scoring short-circuits. The only failure mode is an author
 * miscategorizing in both places at once, which is rare and caught downstream.
 */
const TITLE_FAMILY: Readonly<Record<string, RegExp>> = {
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

const TITLE_LOCK_CONFIDENCE = 0.9;

/**
 * Title-level negative keywords flip a classification away from a misleading
 * body match: a postmortem describes a bug in retrospect but is not a bug
 * report, and an incident report uses crash vocabulary but is an incident.
 */
const TITLE_PENALTY = 0.5;

const TITLE_OVERRIDES: readonly { re: RegExp; penalize: string }[] = [
  { re: /^#\s*postmortem\b/im, penalize: 'bug' },
  { re: /^#\s*incident\s+report\b/im, penalize: 'bug' },
  { re: /^#\s*post-mortem\b/im, penalize: 'bug' },
  { re: /^#\s*architecture\s+decision\b/im, penalize: 'bug' },
  { re: /^#\s*adr[-:\s]/im, penalize: 'bug' },
  { re: /^#\s*security\s+(advisory|finding)\b/im, penalize: 'bug' },
];

/**
 * Per-entry keyword matchers, compiled once and cached by entry identity. The
 * tables are module-level frozen data, so each entry compiles exactly once per
 * process; a WeakMap means a caller-supplied ad-hoc table doesn't leak.
 */
const matcherCache = new WeakMap<ClassificationEntry, RegExp | null>();

function escapeRegex(str: string): string {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileKeywordMatcher(keywords: readonly string[]): RegExp | null {
  // Trim each keyword so the trailing-space convention in the tables (e.g.
  // "p0 " for "P0 incident") doesn't break word-boundary matching. Entries like
  // "recall@" stay matchable: '@' is not a word char, so the boundary anchor
  // handles the trailing position.
  const cleaned = keywords
    .map((kw) => String(kw).trim().replace(/\s+$/g, ''))
    .filter((kw) => kw.length > 0);
  if (cleaned.length === 0) return null;
  return new RegExp(`\\b(?:${cleaned.map(escapeRegex).join('|')})\\b`, 'gi');
}

function matcherFor(entry: ClassificationEntry): RegExp | null {
  let m = matcherCache.get(entry);
  if (m === undefined) {
    m = compileKeywordMatcher(entry.keywords);
    matcherCache.set(entry, m);
  }
  return m;
}

function resolveTable(preset: string | ClassificationTable | null | undefined): ClassificationTable {
  if (!preset) return DEFAULT_TABLE;
  if (typeof preset === 'string') return TABLES[preset] ?? DEFAULT_TABLE;
  // A caller-supplied table wins outright; anything table-shaped is usable.
  if (Array.isArray(preset.CLASSIFICATION_TABLE)) return preset;
  return TABLES[preset.id] ?? DEFAULT_TABLE;
}

function countMatches(
  haystack: string,
  entry: ClassificationEntry,
): { hits: number; matched: string[] } {
  const matcher = matcherFor(entry);
  if (!matcher) return { hits: 0, matched: [] };
  matcher.lastIndex = 0;
  const found = haystack.match(matcher) ?? [];
  const dedup = [...new Set(found.map((m) => m.toLowerCase()))];
  return { hits: dedup.length, matched: dedup };
}

function buildSignalText(input: ClassifyInput): string {
  const basename = input.sourcePath ? path.basename(input.sourcePath) : '';
  const slug = basename.replace(/[._-]/g, ' ');
  const body = input.extractedText ? input.extractedText.slice(0, 4000) : '';
  const relatedTitles = (input.related ?? []).map((r) => r?.title ?? '').join(' ');
  return `${slug} ${body} ${relatedTitles}`;
}

function filenameHintFor(sourcePath: string): string | null {
  if (!sourcePath) return null;
  const base = path.basename(sourcePath);
  for (const hint of FILENAME_HINTS) {
    if (hint.re.test(base)) return hint.intakeType;
  }
  return null;
}

function titlePenaltiesFor(extractedText: string): Record<string, number> {
  const penalties: Record<string, number> = {};
  const text = String(extractedText ?? '');
  for (const rule of TITLE_OVERRIDES) {
    if (rule.re.test(text)) {
      penalties[rule.penalize] = (penalties[rule.penalize] ?? 0) + TITLE_PENALTY;
    }
  }
  return penalties;
}

function titleAgreesWithFilenameHint(extractedText: string, filenameHint: string | null): boolean {
  if (!filenameHint) return false;
  const family = TITLE_FAMILY[filenameHint];
  if (!family) return false;
  return family.test(String(extractedText ?? ''));
}

function findEntryByType(
  table: ClassificationTable,
  intakeType: string,
): ClassificationEntry | null {
  for (const entry of table.CLASSIFICATION_TABLE) {
    if (entry.intakeType === intakeType) return entry;
  }
  return null;
}

/**
 * Calibrated confidence ramp by keyword-hit count.
 *   1 hit  → 0.55  weak evidence; lands in quarantine via the low-confidence threshold
 *   2 hits → 0.72  meaningful convergence, still margin-checked
 *   3 hits → 0.82  strong
 *   4+     → 0.92  very strong
 */
function calibratedBaseConfidence(hits: number): number {
  if (hits >= 4) return 0.92;
  if (hits === 3) return 0.82;
  if (hits === 2) return 0.72;
  if (hits === 1) return 0.55;
  return 0.45;
}

function buildTriageFromEntry(
  entry: ClassificationEntry,
  overrides: { confidence: number; rationale: string; candidates: readonly Candidate[] },
): TriageResult {
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

/** Classify an intake signal against a workspace preset. Deterministic. */
export function classifyIntake(input: ClassifyInput = {}): TriageResult {
  const sourcePath = input.sourcePath ?? '';
  const extractedText = input.extractedText ?? '';
  const table = resolveTable(input.preset);
  const signal = buildSignalText({ sourcePath, extractedText, related: input.related ?? [] });
  const filenameHint = filenameHintFor(sourcePath);
  const titlePenalties = titlePenaltiesFor(extractedText);

  // Title-lock fast path: filename hint plus an agreeing H1 returns the hinted
  // type immediately. The author declared the type in two places; stray body
  // keywords do not get to overrule that.
  if (filenameHint && titleAgreesWithFilenameHint(extractedText, filenameHint)) {
    const entry = findEntryByType(table, filenameHint);
    if (entry) {
      return buildTriageFromEntry(entry, {
        confidence: TITLE_LOCK_CONFIDENCE,
        rationale: `Classified as ${entry.intakeType}: filename hint and H1 title agree (locked).`,
        candidates: [
          {
            intakeType: entry.intakeType,
            score: TITLE_LOCK_CONFIDENCE,
            margin: TITLE_LOCK_CONFIDENCE,
            hits: 0,
          },
        ],
      });
    }
  }

  // Score every entry contributing either a body hit or a filename hint; an
  // entry with no signal at all is skipped rather than scored at zero.
  const scored: {
    entry: ClassificationEntry;
    hits: number;
    matched: string[];
    score: number;
    filenameBoost: number;
    penalty: number;
  }[] = [];

  for (const entry of table.CLASSIFICATION_TABLE) {
    const { hits, matched } = countMatches(signal, entry);
    const filenameBoost = filenameHint === entry.intakeType ? FILENAME_BOOST : 0;
    const penalty = titlePenalties[entry.intakeType] ?? 0;
    const score = hits + filenameBoost - penalty;
    if (hits === 0 && filenameBoost === 0) continue;
    scored.push({ entry, hits, matched, score, filenameBoost, penalty });
  }

  if (scored.length === 0) {
    return {
      ...table.UNKNOWN_TRIAGE,
      recommendedChain: [...table.UNKNOWN_TRIAGE.recommendedChain],
      confidence: 0.3,
      rationale:
        'No classification keywords matched filename, content excerpt, or related-doc titles.',
      candidates: [],
    };
  }

  // Deterministic ranking: highest score wins, ties broken by table order — the
  // sort is stable and CLASSIFICATION_TABLE order is curated.
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  const runnerUp = scored[1] ?? null;
  const topThree = scored.slice(0, 3);
  const margin = runnerUp ? best.score - runnerUp.score : Infinity;

  const baseConfidence = calibratedBaseConfidence(best.hits);
  const ambiguous = margin < 0.3;
  // An ambiguous prediction is capped at 0.50 so the 0.60 quarantine threshold
  // always catches it.
  const confidence = ambiguous ? Math.min(0.5, baseConfidence) : baseConfidence;

  const matchedList = best.matched.slice(0, 4).join(', ');
  const rationaleParts: string[] = [];
  if (best.hits > 0) {
    rationaleParts.push(
      `matched ${best.hits} keyword${best.hits === 1 ? '' : 's'} (${matchedList || 'filename'})`,
    );
  }
  if (best.filenameBoost > 0) rationaleParts.push('filename hint');
  if (best.penalty > 0) rationaleParts.push('title override applied');
  if (ambiguous && runnerUp) {
    rationaleParts.push(`ambiguous vs ${runnerUp.entry.intakeType} (margin ${margin.toFixed(2)})`);
  }
  const rationale = `Classified as ${best.entry.intakeType}: ${rationaleParts.join('; ')}.`;

  const candidates: Candidate[] = topThree.map((c, i) => ({
    intakeType: c.entry.intakeType,
    score: Number(c.score.toFixed(4)),
    margin:
      i === 0
        ? Number(margin === Infinity ? best.score : margin.toFixed(4))
        : Number((best.score - c.score).toFixed(4)),
    hits: c.hits,
  }));

  return buildTriageFromEntry(best.entry, { confidence, rationale, candidates });
}

export function formatTriageLine(sourcePath: string, triage: TriageResult | null): string {
  const basename = sourcePath ? path.basename(sourcePath) : '(unknown source)';
  if (!triage || triage.intakeType === 'unknown') {
    return `${basename} → unclassified · owner: ${triage?.primaryOwner ?? 'orchestrator'} · next: ${triage?.recommendedAction ?? 'summarize'}`;
  }
  return `${basename} → ${triage.intakeType} / ${triage.rdStage} · owner: ${triage.primaryOwner ?? 'unassigned'} · next: ${triage.recommendedAction}`;
}

export interface TagVocabularyEntry {
  readonly status?: string;
}

export interface TagVocabulary {
  readonly facets?: Record<string, { auto_threshold?: number } | undefined>;
  readonly tagMap?: ReadonlyMap<string, TagVocabularyEntry>;
}

export interface TagSuggestion {
  readonly tag: string;
  readonly source: string;
  readonly confidence: number;
}

/**
 * Propose tag attributions from a triage plus related docs. Pure — no IO, no
 * model call. The vocabulary is injected rather than loaded (v2 read it off
 * disk through a loader); `tagMap` is the same lookup v2 kept on the private
 * `_tagMap` field, made part of the declared input instead of a hidden one.
 */
export function suggestTags(
  triage: TriageResult | null,
  related: readonly RelatedDoc[] = [],
  vocab: TagVocabulary | null = null,
): readonly TagSuggestion[] {
  const suggestions: TagSuggestion[] = [];

  // The winning intakeType becomes an intake/<type> tag, if it clears the
  // facet's auto-attribution threshold.
  if (triage?.intakeType && triage.intakeType !== 'unknown') {
    const confidence = triage.confidence ?? 0.5;
    const threshold = vocab?.facets?.['intake-type']?.auto_threshold ?? 0.7;
    if (confidence >= threshold) {
      suggestions.push({
        tag: `intake/${triage.intakeType}`,
        source: 'agent:classifier',
        confidence,
      });
    }
  }

  // Related-doc tag inheritance: a tag held by 2+ related docs carries over.
  const tagCounts = new Map<string, number>();
  for (const doc of related) {
    for (const t of Array.isArray(doc?.tags) ? doc.tags : []) {
      tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    }
  }
  for (const [tag, count] of tagCounts) {
    if (count >= 2 && !suggestions.some((s) => s.tag === tag)) {
      suggestions.push({ tag, source: 'agent:related-inherit', confidence: 0.7 });
    }
  }

  if (!vocab) return suggestions;
  return suggestions.filter((s) => {
    const entry = vocab.tagMap?.get(s.tag);
    // An unknown tag is allowed through — classification does not block on
    // vocabulary it has never seen.
    if (!entry) return true;
    return entry.status !== 'archived' && entry.status !== 'deprecated';
  });
}
