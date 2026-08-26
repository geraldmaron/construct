/**
 * tests/cli/work-dispatch-scope.test.ts — a bare `construct work` must never
 * be the thing that dispatches every queued task.
 *
 * Observed: with no --run typed, `work` fans out to every pending task in the
 * store. Typing `construct work` with nothing else — the way a reader tries a
 * command to see what it does — is a real spend triggered by curiosity. Every
 * other verb in the spine prints usage on a bare invocation instead of acting;
 * `work` is the one verb where "act instead of showing usage" costs money, so
 * it is exactly the one that must not do that by default.
 *
 * Also covers the settled-task print agreeing with itself: a failed task's row
 * carries a failure glyph and a failure word together, never a checkmark.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, work } from '../../src/cli/index.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';
import { openStore } from '../../src/kernel/store/open.ts';
import { sterileAmbientEnv, sterileHome } from '../harness/sterile.ts';

// A dispatch reads the machine's agent skills directory to find out what
// method it can offer a role, so home is moved for this file: what the suite
// observes must not depend on what is installed for whoever runs it.
sterileHome();
// These cases record an outcome through `main`, which reads process.env.
// Whoever runs the suite is often already inside a host; without a clear
// slate that path hands off instead of staffing, and the rest of the file
// has no run to work.
sterileAmbientEnv();

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

/** A host that counts invocations, so "no host call" is a fact rather than an assumption. */
function countingHost(status: 'ok' | 'error' = 'ok'): { host: HostAdapter; counter: { calls: number } } {
  const counter = { calls: 0 };
  const host: HostAdapter = {
    name: 'stand-in',
    kind: 'general',
    capabilities: [],
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (request: unknown): Promise<HostResult> => {
      counter.calls += 1;
      return status === 'ok'
        ? { id: (request as { role: string }).role, status: 'ok', output: { text: 'a deliverable' }, error: null }
        : { id: (request as { role: string }).role, status: 'error', output: null, error: { messages: ['boom'] } };
    },
  };
  return { host, counter };
}

async function run(
  steps: ReadonlyArray<string[] | (() => Promise<number> | number)>,
): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-work-scope-'));
  const previous = { data: process.env.XDG_DATA_HOME, cache: process.env.XDG_CACHE_HOME };
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_CACHE_HOME = join(root, 'cache');
  mkdirSync(process.env.XDG_DATA_HOME, { recursive: true });

  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  (process.stderr as { write: unknown }).write = (c: string) => (err.push(String(c)), true);
  let code = 0;
  try {
    for (const step of steps) {
      code = typeof step === 'function' ? await step() : await main(step);
    }
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

const OUTCOME = 'launch a paid beta to EU users next month';

test('a bare construct work with real work queued prints usage and dispatches nothing', async () => {
  const { host, counter } = countingHost();
  let worked = -1;
  const { out, err } = await run([
    ['outcome', OUTCOME],
    async () => ((worked = await work([], host)), worked),
  ]);
  assert.equal(worked, 2, 'a fleet dispatch with no opt-in is a usage error, not an action');
  assert.equal(counter.calls, 0, 'nothing was dispatched, so nothing was spent');
  assert.doesNotMatch(out, /worked \d+ task/, 'no dispatch summary — nothing ran');
  assert.match(err, /usage: construct work/);
  assert.match(err, /--all/, 'the opt-in this refusal requires is named');
});

test('--run alone is enough — no --all needed to work a named run', async () => {
  const { host, counter } = countingHost();
  const { out } = await run([
    ['outcome', OUTCOME],
    async () => {
      const store = openStore(join(process.env.XDG_DATA_HOME as string, 'construct', 'construct.db'));
      let runId: string;
      try {
        runId = (store.db.prepare('SELECT run FROM tasks LIMIT 1').get() as { run: string }).run;
      } finally {
        store.close();
      }
      return work([`--run=${runId}`], host);
    },
  ]);
  assert.ok(counter.calls > 0, 'a named run dispatches its own tasks without --all');
  assert.match(out, /worked \d+ task/);
});

test('--all dispatches every pending task with no run named', async () => {
  const { host, counter } = countingHost();
  const { out, err } = await run([
    ['outcome', OUTCOME],
    () => work(['--all'], host),
  ]);
  assert.ok(counter.calls > 0);
  assert.match(out, /worked \d+ task/);
  assert.doesNotMatch(err, /usage: construct work/);
});

test('a bare work against a store with nothing recorded at all is unchanged: it still points at outcome, not at a usage line', async () => {
  const { code, out, err } = await run([['work']]);
  assert.equal(code, 0);
  assert.match(out, /Record an outcome first/);
  assert.equal(err, '', 'nothing to dispatch is not a usage error');
});

test('a failed task in the settled print always carries the failure glyph and the failure word together', async () => {
  const { host } = countingHost('error');
  const { out } = await run([
    ['outcome', OUTCOME],
    () => work(['--all'], host),
  ]);
  const lines = out.split('\n').filter((l) => l.includes('boom'));
  assert.ok(lines.length > 0, 'the failed rows are present');
  for (const line of lines) {
    assert.match(line, /^\s*✗/, 'a row naming the failure is glyphed as a failure, never a checkmark');
    assert.doesNotMatch(line, /✓/, 'the same row never also carries the success glyph');
  }
  assert.doesNotMatch(out, /✓\s+\S+\s+boom/, 'a failure reason never rides on a checkmarked row');
});
