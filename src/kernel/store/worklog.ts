/**
 * kernel/store/worklog.ts — the append-only record of what was done in each
 * role's name: what was reviewed, what was flagged, what needs a licensed human.
 *
 * Serves commitment 4 (invocation is invisible; accountability never is) and
 * commitment 15 (no-fabrication is the trust kernel — a log that can be edited
 * after the fact cannot carry trust).
 *
 * Append-only is enforced by triggers in the schema, not here, so a future
 * caller that reaches past this module still cannot rewrite history. There is
 * deliberately no update or delete function in this file: the absence is the
 * interface.
 *
 * Entry ordering is the `seq` autoincrement, not the timestamp. Timestamps are
 * caller-supplied (the kernel does not read the clock) and a caller with a
 * skewed or repeated clock must not be able to scramble the order of the record.
 */

import type { Store } from './open.ts';

export interface WorkLogEntry {
  readonly seq: number;
  readonly run: string;
  readonly task: string | null;
  readonly role: string;
  readonly action: string;
  readonly detail: unknown;
  readonly at: string;
}

export interface AppendWorkLog {
  readonly run: string;
  readonly task?: string | null;
  readonly role: string;
  readonly action: string;
  readonly detail?: unknown;
  /** Injected; the kernel never reads the clock. */
  readonly at: string;
}

interface Row {
  readonly seq: number;
  readonly run: string;
  readonly task: string | null;
  readonly role: string;
  readonly action: string;
  readonly detail: string;
  readonly at: string;
}

function toEntry(row: Row): WorkLogEntry {
  return {
    seq: row.seq,
    run: row.run,
    task: row.task,
    role: row.role,
    action: row.action,
    detail: JSON.parse(row.detail),
    at: row.at,
  };
}

/** Append one entry. Returns its sequence number. */
export function appendWorkLog(store: Store, entry: AppendWorkLog): number {
  const result = store.db
    .prepare(
      `INSERT INTO work_log (run, task, role, action, detail, at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.run,
      entry.task ?? null,
      entry.role,
      entry.action,
      JSON.stringify(entry.detail ?? null),
      entry.at,
    );
  return Number(result.lastInsertRowid);
}

/** How many entries a task has filed under one action. Cheap: index-covered. */
export function countWorkLogEntries(
  store: Store,
  run: string,
  task: string,
  action: string,
): number {
  const row = store.db
    .prepare('SELECT COUNT(*) AS n FROM work_log WHERE run = ? AND task = ? AND action = ?')
    .get(run, task, action) as { n: number };
  return row.n;
}

/** Read a run's log in append order. Omit `run` to read the whole log. */
export function readWorkLog(store: Store, run?: string): WorkLogEntry[] {
  const rows = (
    run
      ? store.db.prepare('SELECT * FROM work_log WHERE run = ? ORDER BY seq').all(run)
      : store.db.prepare('SELECT * FROM work_log ORDER BY seq').all()
  ) as unknown as Row[];
  return rows.map(toEntry);
}
