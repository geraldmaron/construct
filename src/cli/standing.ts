/**
 * cli/standing.ts — a recurring intention the spine re-files on its own
 * cadence.
 *
 * Declaring stores the intention and runs nothing; `--due` files and works
 * what has elapsed. There is deliberately no daemon and no waiting here: cron
 * or launchd owns the clock, and the store only knows what is due.
 */

import { planFor } from '../kernel/store/plans.ts';
import { countTasksByState } from '../kernel/store/tasks.ts';
import {
  declareStanding,
  dueStanding,
  firingsFor,
  lastFiredAt,
  listStanding,
  recordFiring,
  retireStanding,
} from '../kernel/store/standing.ts';
import { DOMAINS } from '../kernel/implication/domains.ts';
import { startRun, startRunSelected } from '../kernel/run/outcome.ts';
import type { HostAdapter } from '../kernel/hosts/interface.ts';
import { now, withStore } from './runtime.ts';
import { splitFlags, workspaceFlag } from './flags.ts';
import { parseCadence, renderCadence } from './cadence.ts';
import { planRun, reportRun } from './outcome.ts';
import { work } from './work.ts';

const STANDING_USAGE =
  'usage: construct standing add --every=<N>m|<N>h|<N>d [--workspace=<name>] [--domains=<name,…>] "<what should keep happening>"\n' +
  '       construct standing [list] [--all]\n' +
  '       construct standing retire <id>\n' +
  '       construct standing --due [--host=… --model=… --binary=… --dir=… --ceiling=… ' +
  '--concurrency=… --lease-minutes=… --timeout=…]\n' +
  '         (schedule `construct standing --due` with cron or launchd; nothing here waits or wakes)\n';


/**
 * Fire what has come due: file a fresh, ordinary run per elapsed standing
 * outcome, then work exactly those runs through the normal work path. The
 * spend ceiling, leases, and the decision inbox behave exactly as they do for
 * a typed outcome, because these ARE typed outcomes — the store merely
 * remembered the typing.
 */
async function standingDue(argv: string[], hostOverride?: HostAdapter): Promise<number> {
  const { filed, unfinished } = withStore((store) => {
    const due = dueStanding(store, now());
    const runs: Array<{ standing: string; run: string }> = [];
    for (const item of due) {
      const firedAt = now();
      const base = `run-${firedAt.replace(/[-:.TZ]/g, '')}`;
      // Two firings inside one clock tick must not share a run id.
      let runId = base;
      for (let n = 2; planFor(store, runId) !== null; n += 1) runId = `${base}-${String(n)}`;
      process.stdout.write(`standing ${item.id} came due (every ${renderCadence(item.everyMinutes)}):\n`);
      const started =
        item.domains !== null
          ? startRunSelected(store, { runId, outcome: item.outcome, at: firedAt, domains: item.domains })
          : startRun(store, { runId, outcome: item.outcome, at: firedAt });
      reportRun(started);
      planRun(store, started, null, item.workspace, firedAt);
      // Recorded after the run exists: a crash between the two re-files on the
      // next firing, which idempotent runs absorb; the other order could mark
      // fired an intention that never ran.
      recordFiring(store, { standing: item.id, run: runId, firedAt });
      runs.push({ standing: item.id, run: runId });
    }

    // A firing recorded is not a firing finished. A --due killed mid-flight
    // leaves pending or leased tasks on a run whose cadence now reads as
    // spent, so every earlier standing-filed run still carrying unsettled
    // tasks is picked up here, cadence or no cadence — the recipe's
    // resumability holds on this surface, not only on a bare `work`. Retired
    // standings included: their runs were filed and stand on the record.
    const filedIds = new Set(runs.map((r) => r.run));
    const unsettled: Array<{ standing: string; run: string }> = [];
    for (const item of listStanding(store, { includeRetired: true })) {
      for (const firing of firingsFor(store, item.id)) {
        if (filedIds.has(firing.run)) continue;
        if (unsettled.some((u) => u.run === firing.run)) continue;
        const counts = countTasksByState(store, firing.run);
        if ((counts.pending ?? 0) > 0 || (counts.leased ?? 0) > 0) {
          unsettled.push({ standing: item.id, run: firing.run });
        }
      }
    }
    return { filed: runs, unfinished: unsettled };
  });

  if (filed.length === 0 && unfinished.length === 0) {
    process.stdout.write('nothing is due.\n');
    return 0;
  }

  const passthrough = argv.filter((arg) => arg !== '--due');
  let worst = 0;
  for (const firing of unfinished) {
    process.stdout.write(
      `\nresuming ${firing.run} (standing ${firing.standing} — unfinished from an earlier firing):\n`,
    );
    const code = await work([`--run=${firing.run}`, ...passthrough], hostOverride);
    if (code > worst) worst = code;
  }
  for (const firing of filed) {
    process.stdout.write(`\nworking ${firing.run} (standing ${firing.standing}):\n`);
    const code = await work([`--run=${firing.run}`, ...passthrough], hostOverride);
    if (code > worst) worst = code;
  }
  return worst;
}

