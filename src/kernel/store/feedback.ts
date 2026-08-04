/**
 * kernel/store/feedback.ts — storage for implication verdicts
 * (construct-2jb.13).
 *
 * Every real run is a labeling event: the user sees which domains surfaced,
 * confirms or dismisses them, and is occasionally ambushed by one that never
 * surfaced at all. `ImplicationFeedback` (kernel/implication/harvest.ts) is the
 * pure shape of that verdict; this module is where it survives process death.
 *
 * Append-only for the same reason the work log is: a verdict is a fact about a
 * moment, and a corpus whose labels can be quietly edited after the fact is
 * exactly how the last one died (see harvest.ts's header). The guarantee is
 * enforced by triggers in the schema (kernel/store/open.ts), not by caller
 * discipline — there is deliberately no update or delete function here.
 */

import type { Store } from './open.ts';
import type { DomainVerdict, ImplicationFeedback } from '../implication/harvest.ts';

export interface FeedbackEntry extends ImplicationFeedback {
  readonly seq: number;
  readonly run: string;
}

export interface AppendFeedback {
  readonly run: string;
  readonly outcome: string;
  readonly verdicts: Readonly<Record<string, DomainVerdict>>;
  readonly source: string;
  /** Injected; the kernel never reads the clock. */
  readonly recordedAt: string;
  readonly category?: string;
}

interface Row {
  readonly seq: number;
  readonly run: string;
  readonly outcome: string;
  readonly verdicts: string;
  readonly source: string;
  readonly recorded_at: string;
  readonly category: string | null;
}

function toEntry(row: Row): FeedbackEntry {
  return {
    seq: row.seq,
    run: row.run,
    outcome: row.outcome,
    verdicts: JSON.parse(row.verdicts) as Record<string, DomainVerdict>,
    source: row.source,
    recordedAt: row.recorded_at,
    ...(row.category !== null ? { category: row.category } : {}),
  };
}

/** Append one verdict record. Returns its sequence number. */
export function appendFeedback(store: Store, entry: AppendFeedback): number {
  const result = store.db
    .prepare(
      `INSERT INTO implication_feedback (run, outcome, verdicts, source, recorded_at, category)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.run,
      entry.outcome,
      JSON.stringify(entry.verdicts),
      entry.source,
      entry.recordedAt,
      entry.category ?? null,
    );
  return Number(result.lastInsertRowid);
}

/** Read feedback in append order. Omit `run` to read every recorded verdict. */
export function readFeedback(store: Store, run?: string): FeedbackEntry[] {
  const rows = (
    run
      ? store.db
          .prepare('SELECT * FROM implication_feedback WHERE run = ? ORDER BY seq')
          .all(run)
      : store.db.prepare('SELECT * FROM implication_feedback ORDER BY seq').all()
  ) as unknown as Row[];
  return rows.map(toEntry);
}
