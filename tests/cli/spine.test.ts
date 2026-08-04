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
import { main, outcome, work } from '../../src/cli/index.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';
import { openStore } from '../../src/kernel/store/open.ts';
import { claimTask, completeTask, listTasks } from '../../src/kernel/store/tasks.ts';
import { openDecisions } from '../../src/kernel/store/decisions.ts';

/** Fixed points for the staged-crash test below; the CLI's own clock is real. */
const SETTLED_AT = '2026-08-03T00:00:00.000Z';
const LEASE_END = '2026-08-03T01:00:00.000Z';

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

/**
 * A host that answers a namer prompt, counting how many times it was asked.
 * The count is the point of most of these tests: escalation is the one thing
 * in the spine that costs money, so "was the model called, and how often" is
 * the property under test, not a detail of it.
 */
function namingHost(reply: string): HostAdapter & { readonly calls: () => number } {
  let calls = 0;
  return {
    name: 'stand-in-namer',
    kind: 'general',
    capabilities: [],
    calls: () => calls,
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (): Promise<HostResult> => {
      calls += 1;
      return { id: 'namer', status: 'ok', output: { text: reply }, error: null };
    },
  };
}

const SILENT = 'xyzzy plugh frobnicate';
const NAMED = JSON.stringify({
  domains: [{ domain: 'accessibility', why: 'the outcome describes assistive software' }],
});

test('escalating an outcome the keyword map is silent on queues work', async () => {
  const host = namingHost(NAMED);
  const { code, out } = await run(() => outcome(['--escalate', SILENT], host));
  assert.equal(code, 0);
  assert.equal(host.calls(), 1, 'a silent outcome must reach the namer exactly once');
  assert.match(out, /accessibility/);
  assert.match(out, /queued 1 task/);
  assert.match(out, /came from a model, not from keywords/);
});

test('an escalated implication is distinguishable in the log from a keyword one', async () => {
  const host = namingHost(NAMED);
  const { out } = await runAll([() => outcome(['--escalate', SILENT], host), ['log']]);
  assert.match(out, /implication-escalated/);
  assert.match(out, /domain-implicated {2}\(inferred by: escalation — a model was consulted\)/);
});

test('a keyword-derived log entry does not claim a model was consulted', async () => {
  const { out } = await runAll([
    ['outcome', 'launch a paid beta to EU users next month'],
    ['log'],
  ]);
  assert.match(out, /domain-implicated/);
  assert.ok(!out.includes('inferred by:'), 'the free path must not advertise a cost it never paid');
  assert.ok(!out.includes('implication-escalated'));
});

