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
import { transact } from './open.ts';

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
  /**
   * Whose hand the resolution came through — `cli:user` for a person at the
   * command line, `mcp:<client>` for a model through an MCP tool. Null while a
   * decision is still open. A resolution that cannot say whose it was is a
   * resolution nothing downstream should trust as a person's.
   */
  readonly resolvedBy: string | null;
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
  readonly resolved_by: string | null;
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
    resolvedBy: row.resolved_by,
  };
}

/**
 * The provenance join, spelled once. Every read of a decision carries whose
 * hand resolved it, drawn from the companion table so an existing store that
 * predates provenance simply reports null rather than failing to load.
 */
const DECISION_SELECT = `
  SELECT d.*, p.resolved_by AS resolved_by
  FROM decisions d
  LEFT JOIN decision_provenance p ON p.decision = d.id`;

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

/**
 * Record the user's choice. Never chooses; the resolution arrives from outside.
 *
 * `resolvedBy` names whose hand it arrived through — `cli:user` for a person at
 * the command line, `mcp:<client>` for a model through an MCP tool — and it is
 * required, not defaulted, because a resolution whose provenance is guessed is
 * exactly the forgery this records against. The provenance is written in the
 * same transaction as the resolution, so the two can never disagree.
 */
export function resolveDecision(
  store: Store,
  id: string,
  resolution: string,
  resolvedAt: string,
  resolvedBy: string,
): void {
  if (resolvedBy.trim() === '') {
    throw new Error(`resolveDecision: ${id} needs a non-empty resolver provenance`);
  }
  transact(store, () => {
    const result = store.db
      .prepare(
        `UPDATE decisions SET state = 'resolved', resolution = ?, resolved_at = ?
         WHERE id = ? AND state = 'open'`,
      )
      .run(resolution, resolvedAt, id);
    if (result.changes === 0) {
      throw new Error(`resolveDecision: no open decision ${id}`);
    }
    store.db
      .prepare(
        `INSERT OR REPLACE INTO decision_provenance (decision, resolved_by, recorded_at)
         VALUES (?, ?, ?)`,
      )
      .run(id, resolvedBy, resolvedAt);
  });
}

/** The inbox: open decisions, oldest first. */
export function openDecisions(store: Store, run?: string): Decision[] {
  const rows = (
    run
      ? store.db
          .prepare(`${DECISION_SELECT} WHERE d.state = 'open' AND d.run = ? ORDER BY d.raised_at, d.id`)
          .all(run)
      : store.db
          .prepare(`${DECISION_SELECT} WHERE d.state = 'open' ORDER BY d.raised_at, d.id`)
          .all()
  ) as unknown as Row[];
  return rows.map(toDecision);
}

/** Resolved decisions for a run, oldest resolution first: the answers on record. */
export function resolvedDecisions(store: Store, run: string): Decision[] {
  const rows = store.db
    .prepare(`${DECISION_SELECT} WHERE d.state = 'resolved' AND d.run = ? ORDER BY d.resolved_at, d.id`)
    .all(run) as unknown as Row[];
  return rows.map(toDecision);
}

export function getDecision(store: Store, id: string): Decision | null {
  const row = store.db.prepare(`${DECISION_SELECT} WHERE d.id = ?`).get(id) as Row | undefined;
  return row ? toDecision(row) : null;
}
