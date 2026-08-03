/**
 * kernel/store/decisions.ts — storage for the decision inbox.
 *
 * Serves commitment 2 (work happens in the background; only calls that are
 * genuinely the user's surface) and commitment 11 (cross-domain conflicts
 * surface as user decisions, framed with both sides cited — no hidden precedence
 * order and no heat-map auto-arbitration on judgment calls).
 *
 * Commitment 11 is why a decision carries two or more cited `positions` rather
 * than a recommendation plus a rationale: the shape of the record is what stops
 * the system from quietly picking a winner. `resolveDecision` records a choice
 * but never makes one — resolution always arrives from outside this module.
 */

import type { Store } from './open.ts';

export const DECISION_STATES = ['open', 'resolved'] as const;

export type DecisionState = (typeof DECISION_STATES)[number];

/** One side of a conflict, with the citation that supports it. */
export interface Position {
  readonly role: string;
  readonly stance: string;
  readonly citation: string | null;
}

export interface Decision {
  readonly id: string;
  readonly run: string;
  readonly state: DecisionState;
  readonly question: string;
  readonly positions: readonly Position[];
  readonly raisedAt: string;
  readonly resolvedAt: string | null;
  readonly resolution: string | null;
}

export interface RaiseDecision {
  readonly id: string;
  readonly run: string;
  readonly question: string;
  readonly positions: readonly Position[];
  /** Injected; the kernel never reads the clock. */
  readonly raisedAt: string;
}

interface Row {
  readonly id: string;
  readonly run: string;
  readonly state: string;
  readonly question: string;
  readonly positions: string;
  readonly raised_at: string;
  readonly resolved_at: string | null;
  readonly resolution: string | null;
}

function toDecision(row: Row): Decision {
  return {
    id: row.id,
    run: row.run,
    state: row.state as DecisionState,
    question: row.question,
    positions: JSON.parse(row.positions) as Position[],
    raisedAt: row.raised_at,
    resolvedAt: row.resolved_at,
    resolution: row.resolution,
  };
}

/**
 * Put a decision in the inbox. Requires at least two positions: a "decision"
 * with one side is not a cross-domain conflict, it is a report, and letting one
 * through would be exactly the hidden-precedence behavior commitment 11 forbids.
 */
export function raiseDecision(store: Store, decision: RaiseDecision): void {
  if (decision.positions.length < 2) {
    throw new Error(
      `raiseDecision: ${decision.id} needs at least two cited positions, got ${decision.positions.length}`,
    );
  }
  store.db
    .prepare(
      `INSERT INTO decisions (id, run, state, question, positions, raised_at, resolved_at, resolution)
       VALUES (?, ?, 'open', ?, ?, ?, NULL, NULL)`,
    )
    .run(
      decision.id,
      decision.run,
      decision.question,
      JSON.stringify(decision.positions),
      decision.raisedAt,
    );
}

/** Record the user's choice. Never chooses; the resolution arrives from outside. */
export function resolveDecision(
  store: Store,
  id: string,
  resolution: string,
  resolvedAt: string,
): void {
  const result = store.db
    .prepare(
      `UPDATE decisions SET state = 'resolved', resolution = ?, resolved_at = ?
       WHERE id = ? AND state = 'open'`,
    )
    .run(resolution, resolvedAt, id);
  if (result.changes === 0) {
    throw new Error(`resolveDecision: no open decision ${id}`);
  }
}

/** The inbox: open decisions, oldest first. */
export function openDecisions(store: Store, run?: string): Decision[] {
  const rows = (
    run
      ? store.db
          .prepare("SELECT * FROM decisions WHERE state = 'open' AND run = ? ORDER BY raised_at, id")
          .all(run)
      : store.db
          .prepare("SELECT * FROM decisions WHERE state = 'open' ORDER BY raised_at, id")
          .all()
  ) as unknown as Row[];
  return rows.map(toDecision);
}

export function getDecision(store: Store, id: string): Decision | null {
  const row = store.db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as Row | undefined;
  return row ? toDecision(row) : null;
}
