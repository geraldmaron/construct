/**
 * kernel/tracker/reconcileDecisions.ts — frame projection drift as decisions.
 *
 * kernel/tracker/reconcile.ts already decides what has drifted between a
 * recorded projection and a live tracker read; this module does not
 * re-derive that judgement, it reads the result and frames each disagreement
 * in the shape the decision inbox requires (kernel/store/decisions.ts): two
 * or more cited positions, never a single recommendation. The two sides are
 * exactly the two the field-authority rule already names — `domain` (what
 * Construct's own projection recorded) and the tracker itself (what the
 * supplied live read showed) — so the framing adds no third opinion about
 * who is right.
 *
 * One decision per drifted projection, not per field: a projection that
 * disagrees on both title and description is one call for a person to make,
 * not two. The decision id is derived from the projection and the sorted set
 * of fields that disagree, never from the values in conflict, which is what
 * makes a re-run idempotent — the same disagreement produces the same id, so
 * raising it twice is a lookup the caller makes before calling raiseDecision,
 * and a genuinely different disagreement (a field that started or stopped
 * conflicting) is free to be reported as the new information it is.
 *
 * A projection whose external id has no match in the supplied live read is
 * drift too, framed separately from a field conflict because there is
 * nothing to disagree about — only an issue this verb cannot find. Whether
 * that means deleted, renamed, or an incomplete read is exactly the kind of
 * call commitment 11 reserves for a person instead of guessing.
 *
 * Pure: no IO, no store access, no clock. Every value it needs — the drift
 * report and the projections it was computed from — is handed in by a
 * caller that already did the reading.
 */

import type { Position } from '../store/decisions.ts';
import type { Projection } from './projection.ts';
import type { DriftReport, ReconcileResult } from './reconcile.ts';

export interface DriftDecision {
  readonly id: string;
  readonly question: string;
  readonly positions: readonly Position[];
}

function describeValue(value: unknown): string {
  if (value === undefined) return '(absent)';
  if (typeof value === 'string') return value.trim() === '' ? '(empty string)' : value;
  return JSON.stringify(value);
}

/** One decision for a projection that disagrees with the live read on one or more domain-owned fields. */
function fromConflict(projection: Projection, result: ReconcileResult): DriftDecision | null {
  if (result.conflicts.length === 0) return null;
  const fields = [...result.conflicts].map((c) => c.field).sort();
  const positions: Position[] = result.conflicts.flatMap((c) => [
    {
      role: 'domain',
      stance: `${c.field}: recorded as ${describeValue(c.domain)}`,
      citation: `projection:${projection.id}`,
    },
    {
      role: projection.tracker,
      stance: `${c.field}: the live read shows ${describeValue(c.tracker)}`,
      citation: `${projection.tracker}:${projection.external_id}`,
    },
  ]);
  return {
    id: `reconcile:${projection.id}:${fields.join('+')}`,
    question:
      `${projection.id} disagrees with the live ${projection.tracker} read on ` +
      `${fields.join(', ')} — which side is right?`,
    positions,
  };
}

/** One decision for a projection whose issue could not be found in the supplied live read at all. */
function fromMissing(projection: Projection): DriftDecision {
  return {
    id: `reconcile:${projection.id}:missing`,
    question:
      `${projection.id} is a recorded projection with no matching issue in the live ` +
      `${projection.tracker} read — deleted, renamed, or is the read incomplete?`,
    positions: [
      {
        role: 'domain',
        stance: 'Construct recorded this projection and has not been told it is gone.',
        citation: `projection:${projection.id}`,
      },
      {
        role: projection.tracker,
        stance: `no issue ${projection.external_id} appears in the supplied live read`,
        citation: `${projection.tracker}: live read`,
      },
    ],
  };
}

/**
 * Every projection this report found drifted or missing, framed as decisions
 * ready for `raiseDecision`. Callers are expected to have reconciled a single
 * tracker's projections against that same tracker's live read — `external_id`
 * is unique only within one tracker, and a report spanning several would let
 * one tracker's issue silently stand in for another's.
 *
 * Order follows the report (drifted, then missing) but callers should not
 * depend on it; the decision id, not position in this array, is what makes
 * raising it a no-op the second time.
 */
export function driftDecisions(
  report: DriftReport,
  projections: readonly Projection[],
): readonly DriftDecision[] {
  const byExternalId = new Map(projections.map((p) => [p.external_id, p] as const));
  const decisions: DriftDecision[] = [];
  for (const result of report.drifted) {
    const projection = byExternalId.get(result.external_id);
    if (!projection) continue;
    const decision = fromConflict(projection, result);
    if (decision) decisions.push(decision);
  }
  for (const entry of report.missing) {
    const projection = byExternalId.get(entry.external_id);
    if (projection) decisions.push(fromMissing(projection));
  }
  return decisions;
}
