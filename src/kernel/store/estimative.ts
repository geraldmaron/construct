/**
 * kernel/store/estimative.ts — the calibration log: every likelihood a run
 * stated, and the observation that settles it.
 *
 * A band is only worth anything if somebody can go back later and check
 * whether the things called likely happened more often than the things called
 * unlikely. That check needs three facts written down at the moment of the
 * judgment and not reconstructed afterwards: the whole number, the observation
 * that settles the claim, and the date or event by which it settles. All three
 * are required columns for that reason.
 *
 * The number is stored, not the band word. A band is a rendering of an
 * integer, deriving it costs nothing, and a curve drawn over seven labels
 * discards most of what the assessor said.
 *
 * Resolutions live in a companion table keyed to `seq`. The judgment row is
 * never updated (append-only triggers); a second resolution for the same seq
 * is refused. Until enough resolutions exist, the report prints counts and
 * refuses a rate — RESEARCH-DECISIONS §1.
 */

import type { Store } from './open.ts';
import type { AssessedRisk, EstimativeBand } from '../run/estimative.ts';
import { bandFor } from '../run/estimative.ts';
import { requiredTrials } from '../metrics/intervals.ts';
import { getDecision, raiseDecision } from './decisions.ts';

export const RESOLUTION_OUTCOMES = ['happened', 'did_not_happen', 'unresolvable'] as const;
export type ResolutionOutcome = (typeof RESOLUTION_OUTCOMES)[number];

export interface LoggedJudgment {
  readonly seq: number;
  readonly run: string;
  /** The inbox decision this was stated in, when it was stated in one. */
  readonly decision: string | null;
  readonly claim: string;
  readonly percent: number;
  readonly confidence: 'high' | 'moderate';
  readonly resolution: string;
  readonly horizon: string;
  readonly referenceClass: string | null;
  readonly recordedAt: string;
}

export interface JudgmentResolution {
  readonly judgment: number;
  readonly outcome: ResolutionOutcome;
  readonly resolvedAt: string;
}

/**
 * How many scored resolutions are required before a Brier figure is printed.
 * Derived from RESEARCH-DECISIONS §1 via `requiredTrials` for telling a 0.15
 * true rate from a 0.30 baseline (one-sample, alpha 0.05, power 0.8).
 */
export const CALIBRATION_N_FLOOR = requiredTrials({ baseline: 0.3, target: 0.15 });

/**
 * Log one stated likelihood. `at` is supplied; the kernel never reads the
 * clock.
 */
