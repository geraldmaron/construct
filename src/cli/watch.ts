/**
 * cli/watch.ts — an outcome that never closes.
 *
 * There is no "start" to run and nothing to schedule: something outside
 * decides when to look, exactly as something outside decides when to `work`.
 * The bare form's only ground is Construct itself, which is why it takes a
 * repo root and nothing else; external ground is declared with `source add`
 * and followed with `watch add`, never with `--root`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { sourceEdgesTouching } from '../kernel/store/source-edges.ts';
import {
  constructFindings,
  divergenceFindings,
  lostRecordFindings,
  CONSTRUCT_GROUND,
} from '../kernel/watch/construct-ground.ts';
import { startWatch, sweepWatch, watchRun } from '../kernel/watch/watch.ts';
import type { Watch } from '../kernel/watch/watch.ts';
import {
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
import { describeDivergence, lostRecords, reconcileSession } from '../kernel/tracker/session-drift.ts';
import { surveySource } from '../hosts/sources.ts';
import { gatherDivergence, gatherRepoEvidence, isFailure, recordedHistory } from '../hosts/repo/evidence.ts';
import { HOST_NAMES, now, withStore } from './runtime.ts';
import { splitFlags } from './flags.ts';
import { parseCadence, renderCadence } from './cadence.ts';

const WATCH_USAGE =
  'usage: construct watch [--root=<repo>]\n' +
  '       construct watch add --source=<source-id> --every=<N>m|<N>h|<N>d ' +
  '[--host=<opencode|claude|codex|cursor>]\n' +
  '       construct watch list [--all]\n' +
  '       construct watch retire <id>\n' +
  '       construct watch --due\n' +
  '         (schedule `construct watch --due` with cron or launchd; nothing here waits or wakes)\n';

/**
 * Whether a root is a checkout of Construct itself, decided from the package
 * identity rather than from the presence of a tracker: any repository can carry
 * beads, and only this one is what the watch's findings are about.
 */
function isConstructCheckout(root: string): boolean {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return (
      typeof manifest === 'object' &&
      manifest !== null &&
      (manifest as { name?: unknown }).name === '@geraldmaron/construct'
    );
  } catch {
    return false;
  }
}

/**
 * Declare a watch over an already-declared source. Cadence and an optional
 * host are recorded exactly as a standing outcome records them, but nothing
 * here spends anything: the declaration is a setting, and the first survey
 * waits for `--due` the same way a standing outcome's first run does.
 */
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

/**
 * What this sweep's change means for the sources this one is declared to stand
 * in a relationship with.
 *
 * A watch over one source can say that source moved. Only a declared
 * relationship says what else was supposed to move with it, and only the other
 * end's own watch can say whether it did. Both are asked here, and a
 * relationship whose other end nothing is watching produces nothing: an
 * unwatched source has not been seen to hold still, and saying otherwise would
 * be inventing the fact the finding rests on.
 */
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
        otherLastChangedAt: lastObservedChange(firings),
        since: input.since,
        firedAt: input.firedAt,
      }),
    );
  }
  return findings;
}

/**
 * Fire what has come due: survey each elapsed watch's source structurally,
 * compare the survey to what the last firing recorded, and raise whatever
 * changed. No host is consulted here regardless of what a declaration names —
 * a watch always compares structurally, never spending on a model; naming a
 * host only records intent for whatever reviews the finding next.
 *
 * A firing is recorded whether or not anything changed, exactly as a
 * self-watch sweep always records itself: a watch that stopped running must
 * not be mistaken for a watch with nothing to report.
 */
function watchDue(): number {
  return withStore((store) => {
    const due = dueSourceWatches(store, now());
    if (due.length === 0) {
      process.stdout.write('nothing is due.\n');
      return 0;
    }
    for (const declared of due) {
      const source = getSource(store, declared.source);
      if (!source) {
        // Sources are retired, never deleted, so this names a stale
        // reference rather than a source that vanished out from under it.
        process.stderr.write(`watch: ${declared.id} names no source ${declared.source} — skipped\n`);
        continue;
      }
      const at = now();
      const target: Watch = { id: declared.id, ground: sourceGroundLine(source) };
      const run = watchRun(target);
      if (readWorkLog(store, run).length === 0) startWatch(store, target, at);

      const shape = sourceShape(store, source.id);
      const survey = surveySource(source, shape ? { emphasis: shape.emphasis, cap: shape.cap } : undefined);
      const current = snapshotFromSurvey(survey);
      const priorFiring = latestSourceWatchFiring(store, declared.id);
      const prior = priorFiring ? (priorFiring.snapshot as SourceSnapshot) : null;

      const findings = [
        ...sourceWatchFindings({ source, prior, current, firedAt: at }),
        // What this source moving says about the sources the user declared it
        // stands in a relationship with. Raised in the same sweep, into the
        // same inbox, because it is one call about one change.
        ...(prior === null || priorFiring === null
          ? []
          : divergenceAcrossRelations(store, {
              source,
              prior,
              current,
              since: priorFiring.firedAt,
              firedAt: at,
            })),
      ];
      // Raised before recorded: a crash between the two leaves the next sweep
      // comparing against the same prior state and re-detecting the change,
      // which a duplicate decision survives; the other order could record a
      // snapshot whose finding never made it to the inbox.
      const result = sweepWatch(store, { watch: target, findings, at });
      recordSourceWatchFiring(store, { watch: declared.id, run, firedAt: at, snapshot: current });

      process.stdout.write(
        `watch ${declared.id} (every ${renderCadence(declared.everyMinutes)}):\n  ground: ${target.ground}\n`,
      );
      process.stdout.write(
        findings.length === 0
          ? `  ${prior ? 'no change since the last sweep.' : 'first sweep; recorded a baseline.'}\n`
          : `  ${String(result.raised.length)} raised as new decision(s).\n`,
      );
    }
    process.stdout.write('\nRead decisions with: construct inbox\n');
    return 0;
  });
}

