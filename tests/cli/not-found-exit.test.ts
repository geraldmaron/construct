/**
 * tests/cli/not-found-exit.test.ts — a run id nobody recorded is a failure a
 * script can see, not an empty result indistinguishable from one.
 *
 * `show`, `log`, and `plan` all read a run by id, and before this a wrong or
 * stale id and a real-but-empty run printed the same "nothing here" line and
 * both exited `0` — a script piping `construct show --run=$id` had no way to
 * tell "this run has no deliverables yet" from "this run does not exist".
 * Every plan is written once at outcome time (`kernel/store/plans.ts`), so a
 * plan on record is what makes a run real; these tests pin that a run with a
 * plan but nothing else recorded yet still exits `0`, while a run id with no
 * plan at all exits non-zero — in both the human and `--json` rendering.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { log, plan, show } from '../../src/cli/index.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { recordPlan } from '../../src/kernel/store/plans.ts';
import { buildPlan } from '../../src/kernel/plan/planner.ts';

const AT = '2026-08-25T00:00:00.000Z';

async function run(seed: (store: ReturnType<typeof openStore>) => void, fn: () => number): Promise<{ code: number; out: string }> {
  const root = mkdtempSync(join(tmpdir(), 'construct-not-found-'));
  const previous = { data: process.env.XDG_DATA_HOME, cache: process.env.XDG_CACHE_HOME };
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_CACHE_HOME = join(root, 'cache');
  const out: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  (process.stderr as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  try {
    const store = openStore(storePath(resolvePaths()));
    seed(store);
    store.close();
    const code = fn();
    return { code, out: out.join('') };
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

function seedPlan(store: ReturnType<typeof openStore>, run: string): void {
  const built = buildPlan({
    id: `plan-${run}`,
    run,
    outcome: 'assess the thing',
    densified: null,
    implicated: [{ domain: 'security', concern: 'c', score: 10, signals: ['webhook'] }],
    inferredBy: 'keywords',
    sources: [],
    workspace: 'default',
    mode: 'team',
    plannedAt: AT,
  });
  recordPlan(store, built);
}

test('show on a run id with no recorded plan exits non-zero', async () => {
  const { code, out } = await run(() => {}, () => show(['--run=run-never-recorded']));
  assert.equal(code, 1);
  assert.match(out, /no tasks for run-never-recorded/);
});

test('show --json on a run id with no recorded plan exits non-zero', async () => {
  const { code } = await run(() => {}, () => show(['--run=run-never-recorded', '--json']));
  assert.equal(code, 1);
});

test('show on a real run with a plan but no tasks yet stays exit 0', async () => {
  const { code, out } = await run(
    (store) => seedPlan(store, 'run-empty-but-real'),
    () => show(['--run=run-empty-but-real']),
  );
  assert.equal(code, 0);
  assert.match(out, /no tasks for run-empty-but-real/);
});

test('log --run on an id with no recorded plan exits non-zero', async () => {
  const { code, out } = await run(() => {}, () => log(['--run=run-never-recorded']));
  assert.equal(code, 1);
  assert.match(out, /no work log entries for run-never-recorded/);
});

test('log --run on a real run with a plan but no log entries yet stays exit 0', async () => {
  const { code } = await run(
    (store) => seedPlan(store, 'run-empty-but-real'),
    () => log(['--run=run-empty-but-real']),
  );
  assert.equal(code, 0);
});

test('log with no --run stays exit 0 on a completely empty store', async () => {
  const { code, out } = await run(() => {}, () => log([]));
  assert.equal(code, 0);
  assert.match(out, /work log is empty/);
});

test('plan on a run id with no recorded plan exits non-zero', async () => {
  const { code, out } = await run(() => {}, () => plan(['run-never-recorded']));
  assert.equal(code, 1);
  assert.match(out, /no plan recorded/);
});

test('plan on a real recorded run stays exit 0', async () => {
  const { code } = await run(
    (store) => seedPlan(store, 'run-empty-but-real'),
    () => plan(['run-empty-but-real']),
  );
  assert.equal(code, 0);
});
