/**
 * kernel/store/standing.ts — standing outcomes: a recurring intention the
 * spine re-files on its own cadence.
 *
 * A scheduled Construct used to be external cron around `construct outcome &&
 * construct work` — workable because every spine command is idempotent, but
 * the intention itself lived in a crontab where no record could see it. A
 * standing outcome puts the intention in the store: what should keep
 * happening, how often, for which workspace, optionally with the staff named
 * outright. Each firing files a fresh, ordinary run, so every execution keeps
 * full run lineage — the work log, the plan, the inbox all behave as if a
 * person had typed the outcome that morning.
 *
 * What this module deliberately is NOT: a scheduler. The predecessor's daemon
 * leak is the recorded lesson, and nothing here waits, polls, or wakes.
 * Firing stays external — cron or launchd invokes a CLI verb — and the store
 * only knows what is due: a standing outcome whose cadence has elapsed since
 * its last recorded firing, or that has never fired at all. The kernel never
 * reads the clock; `at` is always the caller's.
 *
 * Declarations are settings and may retire; firings are lineage and may not —
 * `standing_runs` is append-only under database triggers, because the claim
 * "this run exists because that intention was standing" is exactly the kind
 * of provenance a later cleanup would otherwise quietly destroy.
 */

import type { Store } from './open.ts';

export interface StandingOutcome {
  readonly id: string;
  readonly workspace: string;
  readonly outcome: string;
  /** Domains named outright at declaration, or null to infer per firing. */
  readonly domains: readonly string[] | null;
  readonly everyMinutes: number;
  readonly declaredAt: string;
  readonly retiredAt: string | null;
}

export interface StandingFiring {
  readonly standing: string;
  readonly run: string;
  readonly firedAt: string;
}

interface Row {
  readonly id: string;
  readonly workspace: string;
  readonly outcome: string;
  readonly domains: string | null;
  readonly every_minutes: number;
  readonly declared_at: string;
  readonly retired_at: string | null;
}

function toStanding(row: Row): StandingOutcome {
  return {
    id: row.id,
    workspace: row.workspace,
    outcome: row.outcome,
    domains: row.domains === null ? null : (JSON.parse(row.domains) as string[]),
    everyMinutes: Number(row.every_minutes),
    declaredAt: row.declared_at,
    retiredAt: row.retired_at,
  };
}

export function declareStanding(store: Store, standing: Omit<StandingOutcome, 'retiredAt'>): void {
  if (standing.outcome.trim() === '') {
    throw new Error(`declareStanding: ${standing.id} states no outcome`);
  }
  if (standing.workspace.trim() === '') {
    throw new Error(`declareStanding: ${standing.id} names no workspace`);
  }
  if (!Number.isInteger(standing.everyMinutes) || standing.everyMinutes < 1) {
    throw new Error(
      `declareStanding: cadence must be a positive whole number of minutes, got ${String(standing.everyMinutes)}`,
    );
  }
  if (standing.domains !== null && standing.domains.length === 0) {
    throw new Error(`declareStanding: ${standing.id} names an empty staff — omit domains to infer instead`);
  }
  store.db
    .prepare(
      `INSERT INTO standing_outcomes (id, workspace, outcome, domains, every_minutes, declared_at, retired_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      standing.id,
      standing.workspace,
      standing.outcome,
      standing.domains === null ? null : JSON.stringify(standing.domains),
      standing.everyMinutes,
      standing.declaredAt,
    );
}

export function getStanding(store: Store, id: string): StandingOutcome | null {
  const row = store.db.prepare('SELECT * FROM standing_outcomes WHERE id = ?').get(id) as
    | Row
    | undefined;
  return row ? toStanding(row) : null;
}

/** Every standing outcome, active only unless asked otherwise, oldest first. */
export function listStanding(store: Store, opts?: { includeRetired?: boolean }): StandingOutcome[] {
  const rows = (
    opts?.includeRetired
      ? store.db.prepare('SELECT * FROM standing_outcomes ORDER BY declared_at, id').all()
      : store.db
          .prepare('SELECT * FROM standing_outcomes WHERE retired_at IS NULL ORDER BY declared_at, id')
          .all()
  ) as unknown as Row[];
  return rows.map(toStanding);
}

/**
 * Retire a standing outcome: it stops coming due but stays inspectable,
 * because its firings point at it. Retiring twice is an error, not a no-op —
 * the second caller believed something false about what was still running.
 */
export function retireStanding(store: Store, id: string, retiredAt: string): void {
  const existing = getStanding(store, id);
  if (!existing) throw new Error(`retireStanding: no standing outcome ${id}`);
  if (existing.retiredAt) {
    throw new Error(`retireStanding: ${id} was already retired at ${existing.retiredAt}`);
  }
  store.db.prepare('UPDATE standing_outcomes SET retired_at = ? WHERE id = ?').run(retiredAt, id);
}

/** Record that a firing filed this run. Lineage, so append-only by trigger. */
export function recordFiring(store: Store, firing: StandingFiring): void {
  if (!getStanding(store, firing.standing)) {
    throw new Error(`recordFiring: no standing outcome ${firing.standing}`);
  }
  store.db
    .prepare('INSERT INTO standing_runs (standing, run, fired_at) VALUES (?, ?, ?)')
    .run(firing.standing, firing.run, firing.firedAt);
}

/** Every firing of one standing outcome, oldest first. */
export function firingsFor(store: Store, standing: string): StandingFiring[] {
  const rows = store.db
    .prepare('SELECT standing, run, fired_at FROM standing_runs WHERE standing = ? ORDER BY seq')
    .all(standing) as unknown as Array<{ standing: string; run: string; fired_at: string }>;
  return rows.map((r) => ({ standing: r.standing, run: r.run, firedAt: r.fired_at }));
}

export function lastFiredAt(store: Store, standing: string): string | null {
  const row = store.db
    .prepare('SELECT fired_at FROM standing_runs WHERE standing = ? ORDER BY seq DESC LIMIT 1')
    .get(standing) as { fired_at: string } | undefined;
  return row?.fired_at ?? null;
}

/**
 * The standing outcomes whose cadence has elapsed at `at`: never fired, or
 * last fired at least the cadence ago. A retired one is never due, whatever
 * its history says.
 */
export function dueStanding(store: Store, at: string): StandingOutcome[] {
  const cutoff = Date.parse(at);
  if (Number.isNaN(cutoff)) throw new Error(`dueStanding: unreadable timestamp "${at}"`);
  return listStanding(store).filter((standing) => {
    const last = lastFiredAt(store, standing.id);
    if (last === null) return true;
    return Date.parse(last) + standing.everyMinutes * 60_000 <= cutoff;
  });
}
