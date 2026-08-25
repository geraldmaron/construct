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
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { standing } from '../../src/cli/index.ts';
import { fileDueStanding } from '../../src/cli/standing.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';
import { openStore } from '../../src/kernel/store/open.ts';
import { declareStanding, firingsFor, listStanding } from '../../src/kernel/store/standing.ts';
import { sterile } from '../harness/sterile.ts';
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

const RACE_STANDING = {
  id: 'standing-race',
  workspace: 'default',
  outcome: 'watch the week for what no longer agrees',
  domains: ['privacy'],
  everyMinutes: 60,
  declaredAt: '2026-08-03T00:00:00.000Z',
};

test('a firer with its own sink writes nothing to stdout', () => {
  const fixture = sterile();
  try {
    const store = openStore(join(fixture.root, 'data', 'construct.db'));
    try {
      declareStanding(store, { ...RACE_STANDING, id: 'standing-sink', everyMinutes: 1 });

      // The resident sweeper's stdout is a shared logfile whose every other
      // line is timestamped. A filing that writes there directly lands
      // unstamped in among them.
      const captured: string[] = [];
      const realOut = process.stdout.write.bind(process.stdout);
      let leaked = 0;
      (process.stdout as { write: unknown }).write = (): boolean => {
        leaked += 1;
        return true;
      };
      let filed: readonly { readonly run: string }[];
      try {
        filed = fileDueStanding(store, () => '2026-08-03T01:00:00.000Z', (text) => {
          captured.push(text);
        }).filed;
      } finally {
        (process.stdout as { write: unknown }).write = realOut;
      }

      assert.strictEqual(filed.length, 1, 'the intention was filed');
      assert.strictEqual(leaked, 0, 'and said nothing to stdout');
      assert.ok(captured.join('').includes('plan '), `the sink got it instead: ${captured.join('')}`);
    } finally {
      store.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test('two firers racing one due intention file it exactly once', async () => {
  // A calendar entry firing while a daemon sweeps is the ordinary case, and
  // separately each would read the same intention as due and file it. Two
  // processes, released at one wall-clock moment against one store file.
  const fixture = sterile();
  try {
    const dbPath = join(fixture.root, 'data', 'construct.db');
    const seeded = openStore(dbPath);
    declareStanding(seeded, RACE_STANDING);
    seeded.close();

    const src = fileURLToPath(new URL('../../src/', import.meta.url));
    const releaseAt = Date.now() + 3000;
    const script =
      `const { openStore } = await import(${JSON.stringify(`${src}kernel/store/open.ts`)});\n` +
      `const { fileDueStanding } = await import(${JSON.stringify(`${src}cli/standing.ts`)});\n` +
      `const store = openStore(${JSON.stringify(dbPath)});\n` +
      `while (Date.now() < ${String(releaseAt)}) {}\n` +
      `const { filed } = fileDueStanding(store, () => '2026-08-03T02:00:00.000Z', () => {});\n` +
      `process.stdout.write('filed=' + String(filed.length));\n`;

    const firers = await Promise.all(
      [0, 1].map(
        async (index) =>
          new Promise<string>((resolve) => {
            // Opening the store is its own write, and two opens landing
            // together contend over that instead of over the firing. Staggered
            // so what collides is the moment the barrier releases.
            setTimeout(() => {
            const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
              env: { ...process.env, XDG_DATA_HOME: join(fixture.root, 'share') },
            });
            let out = '';
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', (chunk: string) => {
              out += chunk;
            });
            let err = '';
            child.stderr.setEncoding('utf8');
            child.stderr.on('data', (chunk: string) => {
              err += chunk;
            });
            child.on('close', () => {
              resolve(out === '' ? err : out);
            });
            }, index * 500);
          }),
      ),
    );

    const reopened = openStore(dbPath);
    try {
      assert.strictEqual(
        firingsFor(reopened, RACE_STANDING.id).length,
        1,
        `one firing on the record, not two: ${firers.join(' | ')}`,
      );
    } finally {
      reopened.close();
    }
    assert.deepStrictEqual(
      firers.map((line) => line.trim()).sort(),
      ['filed=0', 'filed=1'],
      'and only one firer believed it had filed anything',
    );
  } finally {
    fixture.cleanup();
  }
});

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

test('a firing killed mid-flight is resumed by the next --due, cadence spent or not', async () => {
  const { code, out } = await runAll([
    () => standing(['add', '--every=1h', '--domains=privacy', 'sweep the week for drift']),
    () => standing(['--due'], standInHost()),
    async () => {
      // A kill mid-work dies inside the host invoke: the task is unsettled
      // and nothing post-invoke (decisions, results) was written yet. The
      // firing is already recorded, so the cadence reads as spent.
      inStore((store) => {
        store.db.prepare("UPDATE tasks SET state = 'pending', result = NULL, settled_at = NULL").run();
        store.db.prepare('DELETE FROM decisions').run();
      });
      return 0;
    },
    () => standing(['--due'], standInHost()),
    async () => {
      inStore((store) => {
        const declared = listStanding(store);
        assert.equal(firingsFor(store, declared[0].id).length, 1, 'resuming is not a new firing');
        const tasks = listTasks(store);
        assert.ok(tasks.every((t) => t.state === 'done'), 'the killed run was worked to done');
      });
      return 0;
    },
  ]);
  assert.equal(code, 0);
  assert.match(out, /resuming run-.* unfinished from an earlier firing/);
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
