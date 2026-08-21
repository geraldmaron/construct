/**
 * kernel/store/source-watches.ts — a watch pointed at a declared source.
 *
 * A standing outcome re-files an intention through the work pipeline on its
 * cadence; a source watch does not spend anything by default. It names a
 * source (kernel/store/sources.ts) instead of an outcome, and what a firing
 * records is not a filed run — it is the structural snapshot a sweep actually
 * saw. The comparison a later sweep needs is exactly that snapshot, not a
 * summary of it, so this module hands back whatever the previous firing
 * persisted and never opens a file to produce one itself.
 *
 * What this module deliberately is NOT: a scheduler, and not a place that
 * reads a filesystem or interprets a snapshot's contents. Firing stays
 * external, exactly as every other standing thing in this store does; the
 * snapshot a firing carries arrives fully formed from the caller, opaque to
 * this module the same way `work_log.detail` is opaque to worklog.ts.
 *
 * Declarations are settings and may retire; firings are lineage and may not —
 * `source_watch_firings` is append-only under database triggers, for the same
 * reason `standing_runs` is: a snapshot that could be overwritten would let a
 * later cleanup quietly redefine what "changed since last time" means.
 */

import { getSource } from './sources.ts';
import type { Store } from './open.ts';

export interface SourceWatch {
  readonly id: string;
  readonly workspace: string;
  /** The declared source this watch surveys on its own cadence. */
  readonly source: string;
  /** A host named outright at declaration, or null for structural comparison only. */
  readonly host: string | null;
  readonly everyMinutes: number;
  readonly declaredAt: string;
  readonly retiredAt: string | null;
}

export interface SourceWatchFiring {
  readonly watch: string;
  readonly run: string;
  readonly firedAt: string;
  /** Whatever the sweep recorded as having seen — opaque to this module. */
  readonly snapshot: unknown;
}

interface Row {
  readonly id: string;
  readonly workspace: string;
  readonly source: string;
  readonly host: string | null;
  readonly every_minutes: number;
  readonly declared_at: string;
  readonly retired_at: string | null;
}

function toWatch(row: Row): SourceWatch {
  return {
    id: row.id,
    workspace: row.workspace,
    source: row.source,
    host: row.host,
    everyMinutes: Number(row.every_minutes),
    declaredAt: row.declared_at,
    retiredAt: row.retired_at,
  };
}

/**
 * Declare a watch over an already-declared source. Refused for the same
 * reasons a typo in `standing add --domains` is refused at the door: a
 * source that does not exist, or that was retired, would leave the watch
 * firing forever against ground nobody can survey.
 */
export function declareSourceWatch(store: Store, watch: Omit<SourceWatch, 'retiredAt'>): void {
  if (watch.workspace.trim() === '') {
    throw new Error(`declareSourceWatch: ${watch.id} names no workspace`);
  }
  const source = getSource(store, watch.source);
  if (!source) {
    throw new Error(`declareSourceWatch: no source ${watch.source} — declare it first with source add`);
  }
  if (source.retiredAt) {
    throw new Error(`declareSourceWatch: source ${watch.source} was retired at ${source.retiredAt}`);
  }
  if (!Number.isInteger(watch.everyMinutes) || watch.everyMinutes < 1) {
    throw new Error(
      `declareSourceWatch: cadence must be a positive whole number of minutes, got ${String(watch.everyMinutes)}`,
    );
  }
  store.db
    .prepare(
      `INSERT INTO source_watches (id, workspace, source, host, every_minutes, declared_at, retired_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(watch.id, watch.workspace, watch.source, watch.host, watch.everyMinutes, watch.declaredAt);
}

export function getSourceWatch(store: Store, id: string): SourceWatch | null {
  const row = store.db.prepare('SELECT * FROM source_watches WHERE id = ?').get(id) as Row | undefined;
  return row ? toWatch(row) : null;
}

/** Every declared source watch, active only unless asked otherwise, oldest first. */
export function listSourceWatches(store: Store, opts?: { includeRetired?: boolean }): SourceWatch[] {
  const rows = (
    opts?.includeRetired
      ? store.db.prepare('SELECT * FROM source_watches ORDER BY declared_at, id').all()
      : store.db
          .prepare('SELECT * FROM source_watches WHERE retired_at IS NULL ORDER BY declared_at, id')
          .all()
  ) as unknown as Row[];
  return rows.map(toWatch);
}

/**
 * Retire a source watch: it stops coming due but stays inspectable, because
 * its firings point at it. Retiring twice is an error, not a no-op — the
 * second caller believed something false about what was still running.
 */
export function retireSourceWatch(store: Store, id: string, retiredAt: string): void {
  const existing = getSourceWatch(store, id);
  if (!existing) throw new Error(`retireSourceWatch: no source watch ${id}`);
  if (existing.retiredAt) {
    throw new Error(`retireSourceWatch: ${id} was already retired at ${existing.retiredAt}`);
  }
  store.db.prepare('UPDATE source_watches SET retired_at = ? WHERE id = ?').run(retiredAt, id);
}

/** Record what a sweep saw. Lineage, so append-only by trigger. */
export function recordSourceWatchFiring(store: Store, firing: SourceWatchFiring): void {
  if (!getSourceWatch(store, firing.watch)) {
    throw new Error(`recordSourceWatchFiring: no source watch ${firing.watch}`);
  }
  store.db
    .prepare('INSERT INTO source_watch_firings (watch, run, fired_at, snapshot) VALUES (?, ?, ?, ?)')
    .run(firing.watch, firing.run, firing.firedAt, JSON.stringify(firing.snapshot));
}

function toFiring(row: { watch: string; run: string; fired_at: string; snapshot: string }): SourceWatchFiring {
  return {
    watch: row.watch,
    run: row.run,
    firedAt: row.fired_at,
    snapshot: JSON.parse(row.snapshot) as unknown,
  };
}

/** Every firing of one source watch, oldest first. */
export function firingsForSourceWatch(store: Store, watch: string): SourceWatchFiring[] {
  const rows = store.db
    .prepare(
      'SELECT watch, run, fired_at, snapshot FROM source_watch_firings WHERE watch = ? ORDER BY seq',
    )
    .all(watch) as unknown as Array<{ watch: string; run: string; fired_at: string; snapshot: string }>;
  return rows.map(toFiring);
}

/** The most recent firing recorded for a watch, or null if it has never fired. */
export function latestSourceWatchFiring(store: Store, watch: string): SourceWatchFiring | null {
  const row = store.db
    .prepare(
      `SELECT watch, run, fired_at, snapshot FROM source_watch_firings
       WHERE watch = ? ORDER BY seq DESC LIMIT 1`,
    )
    .get(watch) as { watch: string; run: string; fired_at: string; snapshot: string } | undefined;
  return row ? toFiring(row) : null;
}

/**
 * The source watches whose cadence has elapsed at `at`: never fired, or last
 * fired at least the cadence ago. A retired one is never due, whatever its
 * history says.
 */
export function dueSourceWatches(store: Store, at: string): SourceWatch[] {
  const cutoff = Date.parse(at);
  if (Number.isNaN(cutoff)) throw new Error(`dueSourceWatches: unreadable timestamp "${at}"`);
  return listSourceWatches(store).filter((watch) => {
    const last = latestSourceWatchFiring(store, watch.id);
    if (last === null) return true;
    return Date.parse(last.firedAt) + watch.everyMinutes * 60_000 <= cutoff;
  });
}
