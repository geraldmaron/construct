/**
 * kernel/store/dispatch.ts — the dispatch surface a run was filed with.
 *
 * Found on a live wire capture: an outcome filed with a named host and model
 * recorded neither, so `work` without re-stated flags dispatched roles to
 * whatever model the host happened to have used last — an image model, as it
 * turned out, and the failure surfaced as a misleading provider error three
 * layers away. The user named a model at the moment of intent; that choice is
 * a fact of the run and is recorded here, write-once like the naming cache and
 * for the same reason.
 *
 * Reading it back is the default, not a cage: `work` may still be told
 * otherwise explicitly, and the divergence goes on the work log rather than
 * passing silently.
 */

import type { Store } from './open.ts';

export interface RunDispatch {
  readonly run: string;
  readonly host: string;
  readonly model: string | null;
  readonly binary: string | null;
  readonly dir: string | null;
  readonly recordedAt: string;
}

export interface RecordRunDispatch {
  readonly run: string;
  readonly host: string;
  readonly model?: string;
  readonly binary?: string;
  readonly dir?: string;
  /** Injected; the kernel never reads the clock. */
  readonly recordedAt: string;
}

export function recordRunDispatch(store: Store, dispatch: RecordRunDispatch): void {
  store.db
    .prepare(
      `INSERT INTO run_dispatch (run, host, model, binary, dir, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      dispatch.run,
      dispatch.host,
      dispatch.model ?? null,
      dispatch.binary ?? null,
      dispatch.dir ?? null,
      dispatch.recordedAt,
    );
}

export function readRunDispatch(store: Store, run: string): RunDispatch | null {
  const row = store.db.prepare('SELECT * FROM run_dispatch WHERE run = ?').get(run) as
    | {
        run: string;
        host: string;
        model: string | null;
        binary: string | null;
        dir: string | null;
        recorded_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    run: row.run,
    host: row.host,
    model: row.model,
    binary: row.binary,
    dir: row.dir,
    recordedAt: row.recorded_at,
  };
}
