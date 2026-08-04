/**
 * tests/cli/spine.test.ts — the spine through its real surface.
 *
 * These drive `main()` the way a user does, not the kernel functions
 * underneath, because the wiring is what has historically broken: a kernel that
 * works and a CLI that never reaches it looks identical to a passing unit suite.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, work } from '../../src/cli/index.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

/** A command, or `work` with a stand-in host, run inside the sterile data dir. */
type Step = string[] | ((/* inside the temp data dir */) => Promise<number>);

/**
 * Run a sequence of steps against one throwaway data dir, capturing both
 * streams. Steps share state only within a single call, so a multi-command
 * scenario runs them together.
 */
async function runAll(sequence: readonly Step[]): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-cli-'));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  try {
    return await capture(sequence);
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * The stream capture alone, against whatever data dir is already set. Separate
 * from `runAll` so a test can choose a hostile data dir — an unwritable one —
 * instead of the sterile one `runAll` builds.
 */
async function capture(sequence: readonly Step[]): Promise<Capture> {
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (chunk: string) => {
    out.push(String(chunk));
    return true;
  };
  (process.stderr as { write: unknown }).write = (chunk: string) => {
    err.push(String(chunk));
    return true;
  };
  let code = 0;
  try {
    for (const step of sequence) {
      code = typeof step === 'function' ? await step() : await main(step);
    }
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
  }
}

/** One step against a throwaway data dir. */
function run(step: Step): Promise<Capture> {
  return runAll([step]);
}

/**
 * A host that answers without a binary. `work` takes it as an override for the
 * same reason `cleanup` takes a spawn override: the wiring under test is the
 * CLI's, and a real host would only make it slower to check.
 */
function standInHost(cost: number | null = 0.01): HostAdapter {
  return {
    name: 'stand-in',
    kind: 'general',
    capabilities: [],
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (request: unknown): Promise<HostResult> => {
      const role = (request as { role: string }).role;
      return {
        id: role,
        status: 'ok',
        output: { text: `${role} reporting`, ...(cost === null ? {} : { usage: { cost } }) },
        error: null,
      };
    },
  };
}

test('construct outcome infers domains the user never named', async () => {
  const { code, out } = await run(['outcome', 'launch a paid beta to EU users next month']);
  assert.equal(code, 0);
  for (const domain of ['privacy', 'commerce-tax', 'program-sequencing', 'product-scoping']) {
    assert.match(out, new RegExp(domain));
  }
});

test('the inference shows its evidence and never overstates it', async () => {
  const { out } = await run(['outcome', 'launch a paid beta to EU users next month']);
  assert.match(out, /signals: /);
  assert.match(out, /next month/);
  assert.ok(!out.includes('next week'), 'a partial match must not be cited as a signal');
});

test('an outcome implicating nothing says so rather than going quiet', async () => {
  const { code, out } = await run(['outcome', 'xyzzy plugh frobnicate']);
  assert.equal(code, 0);
  assert.match(out, /no domains implicated/);
  assert.match(out, /recorded, not silently dropped/);
});

test('an outcome writes a work log the user can read back', async () => {
  const { out } = await runAll([['outcome', 'launch a paid beta to EU users next month'], ['log']]);
  assert.match(out, /outcome-received/);
  assert.match(out, /domain-implicated/);
  assert.match(out, /append-only/);
});

test('the inbox is empty rather than fabricated when nothing needs the user', async () => {
  const { code, out } = await run(['inbox']);
  assert.equal(code, 0);
  assert.match(out, /empty/);
});

test('deciding a decision that does not exist fails rather than pretending', async () => {
  const { code } = await run(['decide', 'nope', 'ship it']);
  assert.equal(code, 1);
});

test('outcome with no text is a usage error, not an empty run', async () => {
  assert.equal((await run(['outcome'])).code, 2);
  assert.equal((await run(['decide', 'only-an-id'])).code, 2);
});

test('help lists the spine commands', async () => {
  const { out } = await run(['help']);
  for (const command of ['outcome', 'work', 'log', 'inbox', 'decide']) {
    assert.match(out, new RegExp(command));
  }
});

