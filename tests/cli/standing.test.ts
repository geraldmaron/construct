/**
 * tests/cli/standing.test.ts — standing outcomes through the real CLI surface.
 *
 * The claims held here are the recipe doc's own: declaring runs nothing,
 * `--due` files and works exactly what has elapsed — each firing an ordinary
 * run with a plan and settled tasks on the record — an immediate second
 * `--due` fires nothing, and a retired intention stays retired. No resident
 * process exists to test, which is itself the point.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { standing } from '../../src/cli/index.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';
import { openStore } from '../../src/kernel/store/open.ts';
import { firingsFor, listStanding } from '../../src/kernel/store/standing.ts';
import { planFor } from '../../src/kernel/store/plans.ts';
import { listTasks } from '../../src/kernel/store/tasks.ts';

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

type Step = () => Promise<number>;

async function runAll(sequence: readonly Step[]): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-standing-'));
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
    for (const step of sequence) code = await step();
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

function standInHost(): HostAdapter {
  return {
    name: 'stand-in',
    kind: 'general',
    capabilities: [],
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (request: unknown): Promise<HostResult> => ({
      id: (request as { role: string }).role,
      status: 'ok',
      output: { text: `${(request as { role: string }).role} reporting`, usage: { cost: 0.01 } },
      error: null,
    }),
  };
}

function inStore<T>(fn: (store: ReturnType<typeof openStore>) => T): T {
  const store = openStore(join(process.env.XDG_DATA_HOME as string, 'construct', 'construct.db'));
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

test('declaring a standing outcome stores the intention and runs nothing', async () => {
  const { code, out } = await runAll([
    () => standing(['add', '--every=1h', '--domains=privacy', 'sweep the week for drift']),
    async () => {
      inStore((store) => {
        const declared = listStanding(store);
        assert.equal(declared.length, 1);
        assert.deepEqual(declared[0].domains, ['privacy']);
        assert.equal(declared[0].everyMinutes, 60);
        assert.equal(firingsFor(store, declared[0].id).length, 0, 'declaring fires nothing');
        assert.equal(listTasks(store).length, 0, 'no run was filed');
      });
      return 0;
    },
    () => standing(['list']),
  ]);
  assert.equal(code, 0);
  assert.match(out, /declared standing-/);
  assert.match(out, /nothing runs until/);
  assert.match(out, /every 1h/);
  assert.match(out, /never fired/);
});

test('a staff typo is refused at declaration, not discovered by cron at 3 a.m.', async () => {
  const { code, err } = await runAll([
    () => standing(['add', '--every=1h', '--domains=privvacy', 'sweep the week']),
  ]);
  assert.equal(code, 2);
  assert.match(err, /no catalog domain named "privvacy"/);
});

test('--due files and works exactly what elapsed, each firing an ordinary run on the record', async () => {
  const { code, out } = await runAll([
    () => standing(['add', '--every=1h', '--domains=privacy', 'sweep the week for drift']),
    () => standing(['--due'], standInHost()),
    async () => {
      inStore((store) => {
        const declared = listStanding(store);
        const firings = firingsFor(store, declared[0].id);
        assert.equal(firings.length, 1, 'one cadence elapsed, one run filed');
        // An ordinary run: a plan recorded at filing, tasks queued and settled.
        assert.ok(planFor(store, firings[0].run), 'the firing planned like a typed outcome');
        const tasks = listTasks(store, firings[0].run);
        assert.ok(tasks.length > 0, 'the firing queued work');
        assert.ok(tasks.every((t) => t.state === 'done'), '--due worked what it filed');
      });
      return 0;
    },
    // The immediate second --due: the cadence has not elapsed again.
    () => standing(['--due'], standInHost()),
    async () => {
      inStore((store) => {
        const declared = listStanding(store);
        assert.equal(firingsFor(store, declared[0].id).length, 1, 'nothing was re-filed');
      });
      return 0;
    },
  ]);
  assert.equal(code, 0);
  assert.match(out, /came due \(every 1h\)/);
  assert.match(out, /working run-/);
  assert.match(out, /nothing is due\./);
});

test('a retired standing outcome never comes due again', async () => {
  const { code, out } = await runAll([
    () => standing(['add', '--every=1m', '--domains=privacy', 'sweep the week']),
    async () => {
      const id = inStore((store) => listStanding(store)[0].id);
      return standing(['retire', id]);
    },
    () => standing(['--due'], standInHost()),
  ]);
  assert.equal(code, 0);
  assert.match(out, /retired standing-/);
  assert.match(out, /its firings stay on the record/);
  assert.match(out, /nothing is due\./);
});