test('a keyword-answered outcome never reaches the namer, even with --escalate', async () => {
  const host = namingHost(NAMED);
  const { out } = await run(() =>
    outcome(['--escalate', 'launch a paid beta to EU users next month'], host),
  );
  assert.equal(host.calls(), 0, 'the deterministic path must do no I/O and cost nothing');
  assert.match(out, /"?signals: /);
});

test('the same outcome does not pay for the same model call twice', async () => {
  const host = namingHost(NAMED);
  const { out } = await runAll([
    () => outcome(['--escalate', SILENT], host),
    () => outcome(['--escalate', SILENT], host),
  ]);
  assert.equal(host.calls(), 1, 'the second escalation must be served from the store cache');
  assert.match(out, /consulted for this outcome earlier/);
});

test('filing an outcome cannot cost money unless the user asks it to', async () => {
  const host = namingHost(NAMED);
  const { code, out } = await run(() => outcome([SILENT], host));
  assert.equal(code, 0);
  assert.equal(host.calls(), 0, 'the default path must never consult a model');
  assert.match(out, /no domains implicated/);
  // The dead end is a signposted choice, not a wall: the r67.9 stall is fixed
  // by telling the user the command, not by spending their money for them.
  assert.match(out, /--escalate/);
  assert.match(out, /at cost/);
});

test('a host flag with nothing to apply to is a usage error, not a silent no-op', async () => {
  const { code, err } = await run(['outcome', '--host=claude', SILENT]);
  assert.equal(code, 2);
  assert.match(err, /only applies when escalating/);
});

test('a namer that names nothing is reported, not papered over', async () => {
  const host = namingHost(JSON.stringify({ domains: [] }));
  const { code, out } = await run(() => outcome(['--escalate', SILENT], host));
  assert.equal(code, 0);
  assert.equal(host.calls(), 1);
  assert.match(out, /named nothing/);
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

test('a decision lost to a dead process is reachable through the normal surface', async () => {
  // construct-xgi, end to end at the surface that failed. The tasks settle, the
  // invocation that settled them never frames, and the user's next move is the
  // ordinary one: run `construct work` again, then look in the inbox.
  const split: Record<string, string> = {
    privacy: 'STANCE: hold\nBECAUSE: no processing agreement is in place\nCITE: GDPR Art. 28',
    'program-sequencing': 'STANCE: proceed\nBECAUSE: the date has slack\nCITE: the launch plan',
  };

  const root = mkdtempSync(join(tmpdir(), 'construct-cli-'));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  try {
    const first = await capture([['outcome', 'launch a paid beta to EU users next month']]);
    assert.equal(first.code, 0);

    // The death, staged in the store rather than mimed: every task is settled
    // durably through the ordinary claim/complete path, and nothing frames. This
    // is the exact state observed on run-20260804173017057.
    const store = openStore(join(process.env.XDG_DATA_HOME, 'construct', 'construct.db'));
    let run = '';
    try {
      run = listTasks(store)[0]?.run ?? '';
      assert.ok(run, 'the outcome should have queued tasks');
      for (;;) {
        const leased = claimTask(store, { owner: 'died', leaseUntil: LEASE_END, now: SETTLED_AT });
        if (!leased) break;
        completeTask(store, {
          id: leased.id,
          owner: 'died',
          token: leased.token,
          result: { text: split[leased.role] ?? 'STANCE: unclear', usage: { cost: 0.01, steps: 1 } },
          spend: 0.01,
          spendReported: true,
          at: SETTLED_AT,
        });
      }
      assert.equal(openDecisions(store).length, 0, 'the decision is unraised at this point');
    } finally {
      store.close();
    }

    // Before the fix this printed the settled line and returned 0, and no later
    // command could ever reach the framing.
    const recovered = await capture([['work', `--run=${run}`], ['inbox']]);

    assert.match(recovered.out, /Its tasks are already settled/);
    assert.match(recovered.out, /1 decision\(s\) need you/);
    assert.match(recovered.out, /decision inbox \(1\)/);
    assert.match(recovered.out, /privacy: hold — no processing agreement is in place/);
    assert.match(recovered.out, /program-sequencing: proceed — the date has slack/);

    // Re-entering must not raise it twice or rewrite what the user is reading.
    const again = await capture([['work', `--run=${run}`], ['inbox']]);
    assert.match(again.out, /decision inbox \(1\)/);
    assert.doesNotMatch(again.out, /1 decision\(s\) need you/);
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('a run where everything failed is not reported as a run that finished', async () => {
  // construct-d2q, from the dogfood: 'construct work --model=ollama/qwen3.5:4b'
  // was dispatched with a model the host could not resolve, every task failed at
  // once, and the next invocation said "Its tasks are already settled." — an
  // accurate sentence that leaves the user with a dead run id and no next step.
  const refusing: HostAdapter = {
    ...standInHost(),
    invoke: async (request: unknown): Promise<HostResult> => ({
      id: (request as { role: string }).role,
      status: 'error',
      output: null,
      error: { messages: ['model ollama/qwen3.5:4b is not resolvable'] },
    }),
  };

  const { out, code } = await runAll([
    ['outcome', 'launch a paid beta to EU users next month'],
    () => work([], refusing),
    // The second invocation is the one the bead is about: the user comes back
    // to a run whose tasks are all settled, all failed.
    ['work'],
  ]);

  assert.doesNotMatch(out, /Its tasks are already settled/, 'a total failure is not a completion');
  assert.match(out, /All \d+ task\(s\) failed and produced no deliverable/);
  assert.match(out, /model ollama\/qwen3\.5:4b is not resolvable/, 'the recorded error is the recourse');
  assert.match(out, /host owns retries, so re-running work will not pick these up/);
  assert.match(out, /construct outcome "<what you want>"/, 'the user is told what to do next');
  assert.equal(code, 1, 'a run that delivered nothing must not exit clean');
});

test('a store with no outcome at all still says to record one', async () => {
  // The empty-store message must not be swallowed by the all-failed branch.
  const { out, code } = await run(['work']);
  assert.match(out, /Record an outcome first/);
  assert.equal(code, 0);
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
