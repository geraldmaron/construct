/**
 * tests/cli/reconcile.test.ts — tracker drift made visible through the real
 * CLI surface.
 *
 * `construct reconcile` never talks to a tracker itself (no host adapter is
 * imported anywhere in its path); a `--live` read is something the caller
 * hands it, exactly like `staff propose --file=`. These tests drive that
 * real surface: a matching live read reports in_sync, a disagreeing one
 * reports drifted and lands a decision in the inbox, a second run over the
 * same disagreement raises nothing new, and omitting --live falls back to
 * reporting what the store already recorded rather than guessing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inbox, reconcile } from '../../src/cli/index.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { putProjection } from '../../src/kernel/store/projections.ts';
import { buildProjection } from '../../src/kernel/tracker/projection.ts';
import { openDecisions } from '../../src/kernel/store/decisions.ts';

const AT = '2026-08-21T00:00:00.000Z';

// `title` and `description` are domain-owned; `status` is tracker-owned —
// the same split a proposal's mirrored issue carries once it crosses into a
// tracker (kernel/tracker/crossing.ts's proposalIssue only ever asserts
// title and description).
const ISSUE = {
  id: 'p-1',
  title: 'Move PROJ-14 target date to Q4',
  description: 'Why: the vendor slipped their delivery date.',
  status: 'open',
};

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function run(fn: (root: string) => Promise<number>): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-reconcile-'));
  const previous = { data: process.env.XDG_DATA_HOME, cache: process.env.XDG_CACHE_HOME };
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_CACHE_HOME = join(root, 'cache');
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  (process.stderr as { write: unknown }).write = (c: string) => (err.push(String(c)), true);
  let code = 0;
  try {
    code = await fn(root);
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
    if (previous.data === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous.data;
    if (previous.cache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previous.cache;
    rmSync(root, { recursive: true, force: true });
  }
}

test('no projections recorded is reported plainly, not as an error', async () => {
  const { code, out } = await run(async () => reconcile(['--tracker=jira']));
  assert.equal(code, 0);
  assert.match(out, /no projected proposals recorded/);
});

test('--live requires --tracker, since an external id is unique only within one tracker', async () => {
  const { code, err } = await run(async (root) => {
    const liveFile = join(root, 'live.json');
    writeFileSync(liveFile, '[]');
    return reconcile([`--live=${liveFile}`]);
  });
  assert.equal(code, 2);
  assert.match(err, /--tracker/);
});

test('an unreadable --live file is a clean error, not a crash', async () => {
  const { code, err } = await run(async (root) =>
    reconcile(['--tracker=jira', `--live=${join(root, 'does-not-exist.json')}`]),
  );
  assert.equal(code, 1);
  assert.match(err, /cannot read/);
});

test('a --live file that is not a JSON array is refused', async () => {
  const { code, err } = await run(async (root) => {
    const liveFile = join(root, 'live.json');
    writeFileSync(liveFile, JSON.stringify({ not: 'an array' }));
    return reconcile(['--tracker=jira', `--live=${liveFile}`]);
  });
  assert.equal(code, 1);
  assert.match(err, /JSON array/);
});

test('a projection matching the live read reports in_sync and raises nothing', async () => {
  let decisionsAfter = -1;
  const { code, out } = await run(async (root) => {
    const store = openStore(storePath(resolvePaths()));
    putProjection(store, buildProjection(ISSUE, { tracker: 'jira', importedAt: AT }));
    store.close();

    const liveFile = join(root, 'live.json');
    writeFileSync(liveFile, JSON.stringify([ISSUE]));
    const result = reconcile(['--tracker=jira', `--live=${liveFile}`]);

    const check = openStore(storePath(resolvePaths()));
    decisionsAfter = openDecisions(check).length;
    check.close();
    return result;
  });
  assert.equal(code, 0);
  assert.match(out, /in_sync\s+p-1/);
  assert.match(out, /nothing drifted/);
  assert.equal(decisionsAfter, 0);
});

test('a domain-owned drift is reported and raised into the decision inbox', async () => {
  const { code, out } = await run(async (root) => {
    const store = openStore(storePath(resolvePaths()));
    putProjection(store, buildProjection(ISSUE, { tracker: 'jira', importedAt: AT }));
    store.close();

    const liveFile = join(root, 'live.json');
    writeFileSync(liveFile, JSON.stringify([{ ...ISSUE, title: 'Renamed directly in Jira' }]));
    const result = reconcile(['--tracker=jira', `--live=${liveFile}`]);
    inbox();
    return result;
  });
  assert.equal(code, 0);
  assert.match(out, /drifted\s+p-1\s+\(title\)/);
  assert.match(out, /1 new decision\(s\) raised, 0 already standing/);
  assert.match(out, /reconcile:jira:p-1:title/);
  assert.match(out, /decision inbox \(1\)/);
  assert.match(out, /disagrees with the live jira read on title/);
});

test('re-running reconcile over the same drift raises nothing new', async () => {
  let decisionsAfter = -1;
  const { code, out } = await run(async (root) => {
    const store = openStore(storePath(resolvePaths()));
    putProjection(store, buildProjection(ISSUE, { tracker: 'jira', importedAt: AT }));
    store.close();

    const liveFile = join(root, 'live.json');
    writeFileSync(liveFile, JSON.stringify([{ ...ISSUE, title: 'Renamed directly in Jira' }]));
    reconcile(['--tracker=jira', `--live=${liveFile}`]);
    const second = reconcile(['--tracker=jira', `--live=${liveFile}`]);

    const check = openStore(storePath(resolvePaths()));
    decisionsAfter = openDecisions(check).length;
    check.close();
    return second;
  });
  assert.equal(code, 0);
  assert.equal(decisionsAfter, 1, 'the second run must not raise a duplicate decision for the same drift');
  assert.match(out, /0 new decision\(s\) raised, 1 already standing/);
});

test('a projection absent from the live read is reported missing and raised once', async () => {
  let decisionsAfter = -1;
  const { code, out } = await run(async (root) => {
    const store = openStore(storePath(resolvePaths()));
    putProjection(store, buildProjection(ISSUE, { tracker: 'jira', importedAt: AT }));
    store.close();

    const liveFile = join(root, 'live.json');
    writeFileSync(liveFile, '[]');
    reconcile(['--tracker=jira', `--live=${liveFile}`]);
    const second = reconcile(['--tracker=jira', `--live=${liveFile}`]);

    const check = openStore(storePath(resolvePaths()));
    decisionsAfter = openDecisions(check).length;
    check.close();
    return second;
  });
  assert.equal(code, 0);
  assert.match(out, /missing\s+p-1/);
  assert.match(out, /reconcile:jira:p-1:missing/);
  assert.equal(decisionsAfter, 1, 'the missing-issue decision must not duplicate either');
});

test('without --live, the recorded state is reported honestly and nothing is raised', async () => {
  let decisionsAfter = -1;
  const { code, out } = await run(async () => {
    const store = openStore(storePath(resolvePaths()));
    putProjection(store, buildProjection(ISSUE, { tracker: 'jira', importedAt: AT }));
    store.close();

    const result = reconcile(['--tracker=jira']);

    const check = openStore(storePath(resolvePaths()));
    decisionsAfter = openDecisions(check).length;
    check.close();
    return result;
  });
  assert.equal(code, 0);
  assert.match(out, /no --live read was supplied/);
  assert.match(out, /projected\s+jira:p-1/);
  assert.equal(decisionsAfter, 0, 'no live comparison was made, so nothing is honest to raise');
});

test('--tracker filters projections to that one tracker', async () => {
  const { code, out } = await run(async (root) => {
    const store = openStore(storePath(resolvePaths()));
    putProjection(store, buildProjection(ISSUE, { tracker: 'jira', importedAt: AT }));
    putProjection(store, buildProjection({ ...ISSUE, id: 'g-1' }, { tracker: 'github', importedAt: AT }));
    store.close();

    const liveFile = join(root, 'live.json');
    writeFileSync(liveFile, JSON.stringify([ISSUE]));
    return reconcile(['--tracker=jira', `--live=${liveFile}`]);
  });
  assert.equal(code, 0);
  assert.match(out, /1 projected proposal\(s\)/);
  assert.doesNotMatch(out, /g-1/);
});
