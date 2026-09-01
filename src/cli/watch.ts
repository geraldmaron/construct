/**
 * cli/watch.ts — an outcome that never closes over declared external ground.
 *
 * There is no resident sweeper: something outside decides when to look.
 * Declared sources are followed with `watch add`; schedule `construct watch
 * `--due` with cron or launchd. Construct checkout drift is repo dogfood
 * (`npm run reconcile`), not this verb.
 */

import { getSource, sourceShape } from '../kernel/store/sources.ts';
import { readWorkLog } from '../kernel/store/worklog.ts';
import {
  activeWatchForSource,
  declareSourceWatch,
  dueSourceWatches,
  firingsForSourceWatch,
  latestSourceWatchFiring,
  listSourceWatches,
  recordSourceWatchFiring,
  retireSourceWatch,
} from '../kernel/store/source-watches.ts';
import { relationPhrase, sourceEdgesFor, sourceEdgesTouching } from '../kernel/store/source-edges.ts';
import type { SourceEdge } from '../kernel/store/source-edges.ts';
import { startWatch, sweepWatch, watchRun } from '../kernel/watch/watch.ts';
import type { Watch } from '../kernel/watch/watch.ts';
import {
  divergenceInertNotice,
  divergenceInertUnwatchedEnd,
  edgeDivergenceFindings,
  lastObservedChange,
  snapshotFromSurvey,
  sourceChangeSummary,
  sourceGroundLine,
  sourceWatchFindings,
} from '../kernel/watch/source-ground.ts';
import type { SourceSnapshot } from '../kernel/watch/source-ground.ts';
import type { Store } from '../kernel/store/open.ts';
import type { Finding } from '../kernel/watch/watch.ts';
import type { Source } from '../kernel/store/sources.ts';
import { surveySource } from '../hosts/sources.ts';
import { HOST_NAMES, now, withStore } from './runtime.ts';
import { splitFlags } from './flags.ts';
import { parseCadence, renderCadence } from './cadence.ts';

const WATCH_USAGE =
  'usage: construct watch add --source=<source-id> --every=<N>m|<N>h|<N>d ' +
  '[--host=<opencode|claude|codex|cursor>]\n' +
  '       construct watch list [--all]\n' +
  '       construct watch retire <id>\n' +
  '       construct watch --due\n' +
  '         (schedule `construct watch --due` with cron or launchd; nothing here waits or wakes)\n' +
  '       Construct checkout drift: npm run reconcile (repo dogfood, not this verb)\n';

function relationSummary(store: Store, edge: SourceEdge): string {
  const where = (id: string): string => getSource(store, id)?.locator ?? id;
  return `${where(edge.from)} ${relationPhrase(edge.relation)} ${where(edge.to)}`;
}

function watchCoverageHints(
  store: Store,
  sourceId: string,
): { readonly checkable: readonly string[]; readonly inert: readonly string[] } {
  const checkable: string[] = [];
  const inert: string[] = [];
  for (const edge of sourceEdgesTouching(store, sourceId)) {
    if (edge.retiredAt !== null) continue;
    const fromW = activeWatchForSource(store, edge.from) !== null;
    const toW = activeWatchForSource(store, edge.to) !== null;
    const unwatchedId = divergenceInertUnwatchedEnd(edge, fromW, toW);
    if (unwatchedId === null && fromW && toW) {
      checkable.push(relationSummary(store, edge));
    } else if (unwatchedId !== null) {
      const unwatched = getSource(store, unwatchedId);
      if (unwatched) inert.push(`${relationSummary(store, edge)} — ${divergenceInertNotice(unwatched)}`);
    }
  }
  return { checkable, inert };
}

function writeDivergenceInertRelations(store: Store, workspace: string): void {
  const lines: string[] = [];
  for (const edge of sourceEdgesFor(store, workspace)) {
    if (edge.retiredAt !== null) continue;
    const unwatchedId = divergenceInertUnwatchedEnd(
      edge,
      activeWatchForSource(store, edge.from) !== null,
      activeWatchForSource(store, edge.to) !== null,
    );
    if (unwatchedId === null) continue;
    const unwatched = getSource(store, unwatchedId);
    if (!unwatched) continue;
    lines.push(`${relationSummary(store, edge)} — ${divergenceInertNotice(unwatched)}`);
  }
  if (lines.length === 0) return;
  process.stdout.write('\nDivergence checks inert until both ends are watched:\n');
  for (const line of lines) process.stdout.write(`  ${line}\n`);
}