/**
 * The standing watch, swept once when the bare form runs; `add`/`list`/
 * `retire`/`--due` manage watches pointed at declared external sources.
 *
 * A watch is an outcome that never closes, so there is no "start" to run and
 * nothing to schedule: something outside decides when to look, exactly as
 * something outside decides when to `work`. The bare form's only ground is
 * Construct itself (commitment 16 made operational), which is why it takes a
 * repo root and nothing else — external ground is declared with `source add`
 * and followed with `watch add`, never with `--root`.
 *
 * `--root` therefore selects WHICH CHECKOUT of Construct to inspect, and never
 * which project to watch. The findings are drift between this project's
 * strategy, tracker, and repo; pointed at an unrelated repository they would be
 * meaningless, and reporting them under Construct's own watch identity — which
 * is what happened while the flag was half-wired — is worse than meaningless,
 * because the record would name a ground the evidence did not come from. A root
 * that is not a Construct checkout is refused by name rather than swept.
 */
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

  const root = flags.root || process.cwd();
  if (!isConstructCheckout(root)) {
    process.stderr.write(
      `watch: ${root} is not a Construct checkout.\n` +
        'The bare form reports drift between this project\'s strategy, tracker, and\n' +
        'repo, so --root selects which checkout of Construct to inspect, not which\n' +
        'project to watch. To watch other ground, declare it first:\n' +
        '  construct source add --kind=directory --locator=<path>\n' +
        '  construct watch add --source=<source-id> --every=<N>m|<N>h|<N>d\n',
    );
    return 1;
  }

  const gathered = gatherRepoEvidence({ root });
  if (isFailure(gathered)) {
    // Nothing to watch is not a failure of the watch; it is a fact about the
    // ground, and saying which is the difference between a broken tool and an
    // unwatched repository.
    process.stderr.write(`watch: ${gathered.problem}\n`);
    return 1;
  }

  const at = now();
  const report = reconcileSession(gathered.issues, gathered.evidence, at);
  // Two more witnesses beyond the tracker-vs-commits reconcile above, read the
  // same way scripts/reconcile-tracker.mjs reads them, so the standing watch
  // and the script never disagree about what they found: a close or filing
  // the export's own history remembers and the export no longer does, and
  // beads with commits on main that this checkout cannot see at all.
  const lost = lostRecords(gathered.issues, recordedHistory(root, undefined, at) ?? undefined);
  const divergence = describeDivergence(gatherDivergence({ root }) ?? undefined);
  const findings = [
    ...constructFindings(report),
    ...lostRecordFindings(lost),
    ...divergenceFindings(divergence),
  ];
  const target: Watch = { id: 'construct', ground: CONSTRUCT_GROUND };

  return withStore((store) => {
    if (readWorkLog(store, watchRun(target)).length === 0) startWatch(store, target, at);
    const result = sweepWatch(store, { watch: target, findings, at });

    process.stdout.write(`watch ${target.id}\n  ground: ${target.ground}\n\n`);
    if (findings.length === 0) {
      process.stdout.write('nothing diverged. The tracker and the repo agree.\n');
      return 0;
    }
    process.stdout.write(
      `${String(findings.length)} finding(s): ` +
        `${String(result.raised.length)} raised as new decisions, ` +
        `${String(result.standing.length)} already standing.\n`,
    );
    for (const key of result.raised) process.stdout.write(`  new       ${key}\n`);
    for (const key of result.standing) process.stdout.write(`  standing  ${key}\n`);
    if (result.raised.length > 0) {
      process.stdout.write('\nRead them:  construct inbox\n');
    } else {
      // A sweep that raises nothing new is the common case, and it must not
      // read as a sweep that found nothing.
      process.stdout.write(
        '\nEverything found is already in the inbox, unresolved. A standing finding is\n' +
          'not raised twice; resolve it with: construct decide --id=<id> --resolution="..."\n',
      );
    }
    return 0;
  });
}