/**
 * Standing outcomes: a recurring intention the spine re-files on its own
 * cadence. Declaring stores the intention and runs nothing; `--due` files and
 * works what has elapsed. There is deliberately no daemon and no waiting
 * here — cron or launchd owns the clock, exactly as docs/scheduled-operation.md
 * always had it, and the store only knows what is due.
 */
export async function standing(argv: string[], hostOverride?: HostAdapter): Promise<number> {
  const { flags, words } = splitFlags(argv);

  if (flags.due !== undefined) return standingDue(argv, hostOverride);

  const sub = words[0];

  if (sub === 'add') {
    const text = words.slice(1).join(' ').trim();
    if (!text || flags.every === undefined) {
      process.stderr.write(STANDING_USAGE);
      return 2;
    }
    let everyMinutes: number;
    try {
      everyMinutes = parseCadence(flags.every);
    } catch (error) {
      process.stderr.write(`standing: ${(error as Error).message}\n`);
      return 2;
    }
    const domains =
      flags.domains === undefined
        ? null
        : flags.domains
            .split(',')
            .map((name) => name.trim())
            .filter((name) => name.length > 0);
    // A staff typo caught here costs one retype; caught at 3 a.m. by cron it
    // costs every firing until somebody reads the log.
    const unknown = (domains ?? []).filter((name) => !DOMAINS.some((d) => d.domain === name));
    if (unknown.length > 0) {
      process.stderr.write(
        `standing: no catalog domain named ${unknown.map((u) => JSON.stringify(u)).join(', ')}\n`,
      );
      return 2;
    }
    return withStore((store) => {
      const at = now();
      const id = `standing-${at.replace(/[-:.TZ]/g, '')}`;
      try {
        declareStanding(store, {
          id,
          workspace: workspaceFlag(flags),
          outcome: text,
          domains,
          everyMinutes,
          declaredAt: at,
        });
      } catch (error) {
        process.stderr.write(`standing: ${(error as Error).message}\n`);
        return 1;
      }
      process.stdout.write(
        `declared ${id}: every ${renderCadence(everyMinutes)} (workspace ${workspaceFlag(flags)})\n` +
          `  outcome: ${text}\n` +
          '  nothing runs until `construct standing --due` fires — schedule that with cron or launchd.\n',
      );
      return 0;
    });
  }

  if (sub === 'retire') {
    const id = (words[1] ?? '').trim();
    if (!id) {
      process.stderr.write(STANDING_USAGE);
      return 2;
    }
    return withStore((store) => {
      try {
        retireStanding(store, id, now());
      } catch (error) {
        process.stderr.write(`standing: ${(error as Error).message}\n`);
        return 1;
      }
      process.stdout.write(`retired ${id}; its firings stay on the record\n`);
      return 0;
    });
  }

  if (sub === undefined || sub === 'list') {
    return withStore((store) => {
      const rows = listStanding(store, { includeRetired: flags.all !== undefined });
      if (rows.length === 0) {
        process.stdout.write('no standing outcomes declared.\n');
        return 0;
      }
      for (const row of rows) {
        const last = lastFiredAt(store, row.id);
        process.stdout.write(
          `${row.id}  every ${renderCadence(row.everyMinutes)}  (workspace ${row.workspace})` +
            (row.domains ? `  staff: ${row.domains.join(', ')}` : '') +
            (row.retiredAt ? `  (retired ${row.retiredAt})` : '') +
            '\n' +
            `  outcome: ${row.outcome}\n` +
            `  ${last ? `last fired ${last}` : 'never fired'}\n`,
        );
      }
      return 0;
    });
  }

  process.stderr.write(STANDING_USAGE);
  return 2;
}