test('an outcome queues work, and construct work runs it to a deliverable', async () => {
  const { code, out } = await runAll([
    ['outcome', 'launch a paid beta to EU users next month'],
    () => work([], standInHost()),
    ['log'],
  ]);

  assert.equal(code, 0);
  assert.match(out, /queued 4 task\(s\)/);
  assert.match(out, /worked 4 task\(s\) on stand-in: 4 done, 0 failed/);
  assert.match(out, /spend 0\.04 of 10\.00 ceiling/);
  assert.match(out, /role-dispatched/, 'the run must be readable back out of the work log');
  assert.match(out, /role-reported/);
});

test('work with nothing queued says so rather than reporting an empty success', async () => {
  const { code, out } = await run(() => work([], standInHost()));
  assert.equal(code, 0);
  assert.match(out, /nothing to work/);
  assert.match(out, /construct outcome/);
});

test('the spend ceiling stops the CLI and tells the user how to raise it', async () => {
  const { code, out } = await runAll([
    ['outcome', 'launch a paid beta to EU users next month'],
    () => work(['--ceiling=0.015', '--concurrency=1'], standInHost()),
  ]);

  assert.equal(code, 1, 'a halted run must not exit as though it finished');
  assert.match(out, /halted: spend ceiling reached/);
  assert.match(out, /task\(s\) left pending/);
  assert.match(out, /--ceiling=/);
});

test('a failed task shows why it failed, and the run does not exit clean', async () => {
  const failing: HostAdapter = {
    ...standInHost(),
    invoke: async (): Promise<HostResult> => ({
      id: 'x',
      status: 'error',
      output: null,
      error: { messages: ['Model not found: ollama/does-not-exist.'] },
    }),
  };
  const { code, out } = await runAll([
    ['outcome', 'launch a paid beta to EU users next month'],
    () => work([], failing),
  ]);
  assert.equal(code, 1);
  assert.match(out, /Model not found/);
  assert.ok(!out.includes('cost not reported'), 'a failure is not a cost report');
});

test('work reports what it did, not everything the store holds', async () => {
  const { out } = await runAll([
    ['outcome', 'hire two contractors in Germany'],
    () => work([], standInHost()),
    ['outcome', 'encrypt customer passwords'],
    () => work([], standInHost()),
  ]);
  // The second invocation worked one task; the first one's roles must not
  // reappear under it.
  const second = out.slice(out.lastIndexOf('worked '));
  assert.match(second, /worked 1 task\(s\)/);
  assert.match(second, /security/);
  assert.ok(!second.includes('employment'), 'an earlier run\'s work was reported as this one\'s');
});

test('work says which deliverables need a licensed human, and what is wrong with them', async () => {
  const emptyAnswer: HostAdapter = {
    ...standInHost(),
    invoke: async (request: unknown): Promise<HostResult> => ({
      id: 'x',
      status: 'ok',
      output: {
        text: (request as { role: string }).role === 'privacy' ? '' : 'a real answer',
        usage: { cost: 0.01, steps: 1 },
      },
      error: null,
    }),
  };

  const { out } = await runAll([
    ['outcome', 'launch a paid beta to EU users next month'],
    () => work([], emptyAnswer),
  ]);

  assert.match(out, /needs review by a licensed attorney/, 'privacy output must not read as advice');
  assert.match(out, /needs review by a licensed tax professional/, 'commerce-tax too');
  assert.match(out, /⚑ the run succeeded but produced no text/);

  // product-scoping needs no licensed review, and must not be labeled as if it
  // did. Read the notes attached to its own line, not the whole output.
  const lines = out.split('\n');
  const at = lines.findIndex((line) => /^ {2}[✓✗] product-scoping/.test(line));
  assert.ok(at >= 0, 'product-scoping should have been worked');
  const notes = lines.slice(at + 1).filter((line) => line.startsWith('      '));
  assert.deepEqual(notes, [], 'a domain needing no licensed review must not claim one');
});

