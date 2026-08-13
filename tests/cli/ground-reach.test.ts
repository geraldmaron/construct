/**
 * tests/cli/ground-reach.test.ts — the check through the surface where it
 * failed for real.
 *
 * Observed on a live run: a workspace declared a repository, the survey walked
 * it, the roles were licensed the root, the host was dispatched from somewhere
 * else, every file read failed, and `work` reported three tasks done. This
 * holds the refusal that closes it — before a model call is spent — and holds
 * that the override is a recorded choice rather than a silent one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, work } from '../../src/cli/index.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { readWorkLog } from '../../src/kernel/store/worklog.ts';

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
  readonly dispatched: number;
}

/** A host that counts what it was asked to do, so "before a call is spent" is checkable. */
function countingHost(counter: { calls: number }): HostAdapter {
  return {
    name: 'stand-in',
    kind: 'general',
    capabilities: [],
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (): Promise<HostResult> => {
      counter.calls += 1;
      return { id: 'x', status: 'ok', output: { text: 'a deliverable' }, error: null };
    },
  };
}

async function run(
  steps: (ground: string) => ReadonlyArray<string[] | (() => Promise<number> | number)>,
  counter: { calls: number },
): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-reach-'));
  const previous = { data: process.env.XDG_DATA_HOME, cache: process.env.XDG_CACHE_HOME };
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_CACHE_HOME = join(root, 'cache');
  const ground = join(root, 'ground');
  mkdirSync(ground);
  writeFileSync(join(ground, 'strategy.md'), '# strategy\nThe pilot ships in Q4.\n');

  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  (process.stderr as { write: unknown }).write = (c: string) => (err.push(String(c)), true);
  let code = 0;
  try {
    for (const step of steps(ground)) {
      code = typeof step === 'function' ? await step() : await main(step);
    }
    return { code, out: out.join(''), err: err.join(''), dispatched: counter.calls };
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

function logActions(): string[] {
  const store = openStore(storePath(resolvePaths()));
  try {
    return readWorkLog(store).map((entry) => entry.action);
  } finally {
    store.close();
  }
}

const OUTCOME = 'Decide whether the pilot ships in Q4';

test('ground the dispatch cannot open refuses the run before a model call is spent', async () => {
  const counter = { calls: 0 };
  let actions: string[] = [];
  let worked = 0;
  const { err, dispatched } = await run(
    (ground) => [
      ['source', 'add', '--kind=directory', `--locator=${ground}`],
      ['outcome', '--domains=strategy-alignment', OUTCOME],
      // Dispatched somewhere the ground is not: the shape of the live failure.
      async () => ((worked = await work(['--dir=/nonexistent-elsewhere'], countingHost(counter))), worked),
      () => ((actions = logActions()), 0),
    ],
    counter,
  );
  assert.equal(worked, 1, 'a run that would be graded on unopenable material does not proceed');
  assert.equal(dispatched, 0, 'and nothing was paid for finding that out');
  assert.match(err, /licensed ground root is outside/);
  assert.match(err, /--allow-distant-ground/);
  assert.ok(actions.includes('ground-unreachable'), 'the refusal is on the record, not only on stderr');
});

test('the same run proceeds when it is dispatched where its ground is', async () => {
  const counter = { calls: 0 };
  const { err, dispatched } = await run(
    (ground) => [
      ['source', 'add', '--kind=directory', `--locator=${ground}`],
      ['outcome', '--domains=strategy-alignment', OUTCOME],
      () => work([`--dir=${ground}`], countingHost(counter)),
    ],
    counter,
  );
  assert.doesNotMatch(err, /licensed ground root is outside/);
  assert.ok(dispatched > 0, 'reachable ground dispatches normally');
});

test('the override dispatches, and is recorded as a choice rather than a silence', async () => {
  const counter = { calls: 0 };
  let actions: string[] = [];
  const { out, dispatched } = await run(
    (ground) => [
      ['source', 'add', '--kind=directory', `--locator=${ground}`],
      ['outcome', '--domains=strategy-alignment', OUTCOME],
      () => work(['--dir=/nonexistent-elsewhere', '--allow-distant-ground=true'], countingHost(counter)),
      () => ((actions = logActions()), 0),
    ],
    counter,
  );
  assert.ok(dispatched > 0);
  assert.match(out, /--allow-distant-ground/);
  assert.ok(actions.includes('ground-unreachable-allowed'));
  assert.ok(!actions.includes('ground-unreachable'), 'an override is not also a refusal');
});