function watchAdd(flags: Record<string, string>): number {
  const sourceId = (flags.source ?? '').trim();
  if (sourceId === '' || flags.every === undefined) {
    process.stderr.write(WATCH_USAGE);
    return 2;
  }
  let everyMinutes: number;
  try {
    everyMinutes = parseCadence(flags.every);
  } catch (error) {
    process.stderr.write(`watch: ${(error as Error).message}\n`);
    return 2;
  }
  const host = flags.host;
  if (host !== undefined && !(HOST_NAMES as readonly string[]).includes(host)) {
    process.stderr.write(`watch: unknown host "${host}" (expected ${HOST_NAMES.join(', ')})\n`);
    return 2;
  }
  return withStore((store) => {
    const source = getSource(store, sourceId);
    if (!source) {
      process.stderr.write(`watch: no source ${sourceId} — declare it first: construct source add\n`);
      return 1;
    }
    const at = now();
    const id = `srcwatch-${at.replace(/[-:.TZ]/g, '')}`;
    try {
      declareSourceWatch(store, {
        id,
        workspace: source.workspace,
        source: sourceId,
        host: host ?? null,
        everyMinutes,
        declaredAt: at,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE/i.test(message)) {
        process.stderr.write(
          `watch: ${sourceId} already has an active watch — retire it first to redeclare\n`,
        );
        return 1;
      }
      process.stderr.write(`watch: ${message}\n`);
      return 1;
    }
    process.stdout.write(
      `declared ${id}: watching ${sourceGroundLine(source)} every ${renderCadence(everyMinutes)}` +
        (host ? ` (host ${host} named; structural comparison still runs every sweep)` : '') +
        '\n' +
        '  nothing runs until `construct watch --due` fires — schedule that with cron or launchd.\n',
    );
    const hints = watchCoverageHints(store, sourceId);
    if (hints.checkable.length > 0) {
      process.stdout.write('  divergence now checkable on:\n');
      for (const line of hints.checkable) process.stdout.write(`    ${line}\n`);
    }
    if (hints.inert.length > 0) {
      process.stdout.write('  still divergence-inert until the other end is watched:\n');
      for (const line of hints.inert) process.stdout.write(`    ${line}\n`);
    } else if (hints.checkable.length === 0) {
      process.stdout.write('  no declared relationships touch this source.\n');
    }
    return 0;
  });
}

function watchList(flags: Record<string, string>): number {
  return withStore((store) => {
    const rows = listSourceWatches(store, { includeRetired: flags.all !== undefined });
    if (rows.length === 0) {
      process.stdout.write('no source watches declared.\n');
      return 0;
    }
    for (const row of rows) {
      const source = getSource(store, row.source);
      const last = latestSourceWatchFiring(store, row.id);
      process.stdout.write(
        `${row.id}  every ${renderCadence(row.everyMinutes)}  (workspace ${row.workspace})` +
          (row.host ? `  host: ${row.host}` : '') +
          (row.retiredAt ? `  (retired ${row.retiredAt})` : '') +
          '\n' +
          `  source: ${row.source}${source ? ` — ${sourceGroundLine(source)}` : ' (no longer declared)'}\n` +
          `  ${last ? `last fired ${last.firedAt}` : 'never fired'}\n`,
      );
    }
    return 0;
  });
}

function watchRetire(id: string | undefined): number {
  if (!id || id.trim() === '') {
    process.stderr.write(WATCH_USAGE);
    return 2;
  }
  return withStore((store) => {
    try {
      retireSourceWatch(store, id, now());
    } catch (error) {
      process.stderr.write(`watch: ${(error as Error).message}\n`);
      return 1;
    }
    process.stdout.write(`retired ${id}; its firings stay on the record\n`);
    return 0;
  });
}

function divergenceAcrossRelations(
  store: Store,
  input: {
    readonly source: Source;
    readonly prior: SourceSnapshot;
    readonly current: SourceSnapshot;
    readonly since: string;
    readonly firedAt: string;
  },
): Finding[] {
  const detail = sourceChangeSummary(input.prior, input.current);
  if (detail === null) return [];
  const findings: Finding[] = [];
  for (const edge of sourceEdgesTouching(store, input.source.id)) {
    const otherId = edge.from === input.source.id ? edge.to : edge.from;
    const other = getSource(store, otherId);
    if (!other) continue;
    const watch = activeWatchForSource(store, otherId);
    if (!watch) continue;
    const firings = firingsForSourceWatch(store, watch.id);
    findings.push(
      ...edgeDivergenceFindings({
        edge,
        moved: input.source,
        detail,
        other,
        otherLastSweptAt: firings.at(-1)?.firedAt ?? null,
        otherLastChangedAt: lastObservedChange(firings, input.since),
        since: input.since,
        firedAt: input.firedAt,
      }),
    );
  }
  return findings;
}

/** What one due watch's sweep did, for whichever surface is reporting it. */
export interface SourceWatchSweep {
  readonly watch: string;
  readonly workspace: string;
  readonly everyMinutes: number;
  readonly ground: string;
  readonly findings: number;
  readonly raised: number;
  readonly firstSweep: boolean;
  readonly skipped: string | null;
}

export function sweepDueSourceWatches(store: Store, at: () => string): SourceWatchSweep[] {
  const swept: SourceWatchSweep[] = [];
  for (const declared of dueSourceWatches(store, at())) {
    const source = getSource(store, declared.source);
    if (!source) {
      swept.push({
        watch: declared.id,
        workspace: declared.workspace,
        everyMinutes: declared.everyMinutes,
        ground: declared.source,
        findings: 0,
        raised: 0,
        firstSweep: false,
        skipped: `names no source ${declared.source}`,
      });
      continue;
    }
    const firedAt = at();
    const target: Watch = { id: declared.id, ground: sourceGroundLine(source) };
    const run = watchRun(target);
    if (readWorkLog(store, run).length === 0) startWatch(store, target, firedAt);

    const shape = sourceShape(store, source.id);
    const survey = surveySource(source, shape ? { emphasis: shape.emphasis, cap: shape.cap } : undefined);
    const current = snapshotFromSurvey(survey);
    const priorFiring = latestSourceWatchFiring(store, declared.id);
    const prior = priorFiring ? (priorFiring.snapshot as SourceSnapshot) : null;

    const findings = [
      ...sourceWatchFindings({ source, prior, current, firedAt }),
      ...(prior === null || priorFiring === null
        ? []
        : divergenceAcrossRelations(store, {
            source,
            prior,
            current,
            since: priorFiring.firedAt,
            firedAt,
          })),
    ];
    const result = sweepWatch(store, { watch: target, findings, at: firedAt });
    recordSourceWatchFiring(store, { watch: declared.id, run, firedAt, snapshot: current });

    swept.push({
      watch: declared.id,
      workspace: declared.workspace,
      everyMinutes: declared.everyMinutes,
      ground: target.ground,
      findings: findings.length,
      raised: result.raised.length,
      firstSweep: prior === null,
      skipped: null,
    });
  }
  return swept;
}

function watchDue(): number {
  return withStore((store) => {
    const swept = sweepDueSourceWatches(store, now);
    if (swept.length === 0) {
      process.stdout.write('nothing is due.\n');
      return 0;
    }
    const workspaces = new Set<string>();
    for (const sweep of swept) {
      if (sweep.skipped !== null) {
        process.stderr.write(`watch: ${sweep.watch} ${sweep.skipped} — skipped\n`);
        continue;
      }
      workspaces.add(sweep.workspace);
      process.stdout.write(
        `watch ${sweep.watch} (every ${renderCadence(sweep.everyMinutes)}):\n  ground: ${sweep.ground}\n`,
      );
      process.stdout.write(
        sweep.findings === 0
          ? `  ${sweep.firstSweep ? 'first sweep; recorded a baseline.' : 'no change since the last sweep.'}\n`
          : `  ${String(sweep.raised)} raised as new decision(s).\n`,
      );
    }
    for (const workspace of workspaces) writeDivergenceInertRelations(store, workspace);
    process.stdout.write('\nRead decisions with: construct inbox\n');
    return 0;
  });
}

/** Source watches: `add`/`list`/`retire`/`--due`. */
export function watch(argv: string[]): number {
  const { flags, words } = splitFlags(argv);
  if (flags.help !== undefined) {
    process.stdout.write(WATCH_USAGE);
    return 0;
  }

  const sub = words[0];
  if (sub === 'add') return watchAdd(flags);
  if (sub === 'list') return watchList(flags);
  if (sub === 'retire') return watchRetire(words[1]);
  if (flags.due !== undefined) return watchDue();

  process.stderr.write(
    'watch: declare source watches with `construct watch add`, or run due sweeps with `--due`.\n' +
      'Construct checkout drift (tracker vs repo) is repo dogfood:\n' +
      '  npm run reconcile\n',
  );
  process.stderr.write(WATCH_USAGE);
  return 2;
}