test('roles that disagree put one framed decision in front of the user', async () => {
  // privacy holds, program-sequencing proceeds — the shape commitment 11 is about.
  const split: Record<string, string> = {
    privacy: 'STANCE: hold\nBECAUSE: no processing agreement is in place\nCITE: GDPR Art. 28',
    'program-sequencing': 'STANCE: proceed\nBECAUSE: the date has slack\nCITE: the launch plan',
  };
  const divided: HostAdapter = {
    ...standInHost(),
    invoke: async (request: unknown): Promise<HostResult> => {
      const role = (request as { role: string }).role;
      return {
        id: role,
        status: 'ok',
        output: { text: split[role] ?? 'STANCE: unclear', usage: { cost: 0, steps: 1 } },
        error: null,
      };
    },
  };

  const { out } = await runAll([
    ['outcome', 'launch a paid beta to EU users next month'],
    () => work([], divided),
    ['inbox'],
  ]);

  assert.match(out, /1 decision\(s\) need you/);
  assert.match(out, /decision inbox \(1\)/);
  assert.match(out, /privacy: hold — no processing agreement is in place \[GDPR Art. 28\]/);
  assert.match(out, /program-sequencing: proceed — the date has slack \[the launch plan\]/);
  assert.ok(!/recommend/i.test(out), 'the inbox must frame, never arbitrate');
});

test('a host that reports no cost is called out rather than counted as free', async () => {
  const { out } = await runAll([
    ['outcome', 'launch a paid beta to EU users next month'],
    () => work([], standInHost(null)),
  ]);
  assert.match(out, /reported no cost/);
  assert.match(out, /ceiling did not bind/);
});

test('a host that cannot start is an error, not a quiet no-op', async () => {
  const { code, err } = await runAll([
    ['outcome', 'launch a paid beta to EU users next month'],
    ['work', '--binary=/nonexistent/opencode'],
  ]);
  assert.equal(code, 1);
  assert.match(err, /not available/);
});

test('an unparseable work flag is a usage error', async () => {
  const { code, err } = await run(['work', '--concurrency=lots']);
  assert.equal(code, 2);
  assert.match(err, /Invalid --concurrency/);
});

/**
 * A data dir the process cannot write. These run the same commands a user runs
 * when their state dir is on a read-only mount or owned by someone else — the
 * first contact a real user has with this failure. chmod does not bind a
 * superuser, so as root they would pass without proving anything.
 */
const chmodBinds = typeof process.getuid === 'function' && process.getuid() !== 0;

async function underClosedDataDir(step: Step): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-closed-'));
  const closed = join(root, 'share');
  mkdirSync(closed);
  chmodSync(closed, 0o500);
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = closed;
  try {
    return await capture([step]);
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    chmodSync(closed, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
}

test('doctor calls a state dir it cannot write a problem, not healthy', { skip: !chmodBinds }, async () => {
  const { code, out } = await underClosedDataDir(['doctor']);
  assert.equal(code, 1, 'doctor must not exit 0 on a store it cannot open');
  assert.match(out, /FAIL store/);
  assert.match(out, /permission denied/);
  assert.match(out, /doctor: 1 check\(s\) failed/);
  assert.ok(!/doctor: healthy/.test(out), 'this is the exact claim the bug made');
});

test('doctor stays healthy — and creates nothing — when the store is merely absent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-fresh-'));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  try {
    const { code, out } = await capture([['doctor']]);
    assert.equal(code, 0);
    assert.match(out, /ok {3}store/);
    assert.match(out, /doctor: healthy/);
    // Asking whether it would work must not be the thing that makes it exist.
    assert.ok(!existsSync(join(root, 'share')), 'doctor must not create the data dir');
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

for (const command of [['outcome', 'ship a thing'], ['log'], ['inbox'], ['decide', 'd-1', 'yes']]) {
  test(`construct ${command[0]} diagnoses an unopenable store instead of crashing`, { skip: !chmodBinds }, async () => {
    const { code, out, err } = await underClosedDataDir(command);
    assert.equal(code, 1);
    assert.match(err, /^construct: cannot open the store at .* permission denied\n$/);
    assert.equal(err.split('\n').filter(Boolean).length, 1, 'one line, not a stack');
    assert.ok(!/ {4}at /.test(err + out), 'no stack frames');
    assert.ok(!/node:sqlite|EACCES/.test(err), 'no errno or module name to decode');
  });
}
