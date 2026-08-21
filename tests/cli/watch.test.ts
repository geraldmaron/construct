/**
 * tests/cli/watch.test.ts — a watch over a declared external source, through
 * the real CLI surface.
 *
 * The claims held here mirror the standing-outcome recipe on purpose:
 * declaring runs nothing, `--due` sweeps exactly what has elapsed, an
 * immediate second `--due` fires nothing, and a retired watch stays retired.
 * Particular to a source watch: the first-ever sweep and every sweep over
 * ground that has not moved both record a firing and raise nothing, while
 * ground that moved between two firings is raised as one decision in the
 * inbox — and none of it survives the call as a process left running, which
 * is the property that matters most for something a cron line invokes
 * unattended.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { source, watch } from '../../src/cli/index.ts';
import { openStore } from '../../src/kernel/store/open.ts';
import { getSource, sourcesFor } from '../../src/kernel/store/sources.ts';
import {
  firingsForSourceWatch,
  latestSourceWatchFiring,
  listSourceWatches,
  recordSourceWatchFiring,
} from '../../src/kernel/store/source-watches.ts';
import { openDecisions } from '../../src/kernel/store/decisions.ts';
import { readWorkLog } from '../../src/kernel/store/worklog.ts';
import { surveySource } from '../../src/hosts/sources.ts';
import { snapshotFromSurvey } from '../../src/kernel/watch/source-ground.ts';

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

type Step = () => number;

function runAll(sequence: readonly Step[]): Capture {
  const root = mkdtempSync(join(tmpdir(), 'construct-watch-cli-'));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  (process.stderr as { write: unknown }).write = (c: string) => (err.push(String(c)), true);
  let code = 0;
  try {
    for (const step of sequence) code = step();
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

function inStore<T>(fn: (store: ReturnType<typeof openStore>) => T): T {
  const store = openStore(join(process.env.XDG_DATA_HOME as string, 'construct', 'construct.db'));
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

function docsGround(files: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'construct-watch-ground-'));
  for (const name of files) writeFileSync(join(dir, name), `# ${name}\n\nfixture content.\n`);
  return dir;
}

function declareGroundAndWatch(ground: string, every: string): Step[] {
  return [
    () => source(['add', '--kind=directory', `--locator=${ground}`, '--workspace=ops']),
    () => {
      const sourceId = inStore((store) => sourcesFor(store, 'ops')[0].id);
      return watch(['add', `--source=${sourceId}`, `--every=${every}`]);
    },
  ];
}

test('declaring a source watch stores the intention and surveys nothing', () => {
  const ground = docsGround(['roadmap.md']);
  try {
    const { code, out } = runAll([
      ...declareGroundAndWatch(ground, '1d'),
      () => {
        inStore((store) => {
          const rows = listSourceWatches(store);
          assert.equal(rows.length, 1);
          assert.equal(rows[0].everyMinutes, 1440);
          assert.equal(rows[0].workspace, 'ops', 'workspace is inferred from the source');
          assert.equal(rows[0].host, null);
          assert.equal(latestSourceWatchFiring(store, rows[0].id), null, 'declaring fires nothing');
        });
        return 0;
      },
      () => watch(['list']),
    ]);
    assert.equal(code, 0);
    assert.match(out, /declared srcwatch-/);
    assert.match(out, /nothing runs until/);
    assert.match(out, /every 1d/);
    assert.match(out, /never fired/);
  } finally {
    rmSync(ground, { recursive: true, force: true });
  }
});

test('watch add refuses an unknown source, a broken cadence, and an unknown host', () => {
  const unknownSource = runAll([() => watch(['add', '--source=ghost', '--every=1d'])]);
  assert.equal(unknownSource.code, 1);
  assert.match(unknownSource.err, /no source ghost/);

  const brokenCadence = runAll([() => watch(['add', '--source=ghost', '--every=nope'])]);
  assert.equal(brokenCadence.code, 2);
  assert.match(brokenCadence.err, /--every takes/);

  const unknownHost = runAll([() => watch(['add', '--source=ghost', '--every=1d', '--host=bogus'])]);
  assert.equal(unknownHost.code, 2);
  assert.match(unknownHost.err, /unknown host "bogus"/);
});

test('watch add refuses a duplicate active watch on the same source', () => {
  const ground = docsGround(['roadmap.md']);
  try {
    const { code, err } = runAll([
      ...declareGroundAndWatch(ground, '1d'),
      () => {
        const sourceId = inStore((store) => sourcesFor(store, 'ops')[0].id);
        return watch(['add', `--source=${sourceId}`, '--every=1h']);
      },
    ]);
    assert.equal(code, 1);
    assert.match(err, /already has an active watch/);
  } finally {
    rmSync(ground, { recursive: true, force: true });
  }
});

test('the first sweep of a freshly declared watch records a quiet baseline; no decision is raised', () => {
  const ground = docsGround(['roadmap.md']);
  try {
    const { code, out } = runAll([
      ...declareGroundAndWatch(ground, '1m'),
      () => watch(['--due']),
      () => {
        inStore((store) => {
          const w = listSourceWatches(store)[0];
          assert.ok(latestSourceWatchFiring(store, w.id), 'a firing was recorded');
          assert.equal(openDecisions(store).length, 0, 'a first sweep raises nothing');
          const actions = readWorkLog(store, `watch-${w.id}`).map((e) => e.action);
          assert.deepEqual(actions, ['watch-started', 'watch-swept']);
        });
        return 0;
      },
    ]);
    assert.equal(code, 0);
    assert.match(out, /first sweep; recorded a baseline\./);
  } finally {
    rmSync(ground, { recursive: true, force: true });
  }
});

test('an immediate second --due finds nothing due', () => {
  const ground = docsGround(['roadmap.md']);
  try {
    const { code, out } = runAll([
      ...declareGroundAndWatch(ground, '1h'),
      () => watch(['--due']),
      () => watch(['--due']),
    ]);
    assert.equal(code, 0);
    assert.match(out, /nothing is due\./);
  } finally {
    rmSync(ground, { recursive: true, force: true });
  }
});

test('ground that changed since the last firing raises one decision batched to the inbox', () => {
  const ground = docsGround(['roadmap.md']);
  try {
    const { code, out } = runAll([
      ...declareGroundAndWatch(ground, '1m'),
      () => {
        // Seed a prior firing two minutes back, describing emptier ground
        // than what is actually on disk now — the cadence has elapsed and
        // the ground has moved, so the next real --due must notice both.
        inStore((store) => {
          const w = listSourceWatches(store)[0];
          const twoMinAgo = new Date(Date.now() - 2 * 60_000).toISOString();
          recordSourceWatchFiring(store, {
            watch: w.id,
            run: `watch-${w.id}`,
            firedAt: twoMinAgo,
            snapshot: { outcome: 'listed', total: 0, documents: [] },
          });
        });
        return 0;
      },
      () => watch(['--due']),
      () => {
        inStore((store) => {
          const decisions = openDecisions(store);
          assert.equal(decisions.length, 1);
          assert.match(decisions[0].question, /Ground this watch follows has moved/);
          const w = listSourceWatches(store)[0];
          const latest = latestSourceWatchFiring(store, w.id) as { snapshot: { total: number } } | null;
          assert.equal(latest?.snapshot.total, 1, 'the new firing reflects what is actually on disk now');
        });
        return 0;
      },
    ]);
    assert.equal(code, 0);
    assert.match(out, /1 raised as new decision\(s\)\./);
  } finally {
    rmSync(ground, { recursive: true, force: true });
  }
});

test('a watch whose ground has not moved since its last firing fires quietly: recorded, no decision', () => {
  const ground = docsGround(['roadmap.md']);
  try {
    const { code, out } = runAll([
      ...declareGroundAndWatch(ground, '1m'),
      () => {
        // Seed a prior firing whose snapshot exactly matches the real,
        // current ground, two minutes back so the cadence has elapsed.
        inStore((store) => {
          const w = listSourceWatches(store)[0];
          const src = getSource(store, w.source);
          assert.ok(src);
          const matching = snapshotFromSurvey(surveySource(src!));
          const twoMinAgo = new Date(Date.now() - 2 * 60_000).toISOString();
          recordSourceWatchFiring(store, {
            watch: w.id,
            run: `watch-${w.id}`,
            firedAt: twoMinAgo,
            snapshot: matching,
          });
        });
        return 0;
      },
      () => watch(['--due']),
      () => {
        inStore((store) => {
          assert.equal(openDecisions(store).length, 0, 'ground did not move, nothing to decide');
          const w = listSourceWatches(store)[0];
          // The seeded firing plus this real sweep: two firings stand on the record.
          assert.equal(firingsForSourceWatch(store, w.id).length, 2);
        });
        return 0;
      },
    ]);
    assert.equal(code, 0);
    assert.match(out, /no change since the last sweep\./);
  } finally {
    rmSync(ground, { recursive: true, force: true });
  }
});

test('a retired watch never comes due again', () => {
  const ground = docsGround(['roadmap.md']);
  try {
    const { code, out } = runAll([
      ...declareGroundAndWatch(ground, '1m'),
      () => {
        const id = inStore((store) => listSourceWatches(store)[0].id);
        return watch(['retire', id]);
      },
      () => watch(['--due']),
    ]);
    assert.equal(code, 0);
    assert.match(out, /retired srcwatch-/);
    assert.match(out, /its firings stay on the record/);
    assert.match(out, /nothing is due\./);
  } finally {
    rmSync(ground, { recursive: true, force: true });
  }
});

test('watch --due runs and exits: the process tree is untouched, nothing spawned or left listening', () => {
  const ground = docsGround(['roadmap.md']);
  const root = mkdtempSync(join(tmpdir(), 'construct-watch-resident-'));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = () => true;
  (process.stderr as { write: unknown }).write = () => true;
  try {
    assert.equal(source(['add', '--kind=directory', `--locator=${ground}`, '--workspace=ops']), 0);
    const sourceId = inStore((store) => sourcesFor(store, 'ops')[0].id);
    assert.equal(watch(['add', `--source=${sourceId}`, '--every=1m']), 0);

    const before = process.getActiveResourcesInfo();
    const code = watch(['--due']);
    const after = process.getActiveResourcesInfo();

    assert.equal(code, 0);
    assert.deepEqual(
      after,
      before,
      'a cron-invoked sweep must leave no active handle behind: nothing spawned, nothing listening, nothing still pending',
    );
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    rmSync(root, { recursive: true, force: true });
    rmSync(ground, { recursive: true, force: true });
  }
});