export function recordEstimativeJudgment(
  store: Store,
  entry: { readonly run: string; readonly decision?: string | null; readonly judgment: AssessedRisk },
  at: string,
): void {
  const { judgment } = entry;
  if (judgment.confidence.level === 'low') {
    throw new Error('recordEstimativeJudgment: a low-confidence judgment states no likelihood');
  }
  store.db
    .prepare(
      `INSERT INTO estimative_judgments
         (run, decision, claim, percent, confidence, resolution, horizon, reference_class, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.run,
      entry.decision ?? null,
      judgment.claim,
      judgment.percent,
      judgment.confidence.level,
      judgment.resolution,
      judgment.horizon,
      judgment.referenceClass,
      at,
    );
}

function mapJudgment(row: {
  seq: number;
  run: string;
  decision: string | null;
  claim: string;
  percent: number;
  confidence: string;
  resolution: string;
  horizon: string;
  reference_class: string | null;
  recorded_at: string;
}): LoggedJudgment {
  return {
    seq: row.seq,
    run: row.run,
    decision: row.decision,
    claim: row.claim,
    percent: row.percent,
    confidence: row.confidence as 'high' | 'moderate',
    resolution: row.resolution,
    horizon: row.horizon,
    referenceClass: row.reference_class,
    recordedAt: row.recorded_at,
  };
}

/** Everything judged on one run, oldest first — or on every run when none is named. */
export function estimativeJudgmentsFor(store: Store, run?: string): LoggedJudgment[] {
  const rows = (
    run
      ? store.db
          .prepare(
            `SELECT seq, run, decision, claim, percent, confidence, resolution, horizon,
                    reference_class, recorded_at
             FROM estimative_judgments WHERE run = ? ORDER BY seq`,
          )
          .all(run)
      : store.db
          .prepare(
            `SELECT seq, run, decision, claim, percent, confidence, resolution, horizon,
                    reference_class, recorded_at
             FROM estimative_judgments ORDER BY seq`,
          )
          .all()
  ) as Parameters<typeof mapJudgment>[0][];
  return rows.map(mapJudgment);
}

export function estimativeJudgmentBySeq(store: Store, seq: number): LoggedJudgment | null {
  const row = store.db
    .prepare(
      `SELECT seq, run, decision, claim, percent, confidence, resolution, horizon,
              reference_class, recorded_at
       FROM estimative_judgments WHERE seq = ?`,
    )
    .get(seq) as Parameters<typeof mapJudgment>[0] | undefined;
  return row ? mapJudgment(row) : null;
}

export function estimativeResolutionFor(store: Store, seq: number): JudgmentResolution | null {
  const row = store.db
    .prepare(`SELECT judgment, outcome, resolved_at FROM estimative_resolutions WHERE judgment = ?`)
    .get(seq) as { judgment: number; outcome: string; resolved_at: string } | undefined;
  if (!row) return null;
  return {
    judgment: row.judgment,
    outcome: row.outcome as ResolutionOutcome,
    resolvedAt: row.resolved_at,
  };
}

/**
 * Record whether the claim happened. Exactly once per judgment; a second call
 * throws. `unresolvable` is counted separately from Brier scoring.
 */
export function resolveEstimativeJudgment(
  store: Store,
  seq: number,
  outcome: ResolutionOutcome,
  at: string,
): JudgmentResolution {
  if (!(RESOLUTION_OUTCOMES as readonly string[]).includes(outcome)) {
    throw new Error(`resolveEstimativeJudgment: unknown outcome ${JSON.stringify(outcome)}`);
  }
  const judgment = estimativeJudgmentBySeq(store, seq);
  if (judgment === null) {
    throw new Error(`resolveEstimativeJudgment: no judgment ${String(seq)}`);
  }
  if (estimativeResolutionFor(store, seq) !== null) {
    throw new Error(`resolveEstimativeJudgment: judgment ${String(seq)} is already resolved`);
  }
  try {
    store.db
      .prepare(
        `INSERT INTO estimative_resolutions (judgment, outcome, resolved_at) VALUES (?, ?, ?)`,
      )
      .run(seq, outcome, at);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE|PRIMARY KEY/i.test(message)) {
      throw new Error(`resolveEstimativeJudgment: judgment ${String(seq)} is already resolved`);
    }
    throw error;
  }
  return { judgment: seq, outcome, resolvedAt: at };
}

/**
 * When the horizon becomes due, if it can be parsed. ISO date (optionally with
 * time) at the start of the string, or `within N days` from recorded_at.
 * Relative prose the parser cannot read returns null — listable, not auto-nudged.
 * No `Date` constructor: the store module never reads the clock.
 */
export function horizonDueAt(horizon: string, recordedAt: string): string | null {
  const iso = horizon.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[T ]([\d:.]+))?/);
  if (iso) {
    const time = iso[2] ? normalizeTime(iso[2]) : '00:00:00.000';
    return `${iso[1]}T${time}Z`;
  }
  const within = horizon.trim().match(/^within\s+(\d+)\s+days?\b/i);
  if (within) return addUtcDays(recordedAt, Number(within[1]));
  return null;
}

function normalizeTime(raw: string): string {
  const parts = raw.replace(/Z$/, '').split(':');
  const h = (parts[0] ?? '00').padStart(2, '0');
  const m = (parts[1] ?? '00').padStart(2, '0');
  let s = parts[2] ?? '00';
  if (!s.includes('.')) s = `${s}.000`;
  else {
    const [whole, frac = ''] = s.split('.');
    s = `${whole}.${frac.padEnd(3, '0').slice(0, 3)}`;
  }
  return `${h}:${m}:${s}`;
}

function addUtcDays(iso: string, days: number): string | null {
  const match = iso.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?)?/,
  );
  if (!match) return null;
  let year = Number(match[1]);
  let month = Number(match[2]);
  let day = Number(match[3]) + days;
  const hour = match[4] ?? '00';
  const minute = match[5] ?? '00';
  const second = match[6] ?? '00';
  const frac = (match[7] ?? '000').padEnd(3, '0').slice(0, 3);
  const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = (y: number, m: number): number =>
    [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
  while (day > dim(year, month)) {
    day -= dim(year, month);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  while (day < 1) {
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    day += dim(year, month);
  }
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${hour}:${minute}:${second}.${frac}Z`;
}

export function isHorizonOverdue(horizon: string, recordedAt: string, at: string): boolean {
  const due = horizonDueAt(horizon, recordedAt);
  if (due === null) return false;
  return due <= at;
}

export interface UnresolvedJudgment extends LoggedJudgment {
  readonly overdue: boolean;
  /** True when the horizon string could not be turned into a due instant. */
  readonly horizonUnparsed: boolean;
}

/** Judgments with no resolution row, oldest first. */
export function unresolvedEstimativeJudgments(store: Store, at: string): UnresolvedJudgment[] {
  const rows = store.db
    .prepare(
      `SELECT j.seq, j.run, j.decision, j.claim, j.percent, j.confidence, j.resolution,
              j.horizon, j.reference_class, j.recorded_at
       FROM estimative_judgments j
       LEFT JOIN estimative_resolutions r ON r.judgment = j.seq
       WHERE r.judgment IS NULL
       ORDER BY j.seq`,
    )
    .all() as Parameters<typeof mapJudgment>[0][];
  return rows.map((row) => {
    const judgment = mapJudgment(row);
    const due = horizonDueAt(judgment.horizon, judgment.recordedAt);
    return {
      ...judgment,
      overdue: due !== null && due <= at,
      horizonUnparsed: due === null,
    };
  });
}

/** Stable inbox id for an overdue judgment nudge. */
export function judgmentResolveDecisionId(seq: number): string {
  return `judgment-resolve:${String(seq)}`;
}

/**
 * Raise one inbox decision per overdue unresolved judgment, once. Same shape
 * as a watch sweep: existing surface runs this; nothing polls by itself.
 */
export function raiseOverdueJudgmentDecisions(store: Store, at: string): number {
  let raised = 0;
  for (const judgment of unresolvedEstimativeJudgments(store, at)) {
    if (!judgment.overdue) continue;
    const id = judgmentResolveDecisionId(judgment.seq);
    if (getDecision(store, id) !== null) continue;
    raiseDecision(store, {
      id,
      run: judgment.run,
      question:
        `Did estimative claim #${String(judgment.seq)} settle? ` +
        `${judgment.claim} (criterion: ${judgment.resolution}; horizon: ${judgment.horizon})`,
      positions: [
        { role: 'observation', stance: 'happened', citation: null },
        { role: 'observation', stance: 'did not happen', citation: null },
        { role: 'observation', stance: 'unresolvable', citation: null },
      ],
      raisedAt: at,
    });
    raised += 1;
  }
  return raised;
}

export interface BandCalibration {
  readonly band: EstimativeBand;
  readonly scored: number;
  readonly unresolvable: number;
  /** Mean Brier when scored >= CALIBRATION_N_FLOOR; otherwise null. */
  readonly meanBrier: number | null;
}

export interface CalibrationReport {
  readonly nFloor: number;
  readonly nFloorDerivation: string;
  readonly scoredTotal: number;
  readonly unresolvableTotal: number;
  readonly unresolvedTotal: number;
  readonly overdueUnresolved: number;
  readonly overallMeanBrier: number | null;
  readonly byBand: readonly BandCalibration[];
}

/** Brier for one scored resolution: (p/100 − outcome)² with outcome in {0,1}. */
export function judgmentBrier(percent: number, outcome: 'happened' | 'did_not_happen'): number {
  const p = percent / 100;
  const o = outcome === 'happened' ? 1 : 0;
  return (p - o) * (p - o);
}

export function estimativeCalibrationReport(store: Store, at: string): CalibrationReport {
  const unresolved = unresolvedEstimativeJudgments(store, at);
  const joined = store.db
    .prepare(
      `SELECT j.seq, j.percent, r.outcome
       FROM estimative_judgments j
       INNER JOIN estimative_resolutions r ON r.judgment = j.seq
       ORDER BY j.seq`,
    )
    .all() as { seq: number; percent: number; outcome: string }[];

  const bandScores = new Map<string, { band: EstimativeBand; scores: number[]; unresolvable: number }>();
  const overall: number[] = [];
  let unresolvableTotal = 0;

  for (const row of joined) {
    const band = bandFor(row.percent);
    let bucket = bandScores.get(band.word);
    if (!bucket) {
      bucket = { band, scores: [], unresolvable: 0 };
      bandScores.set(band.word, bucket);
    }
    if (row.outcome === 'unresolvable') {
      bucket.unresolvable += 1;
      unresolvableTotal += 1;
      continue;
    }
    if (row.outcome !== 'happened' && row.outcome !== 'did_not_happen') continue;
    const score = judgmentBrier(row.percent, row.outcome);
    bucket.scores.push(score);
    overall.push(score);
  }

  const nFloor = CALIBRATION_N_FLOOR;
  const nFloorDerivation =
    `n ≥ ${String(nFloor)} from RESEARCH-DECISIONS §1 via requiredTrials` +
    `(baseline=0.30, target=0.15, α=0.05, power=0.8) — labels needed to tell those rates apart`;

  const mean = (xs: readonly number[]): number | null =>
    xs.length >= nFloor ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

  const byBand: BandCalibration[] = [...bandScores.values()]
    .sort((a, b) => a.band.low - b.band.low)
    .map((bucket) => ({
      band: bucket.band,
      scored: bucket.scores.length,
      unresolvable: bucket.unresolvable,
      meanBrier: mean(bucket.scores),
    }));

  return {
    nFloor,
    nFloorDerivation,
    scoredTotal: overall.length,
    unresolvableTotal,
    unresolvedTotal: unresolved.length,
    overdueUnresolved: unresolved.filter((j) => j.overdue).length,
    overallMeanBrier: mean(overall),
    byBand,
  };
}

export function renderCalibrationReport(report: CalibrationReport): string {
  const lines: string[] = [
    'estimative calibration',
    `  threshold: ${report.nFloorDerivation}`,
    `  unresolved: ${String(report.unresolvedTotal)}` +
      (report.overdueUnresolved > 0 ? ` (${String(report.overdueUnresolved)} overdue)` : ''),
    `  scored resolutions: ${String(report.scoredTotal)}` +
      (report.unresolvableTotal > 0 ? `; unresolvable: ${String(report.unresolvableTotal)}` : ''),
  ];
  if (report.overallMeanBrier === null) {
    lines.push(
      `  overall Brier: not enough scored resolutions ` +
        `(need ${String(report.nFloor)}, have ${String(report.scoredTotal)})`,
    );
  } else {
    lines.push(`  overall mean Brier: ${report.overallMeanBrier.toFixed(4)} (n=${String(report.scoredTotal)})`);
  }
  for (const band of report.byBand) {
    const rate =
      band.meanBrier === null
        ? `Brier withheld (n=${String(band.scored)} < ${String(report.nFloor)})`
        : `mean Brier ${band.meanBrier.toFixed(4)} (n=${String(band.scored)})`;
    lines.push(
      `  ${band.band.word} (${String(band.band.low)}–${String(band.band.high)}%): ${rate}` +
        (band.unresolvable > 0 ? `; unresolvable ${String(band.unresolvable)}` : ''),
    );
  }
  if (report.byBand.length === 0 && report.scoredTotal === 0) {
    lines.push('  no resolutions recorded yet');
  }
  return `${lines.join('\n')}\n`;
}
