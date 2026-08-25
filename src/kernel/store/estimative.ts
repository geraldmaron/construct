/**
 * kernel/store/estimative.ts — the calibration log: every likelihood a run
 * stated, and the observation that will one day settle it.
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
 * Only likelihood-bearing judgments land here. A judgment on the rung below
 * has no band to score and no resolution criterion to score it against; it is
 * deliverable content and belongs in the deliverable. The confidence column
 * therefore admits only the two levels the ladder permits a likelihood at, so
 * a row that would break the ladder cannot be written even by a caller that
 * bypassed the constructors.
 *
 * What this does NOT yet hold is resolutions. Until they accumulate, the
 * honest statement to a user is that judgments are logged and no calibration
 * figure exists — which is checkable, and different from having nothing.
 */

import type { Store } from './open.ts';
import type { AssessedRisk } from '../run/estimative.ts';

export interface LoggedJudgment {
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

/**
 * Log one stated likelihood. `at` is supplied; the kernel never reads the
 * clock.
 *
 * A judgment whose confidence is low cannot reach here, because the type it
 * would arrive as carries no percentage. That is the ladder holding at the
 * storage seam as well as at the constructor.
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

/** Everything judged on one run, oldest first — or on every run when none is named. */
export function estimativeJudgmentsFor(store: Store, run?: string): LoggedJudgment[] {
  const rows = (
    run
      ? store.db
          .prepare(
            `SELECT run, decision, claim, percent, confidence, resolution, horizon,
                    reference_class, recorded_at
             FROM estimative_judgments WHERE run = ? ORDER BY seq`,
          )
          .all(run)
      : store.db
          .prepare(
            `SELECT run, decision, claim, percent, confidence, resolution, horizon,
                    reference_class, recorded_at
             FROM estimative_judgments ORDER BY seq`,
          )
          .all()
  ) as {
    run: string;
    decision: string | null;
    claim: string;
    percent: number;
    confidence: string;
    resolution: string;
    horizon: string;
    reference_class: string | null;
    recorded_at: string;
  }[];
  return rows.map((row) => ({
    run: row.run,
    decision: row.decision,
    claim: row.claim,
    percent: row.percent,
    confidence: row.confidence as 'high' | 'moderate',
    resolution: row.resolution,
    horizon: row.horizon,
    referenceClass: row.reference_class,
    recordedAt: row.recorded_at,
  }));
}
