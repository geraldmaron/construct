/**
 * tests/cli/spine.test.ts — the spine through its real surface.
 *
 * These drive `main()` the way a user does, not the kernel functions
 * underneath, because the wiring is what has historically broken: a kernel that
 * works and a CLI that never reaches it looks identical to a passing unit suite.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, outcome, parseWorkArgs, work } from '../../src/cli/index.ts';
import { createOpenCodeAdapter } from '../../src/hosts/opencode/adapter.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';
import { openStore } from '../../src/kernel/store/open.ts';
import { readRunDispatch } from '../../src/kernel/store/dispatch.ts';
import { claimTask, completeTask, getTask, listTasks } from '../../src/kernel/store/tasks.ts';
import { openDecisions } from '../../src/kernel/store/decisions.ts';
import { catalogHighWater } from '../../src/kernel/store/catalog.ts';
import { DOMAINS } from '../../src/kernel/implication/domains.ts';
import { planFor } from '../../src/kernel/store/plans.ts';
import { readWorkLog } from '../../src/kernel/store/worklog.ts';
import { sterileHome } from '../harness/sterile.ts';


// A dispatch reads the machine's agent skills directory to find out what
// method it can offer a role, so home is moved for this file: what the suite
// observes must not depend on what is installed for whoever runs it.
sterileHome();

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
 * The count is the point of most of these tests: a model consultation is the
 * one thing in this path that costs money, so "was the model called, and how
 * often" is the property under test, not a detail of it.
 */
/**
 * The fake answers by role: the densifier's question gets a densifier-shaped
 * reply (or a failure when none is supplied, which exercises the stated
 * fallback), the namer's gets `reply`. `calls()` counts NAMER consultations
 * only — the cache and cost assertions below are about paying for naming, and
 * counting the intake call would make them assert two different things at once.
 */
function namingHost(
  reply: string,
  densifiedReply?: string,
): HostAdapter & { readonly calls: () => number; readonly densifyCalls: () => number } {
  let calls = 0;
  let densifyCalls = 0;
  return {
    name: 'stand-in-namer',
    kind: 'general',
    capabilities: [],
    calls: () => calls,
    densifyCalls: () => densifyCalls,
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (request: unknown): Promise<HostResult> => {
      if ((request as { role?: string }).role === 'intake-densifier') {
        densifyCalls += 1;
        if (densifiedReply === undefined) {
          return { id: 'densifier', status: 'error', output: null, error: 'no densifier configured' };
        }
        return { id: 'densifier', status: 'ok', output: { text: densifiedReply }, error: null };
      }
      calls += 1;
      return { id: 'namer', status: 'ok', output: { text: reply }, error: null };
    },
  };
}

/** A host whose invoke fails outright, so the namer throws. */
function brokenHost(): HostAdapter {
  return {
    name: 'stand-in-namer',
    kind: 'general',
    capabilities: [],
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (): Promise<HostResult> => {
      throw new Error('host unreachable');
    },
  };
}

const SILENT = 'xyzzy plugh frobnicate';
const ANSWERED = 'launch a paid beta to EU users next month';
const NAMED = JSON.stringify({
  domains: [{ domain: 'accessibility', why: 'the outcome describes assistive software' }],
});

test('with a host named, an outcome the keyword map is silent on still queues work', async () => {
  const host = namingHost(NAMED);
  const { code, out } = await run(() => outcome(['--host=opencode', SILENT], host));
  assert.equal(code, 0);
  assert.equal(host.calls(), 1, 'the outcome must reach the namer exactly once');
  assert.match(out, /accessibility/);
  assert.match(out, /queued 1 task/);
  assert.match(out, /came from a model reading the outcome/);
});

test('the run remembers the host and model it was filed with, and only what was typed', async () => {
  // Found on a wire capture: with nothing recorded, a later `work` fell
  // through to whatever model the host last used — an image model, for legal
  // work. The record at filing time is what makes that fall-through impossible.
  const host = namingHost(NAMED);
  await runAll([
    () => outcome(['--host=opencode', '--model=openrouter/qwen/qwen3-30b-a3b-instruct-2507', SILENT], host),
    async () => {
      const store = openStore(
        join(process.env.XDG_DATA_HOME as string, 'construct', 'construct.db'),
      );
      try {
        const runs = store.db.prepare('SELECT run FROM run_dispatch').all() as { run: string }[];
        assert.equal(runs.length, 1, 'a host-named outcome records its dispatch surface');
        const recorded = readRunDispatch(store, runs[0].run);
        assert.equal(recorded?.host, 'opencode');
        assert.equal(recorded?.model, 'openrouter/qwen/qwen3-30b-a3b-instruct-2507');
        assert.equal(recorded?.binary, null, 'what was not typed is not invented');
      } finally {
        store.close();
      }
      return 0;
    },
  ]);
});

test('an outcome with no host named records no dispatch surface', async () => {
  await runAll([
    ['outcome', ANSWERED],
    async () => {
      const store = openStore(
        join(process.env.XDG_DATA_HOME as string, 'construct', 'construct.db'),
      );
      try {
        const runs = store.db.prepare('SELECT run FROM run_dispatch').all();
        assert.equal(runs.length, 0, 'the free path names no host, so there is nothing to record');
      } finally {
        store.close();
      }
      return 0;
    },
  ]);
});

test('parseWorkArgs distinguishes a typed --host from the default', async () => {
  const { parseWorkArgs } = await import('../../src/cli/index.ts');
  assert.equal(parseWorkArgs([]).hostExplicit, false, 'the default must be overridable by the record');
  assert.equal(parseWorkArgs(['--host=opencode']).hostExplicit, true, 'a typed choice must win');
});

test('work reads a run id in either flag form, as every verb that takes one does', () => {
  assert.equal(parseWorkArgs(['--run=run-1']).run, 'run-1');
  assert.equal(parseWorkArgs(['--run', 'run-1']).run, 'run-1', 'the spaced form log and verdict accept');
  // Unscoped is a real state, not a missing one: work with no run named works
  // whatever is pending. A parser that read a bare `--run` as the id would
  // scope the dispatch to a task that does not exist.
  assert.equal(parseWorkArgs([]).run, undefined);
  assert.equal(parseWorkArgs(['--run']).run, undefined);
});

const DENSIFIED = JSON.stringify({
  outcome: 'Ensure the organization has the standard contracts it is missing',
  constraints: ['include the ones that are often ignored'],
  decisions: [],
  parked: [],
});

test('a rough framing is optimized at intake, shown, recorded, and fed to the namer', async () => {
  // The framing is a verbatim corpus entry, not text written to be parseable.
  const host = namingHost(NAMED, DENSIFIED);
  const { out } = await runAll([
    () =>
      outcome(
        [
          '--host=opencode',
          'I need you to ensure the contracts that should exist within an organization that are often ignored are covered',
        ],
        host,
      ),
    ['log'],
  ]);
  assert.equal(host.densifyCalls(), 1, 'a named host optimizes intake without being asked');
  assert.match(out, /as understood \(your words are the record/);
  assert.match(out, /outcome: Ensure the organization has the standard contracts/);
  assert.match(out, /constraint: include the ones that are often ignored/);
  assert.match(out, /intake-densified/, 'the densified form is on the work log');
});

test('a densifier failure is a stated fallback to the raw text, not a guess', async () => {
  const host = namingHost(NAMED);
  const { code, out } = await run(() => outcome(['--host=opencode', SILENT], host));
  assert.equal(code, 0);
  assert.match(out, /could not be optimized at intake/);
  assert.match(out, /accessibility/, 'the namer still reads the raw text');
});

test('a named implication is distinguishable in the log from a keyword one', async () => {
  const host = namingHost(NAMED);
  const { out } = await runAll([() => outcome(['--host=opencode', SILENT], host), ['log']]);
  assert.match(out, /implication-named/);
  assert.match(out, /domain-implicated {2}\(inferred by: namer — a model read the outcome\)/);
});

test('a keyword-derived log entry does not claim a model was consulted', async () => {
  const { out } = await runAll([['outcome', ANSWERED], ['log']]);
  assert.match(out, /domain-implicated/);
  assert.ok(!out.includes('inferred by:'), 'the free path must not advertise a cost it never paid');
  assert.ok(!out.includes('implication-named'));
});

test('with a host named, the namer reads even an outcome keywords would answer', async () => {
  const host = namingHost(NAMED);
  const { out } = await run(() => outcome(['--host=opencode', ANSWERED], host));
  assert.equal(host.calls(), 1, 'the namer is primary, not a fallback for keyword silence');
  assert.match(out, /accessibility/);
  assert.match(out, /reason: /);
  assert.ok(!out.includes('signals: '), 'the namer answered; a keyword answer must not be merged in');
});

test('the same outcome does not pay for the same model call twice', async () => {
  const host = namingHost(NAMED);
  const { out } = await runAll([
    () => outcome(['--host=opencode', SILENT], host),
    () => outcome(['--host=opencode', SILENT], host),
  ]);
  assert.equal(host.calls(), 1, 'the second consultation must be served from the store cache');
  assert.match(out, /consulted for this outcome earlier/);
});

test('filing an outcome cannot cost money unless the user asks it to', async () => {
  const host = namingHost(NAMED);
  const { code, out } = await run(() => outcome([SILENT], host));
  assert.equal(code, 0);
  assert.equal(host.calls(), 0, 'the default path must never consult a model');
  assert.match(out, /no domains implicated/);
  // The dead end is a signposted choice, not a wall: the user is told the
  // command rather than having their money spent for them.
  assert.match(out, /--host=/);
  assert.match(out, /at cost/);
});

test('a model flag with no host to apply to is a usage error, not a silent no-op', async () => {
  const { code, err } = await run(['outcome', '--model=sonnet', SILENT]);
  assert.equal(code, 2);
  assert.match(err, /only applies when a host is named/);
});

test('the removed --escalate flag fails loudly with the replacement, never silently', async () => {
  const { code, err } = await run(['outcome', '--escalate', SILENT]);
  assert.equal(code, 2);
  assert.match(err, /--escalate was removed/);
  assert.match(err, /--host=/);
});

test('a namer that names nothing is reported as its answer, not papered over', async () => {
  const host = namingHost(JSON.stringify({ domains: [] }));
  const { code, out } = await run(() => outcome(['--host=opencode', SILENT], host));
  assert.equal(code, 0);
  assert.equal(host.calls(), 1);
  assert.match(out, /considered the catalog and named nothing/);
});

test('a namer that fails falls back to keywords, and the substitution is stated everywhere', async () => {
  const { code, out } = await runAll([
    () => outcome(['--host=opencode', ANSWERED], brokenHost()),
    ['log'],
  ]);
  assert.equal(code, 0, 'a broken host must not take routing with it');
  assert.match(out, /signals: /, 'the keyword fallback answers');
  assert.match(out, /could not be consulted/);
  assert.match(out, /keyword map answered instead/);
  assert.match(out, /namer-failed/, 'the degradation is in the log, not only on screen');
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
  for (const command of ['outcome', 'work', 'log', 'inbox', 'decide', 'lessons']) {
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
  // What this invocation spent, against what it was allowed. The lifetime
  // total is a separate fact and says so, so a store with history no longer
  // reads as a run that started nearly out of budget.
  assert.match(out, /reported cost 0\.04 of 10\.00 allowed for this run/);
  assert.match(out, /recorded across every run in this store/);
  assert.match(out, /role-dispatched/, 'the run must be readable back out of the work log');
  assert.match(out, /role-reported/);
});

test('construct show renders the deliverable a run produced, with its qualifiers', async () => {
  // The gap this closes: work said "done", log said action names, and the
  // text the user paid for was readable only with sqlite by hand.
  const { code, out } = await runAll([
    ['outcome', 'We want to hire a contractor in Poland'],
    () => work([], standInHost()),
    async () => {
      const store = openStore(
        join(process.env.XDG_DATA_HOME as string, 'construct', 'construct.db'),
      );
      let runId = '';
      try {
        const row = store.db.prepare('SELECT run FROM tasks LIMIT 1').get() as { run: string };
        runId = row.run;
      } finally {
        store.close();
      }
      const { show } = await import('../../src/cli/index.ts');
      return show(['--run', runId]);
    },
  ]);

  assert.equal(code, 0);
  assert.match(out, /Construct · .*framed through employment — done/);
  assert.match(out, /employment reporting/, 'the deliverable body is readable');
  assert.match(out, /needs review by a licensed attorney/, 'the qualifier travels with the text');
  assert.match(out, /asks for .*finding/, 'empty required slots are disclosed, not silent');
});

/**
 * The one surface a person reads a deliverable on was also the one place the
 * record form reached them. The markers stay in the store, where the gates
 * read them; what a reader gets is the sentence they stand for, and --record
 * is still one flag away for anything checking the text.
 */
test('construct show hands the reader the publish view, and --record still gives the record', async () => {
  const marked = (): HostAdapter => ({
    ...standInHost(),
    invoke: async (request: unknown): Promise<HostResult> => ({
      id: (request as { role: string }).role,
      status: 'ok',
      output: {
        text: '## finding\n1. Rotate the export key [unowned].\n   - issued in March [unverified].',
        usage: { cost: 0.01 },
      },
      error: null,
    }),
  });
  const runId = async (): Promise<string> => {
    const store = openStore(join(process.env.XDG_DATA_HOME as string, 'construct', 'construct.db'));
    try {
      return (store.db.prepare('SELECT run FROM tasks LIMIT 1').get() as { run: string }).run;
    } finally {
      store.close();
    }
  };

  // Only what `show` printed: the work summary above it is a run report, and
  // this is a claim about the surface a person reads the deliverable on.
  const shown = (text: string) => text.slice(text.lastIndexOf('security — done'));

  const { out } = await runAll([
    ['outcome', '--domains=security', 'store customer passwords properly'],
    () => work([], marked()),
    async () => {
      const { show } = await import('../../src/cli/index.ts');
      return show(['--run', await runId()]);
    },
  ]);
  assert.doesNotMatch(shown(out), /\[unowned\]/, 'the reader gets the sentence, not the marker');
  assert.doesNotMatch(shown(out), /\[unverified\]/);
  assert.match(shown(out), /nobody is named for this yet/);
  assert.match(shown(out), /still needs checking against a source/);
  assert.match(shown(out), /^ {5}- issued in March/m, 'the deliverable keeps the shape it was written in');

  const record = await runAll([
    ['outcome', '--domains=security', 'store customer passwords properly'],
    () => work([], marked()),
    async () => {
      const { show } = await import('../../src/cli/index.ts');
      return show(['--run', await runId(), '--record']);
    },
  ]);
  assert.match(shown(record.out), /\[unowned\]/, 'the record form is what the gates read, and it is still reachable');
  assert.match(shown(record.out), /\[unverified\]/);
});

test('construct show without a run id is a usage error, not a dump', async () => {
  const { show } = await import('../../src/cli/index.ts');
  const { code, err } = await run(() => Promise.resolve(show([])));
  assert.equal(code, 2);
  assert.match(err, /usage: construct show/);
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
  assert.match(out, /halted: this run reached the [\d.]+ ceiling/);
  // The number is a reported cost, and on a subscription host that is an
  // estimate of work done rather than an amount charged. Saying so where the
  // ceiling is enforced is the only place a reader is guaranteed to see it.
  assert.match(out, /not a spending limit/);
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

test('the work summary renders issue markers as reader sentences, and the stored record keeps them raw', async () => {
  // The gap this closes: the merged issue list under "issues across roles"
  // printed a role's numbered issues verbatim, markers and all, while every
  // other reader surface (the composed document) hands a reader prose. The
  // stored deliverable must still carry the record-form markers — only the
  // print here changes.
  const markedIssues: HostAdapter = {
    ...standInHost(),
    invoke: async (request: unknown): Promise<HostResult> => {
      const role = (request as { role: string }).role;
      const text =
        role === 'privacy'
          ? 'ISSUES\n' +
            '1. the retention policy is not written down [unverified]\n' +
            '2. nobody is named to own key rotation [unowned]\n'
          : `${role} reporting`;
      return { id: role, status: 'ok', output: { text, usage: { cost: 0.01 } }, error: null };
    },
  };

  // Read the store while the sequence's own data dir is still current — it is
  // restored to whatever it was before as soon as runAll returns.
  let storedText = '';
  const { code, out } = await runAll([
    ['outcome', 'launch a paid beta to EU users next month'],
    () => work([], markedIssues),
    async () => {
      const store = openStore(join(process.env.XDG_DATA_HOME as string, 'construct', 'construct.db'));
      try {
        const row = store.db.prepare("SELECT id FROM tasks WHERE role = 'privacy' LIMIT 1").get() as { id: string };
        const task = getTask(store, row.id);
        storedText = (task?.result as { text?: string } | null)?.text ?? '';
      } finally {
        store.close();
      }
      return 0;
    },
  ]);

  assert.equal(code, 0);
  assert.match(out, /issues across roles/);
  assert.ok(!out.includes('[unverified]'), 'the printed summary must not carry the raw marker');
  assert.ok(!out.includes('[unowned]'), 'the printed summary must not carry the raw marker');
  assert.match(out, /this one still needs checking against a source/, 'the marker prints as the reader sentence it renders to');
  assert.match(out, /nobody is named for this yet/);

  assert.match(storedText, /\[unverified\]/, 'the stored record is untouched — rendering happens at print time only');
  assert.match(storedText, /\[unowned\]/);
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
  // The inbox also carries one unfilled-sections decision per terse
  // deliverable now, so the count is not 1 — the framed conflict is what this
  // test pins, and the section asks are asserted as present, not counted.
  assert.match(out, /decision inbox \(\d+\)/);
  assert.match(out, /required section/);
  assert.match(out, /privacy: hold — no processing agreement is in place \[GDPR Art. 28\]/);
  assert.match(out, /program-sequencing: proceed — the date has slack \[the launch plan\]/);
  assert.ok(!/recommend/i.test(out), 'the inbox must frame, never arbitrate');
});

test('a decision lost to a dead process is reachable through the normal surface', async () => {
  // The crash-recovery case, end to end at the surface that failed. The tasks settle, the
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
  // From the dogfood: 'construct work --model=ollama/qwen3.5:4b'
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

test('the invocation that fails everything states the recourse, not the one after it', async () => {
  // An earlier recourse was correct and unreachable: it lived only on
  // the nothing-left-to-work path, so it printed on a SECOND `construct work`
  // against an already-settled run. Found in a live run whose every task failed
  // with "Missing Authentication header" and said nothing further — the first
  // invocation is the one the user is looking at, and for most people the only
  // one they will run.
  const refusing: HostAdapter = {
    ...standInHost(),
    invoke: async (request: unknown): Promise<HostResult> => ({
      id: (request as { role: string }).role,
      status: 'error',
      output: null,
      error: { messages: ['Missing Authentication header'] },
    }),
  };

  const { out, code } = await runAll([
    ['outcome', 'launch a paid beta to EU users next month'],
    // Exactly one work invocation. No second call to fall through to.
    () => work([], refusing),
  ]);

  assert.match(out, /Missing Authentication header/, 'the recorded error is shown');
  assert.match(out, /All \d+ task\(s\) failed and produced no deliverable/);
  assert.match(out, /host owns retries, so re-running work will not pick these up/);
  assert.match(out, /construct outcome "<what you want>"/, 'the user is told what to do next');
  assert.doesNotMatch(
    out,
    /reported cost .* allowed for this run/,
    'reporting spend under the ceiling after a run that delivered nothing reads as "this was cheap"',
  );
  assert.equal(code, 1);
});

test('a run still in flight does not read like a run that died', async () => {
  // A failed task writes no work-log event past capability-issued
  // — and neither does one that is still executing, so the two ended at the same
  // line and were indistinguishable from `construct log`. Found on a live,
  // healthy run that was reasonably read as hung.
  const refusing: HostAdapter = {
    ...standInHost(),
    invoke: async (request: unknown): Promise<HostResult> => ({
      id: (request as { role: string }).role,
      status: 'error',
      output: null,
      error: { messages: ['Missing Authentication header'] },
    }),
  };

  const dead = await runAll([
    ['outcome', 'launch a paid beta to EU users next month'],
    () => work([], refusing),
    ['log'],
  ]);

  assert.match(dead.out, /task\(s\): \d+ failed/, 'a dead run names its task states');
  assert.doesNotMatch(dead.out, /Still running/, 'nothing is running in a run that failed');
  assert.match(dead.out, /host owns retries/, 'the dead run states the recourse');

  // A live run: tasks dispatched and leased, nothing settled. `log` must say so
  // rather than trailing off at the same event the dead one stopped at.
  const live = await runAll([
    ['outcome', 'launch a paid beta to EU users next month'],
    async () => {
      const store = openStore(join(process.env.XDG_DATA_HOME as string, 'construct', 'construct.db'));
      try {
        // A lease held by someone else, far in the future: dispatched, working,
        // nothing settled — the state the frozen log could not distinguish.
        claimTask(store, {
          owner: 'another-worker',
          leaseUntil: '2099-01-01T00:00:00.000Z',
          now: new Date().toISOString(),
        });
      } finally {
        store.close();
      }
      return 0;
    },
    ['log'],
  ]);

  assert.match(live.out, /Still running/, 'a live lease is reported as still running');
  assert.match(live.out, /2099-01-01T00:00:00\.000Z/, 'the lease deadline is shown');
  assert.match(live.out, /will not take a live lease/, 'the user is steered off re-running work');
  assert.doesNotMatch(live.out, /host owns retries/, 'a live run is not offered failure recourse');
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

test('source add/list/retire round-trips, and a duplicate declaration is a sentence, not a stack', async () => {
  const first = await runAll([
    ['source', 'add', '--kind=jira', '--locator=PROJ'],
    ['source', 'list'],
  ]);
  assert.equal(first.code, 0);
  assert.match(first.out, /declared src-\d+: jira PROJ \(workspace default\)/);
  assert.match(first.out, /src-\d+ {2}jira {2}PROJ/);

  const dup = await runAll([
    ['source', 'add', '--kind=jira', '--locator=PROJ'],
    ['source', 'add', '--kind=jira', '--locator=PROJ'],
  ]);
  assert.equal(dup.code, 1);
  assert.match(dup.err, /already declares jira PROJ/);
});

test('retiring a source removes it from the active list but --all still shows it', async () => {
  const result = await runAll([
    ['source', 'add', '--kind=git', '--locator=github.com/acme/app'],
    async () => {
      const store = openStore(join(process.env.XDG_DATA_HOME as string, 'construct', 'construct.db'));
      try {
        const rows = store.db.prepare('SELECT id FROM sources').all() as Array<{ id: string }>;
        process.env.CONSTRUCT_TEST_SOURCE_ID = rows[0]?.id ?? '';
      } finally {
        store.close();
      }
      return 0;
    },
    () => main(['source', 'retire', `--id=${process.env.CONSTRUCT_TEST_SOURCE_ID}`]),
    ['source', 'list'],
    ['source', 'list', '--all'],
  ]);
  delete process.env.CONSTRUCT_TEST_SOURCE_ID;
  assert.equal(result.code, 0);
  assert.match(result.out, /retired src-\d+/);
  assert.match(result.out, /no sources declared for workspace default/);
  assert.match(result.out, /\(retired /);
});

test('mode defaults to team, records a set, and refuses a mode nobody defined', async () => {
  const result = await runAll([
    ['mode'],
    ['mode', '--set=seat'],
    ['mode'],
  ]);
  assert.equal(result.code, 0);
  assert.match(result.out, /workspace default: team \(Construct is the whole team\)/);
  assert.match(result.out, /workspace default: seat \(Construct fills one role on your team\)/);

  const bad = await run(['mode', '--set=boss']);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /usage: construct mode/);
});

test('source without a subcommand or with a kind nobody defined prints usage', async () => {
  const bare = await run(['source']);
  assert.equal(bare.code, 2);
  assert.match(bare.err, /usage: construct source/);

  const bad = await run(['source', 'add', '--kind=wiki', '--locator=x']);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /usage: construct source/);
});

test('a docs source needs a locator naming its provider and container, or the CLI refuses it as a sentence', async () => {
  const malformed = await run(['source', 'add', '--kind=docs', '--locator=wiki']);
  assert.equal(malformed.code, 2);
  assert.match(malformed.err, /names no provider/);
  assert.ok(!/ {4}at /.test(malformed.err), 'a plain-language refusal, not a stack');

  const declared = await runAll([
    ['source', 'add', '--kind=docs', '--locator=confluence:space:ENG'],
    ['source', 'list'],
  ]);
  assert.equal(declared.code, 0);
  assert.match(declared.out, /declared src-\d+: docs confluence:space:ENG \(workspace default\)/);
});

test('an outcome records a plan and construct plan renders it, sequenced and labeled', async () => {
  const result = await runAll([
    ['source', 'add', '--kind=jira', '--locator=PROJ'],
    ['outcome', 'store customer emails for the newsletter and secure the signup endpoint'],
    async () => {
      const store = openStore(join(process.env.XDG_DATA_HOME as string, 'construct', 'construct.db'));
      try {
        const rows = store.db.prepare('SELECT run FROM plans').all() as Array<{ run: string }>;
        process.env.CONSTRUCT_TEST_PLAN_RUN = rows[0]?.run ?? '';
      } finally {
        store.close();
      }
      return 0;
    },
    () => main(['plan', process.env.CONSTRUCT_TEST_PLAN_RUN as string]),
  ]);
  delete process.env.CONSTRUCT_TEST_PLAN_RUN;
  assert.equal(result.code, 0);
  assert.match(result.out, /plan plan-run-\d+: \d+ steps?, risk (low|high), over 1 declared source \(read at work time\)/);
  assert.match(result.out, /routed to [a-z-]+ by lexical-fallback/);
  assert.match(result.out, /required slots: finding, evidence, risks/);
  assert.match(result.out, /sources declared: src-\d+/);
});

test('plan without a run id is usage, and an unknown run is a sentence', async () => {
  const result = await runAll([['plan', 'run-nope']]);
  assert.equal(result.code, 1);
  assert.match(result.err, /no plan recorded for run-nope/);
  const usage = await runAll([['plan']]);
  assert.equal(usage.code, 2);
  assert.match(usage.err, /usage: construct plan/);
});

test('a run over declared sources dispatches roles grounded in the named documents', async () => {
  const ground = mkdtempSync(join(tmpdir(), 'construct-ground-'));
  writeFileSync(join(ground, 'roadmap.md'), '# roadmap\nbeta in the EU\n');
  writeFileSync(join(ground, 'constraints.txt'), 'no launch before compliance sign-off\n');

  const assignments: string[] = [];
  const capturing: HostAdapter = {
    name: 'stand-in',
    kind: 'general',
    capabilities: [],
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (request: unknown): Promise<HostResult> => {
      assignments.push((request as { task: string }).task);
      const role = (request as { role: string }).role;
      return { id: role, status: 'ok', output: { text: `${role} reporting` }, error: null };
    },
  };

  try {
    const { code, out } = await runAll([
      ['source', 'add', '--kind=directory', `--locator=${ground}`],
      ['source', 'add', '--kind=jira', '--locator=PROJ'],
      ['outcome', 'launch a paid beta to EU users next month'],
      // Dispatched where the ground is: a run licensed a root it cannot open
      // is refused now, which is the whole point of the check.
      () => work([`--dir=${ground}`], capturing),
      ['log'],
    ]);

    assert.equal(code, 0);
    assert.match(out, /grounded run-/, 'the survey reports before dispatch');
    assert.match(out, /2 documents from 2 sources \(1 unreachable\)/);
    assert.match(out, /sources-read/, 'the survey is in the work log, not only on screen');

    // A deliverable that fails its free checks goes back to its author once, so
    // the calls this host saw are dispatches and repairs interleaved. They are
    // different texts answering different questions and the dispatch assertions
    // below belong to the first kind only.
    const dispatched = assignments.filter((text) => text.includes('Your material for this task'));
    const repairs = assignments.filter((text) => text.includes('Your draft is not finished'));

    assert.ok(dispatched.length > 0, 'roles were dispatched');
    assert.ok(
      repairs.length > 0,
      'a deliverable that failed its checks was sent back rather than kept as it arrived',
    );
    for (const repair of repairs) {
      assert.ok(repair.includes(ground), 'a repair restates the license the role still holds');
    }
    for (const assignment of dispatched) {
      assert.match(assignment, /Your material for this task/);
      assert.ok(assignment.includes(join(ground, 'roadmap.md')), 'documents are named by citable path');
      assert.match(assignment, /\[unreachable\]/, 'the source nobody could read says so');
      assert.match(assignment, /Not all of it was read/);
      assert.match(assignment, /the survey, not the boundary/, 'reads past the list are licensed');
      assert.ok(assignment.includes(ground), 'the licensed root is the declared locator');
      assert.match(assignment, /ASK: <the question, one sentence>/, 'requirements protocol is stated');
    }
  } finally {
    rmSync(ground, { recursive: true, force: true });
  }
});

test('watch refuses ground that is not Construct rather than filing another repo\'s drift as its own', async () => {
  const elsewhere = mkdtempSync(join(tmpdir(), 'not-construct-'));
  try {
    writeFileSync(join(elsewhere, 'package.json'), JSON.stringify({ name: 'someone-elses-app' }));
    const refused = await runAll([['watch', `--root=${elsewhere}`]]);
    assert.equal(refused.code, 1);
    assert.match(refused.err, /is not a Construct checkout/);
    // The failure names what --root actually selects, so the next person does
    // not read the flag as "watch this project".
    assert.match(refused.err, /which checkout of Construct to inspect/);
    assert.doesNotMatch(refused.out, /ground:/, 'a refused sweep records no ground at all');
  } finally {
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('an outcome plans against the workspace it was given, not always the default one', async () => {
  const ground = mkdtempSync(join(tmpdir(), 'construct-ground-'));
  try {
    writeFileSync(join(ground, 'notes.md'), '# Notes\n\nThe billing migration is deferred.\n');
    const { out } = await runAll([
      ['source', 'add', '--kind=directory', `--locator=${ground}`, '--workspace=waveb'],
      ['outcome', 'ship the paid beta'],
      ['outcome', '--workspace=waveb', 'ship the paid beta'],
      async () => {
        const store = openStore(
          join(process.env.XDG_DATA_HOME!, 'construct', 'construct.db'),
        );
        try {
          // The plan is what records sourcesDeclared and what `work` grounds
          // from, so the flag is only real if it reaches the plan.
          const runs = readWorkLog(store)
            .filter((e) => e.action === 'outcome-received')
            .map((e) => e.run);
          assert.equal(runs.length, 2);
          assert.deepEqual(planFor(store, runs[0])!.sourcesDeclared, []);
          assert.equal(planFor(store, runs[1])!.sourcesDeclared.length, 1);
        } finally {
          store.close();
        }
        return 0;
      },
    ]);
    // A workspace with nothing declared on it and a workspace that was never
    // consulted print the same phrase, so the phrase names the workspace.
    assert.match(out, /no sources declared\n/);
    assert.match(out, /over 1 declared source \(read at work time\) on workspace "waveb"/);
  } finally {
    rmSync(ground, { recursive: true, force: true });
  }
});

test('the invocation limit is the caller\'s to set, and cannot silently outlast the lease', async () => {
  assert.equal(parseWorkArgs(['--timeout=5']).timeoutMs, 5 * 60 * 1000);
  assert.equal(parseWorkArgs([]).timeoutMs, undefined, 'unset means the host\'s own declared default');
  assert.throws(() => parseWorkArgs(['--timeout=0']), /positive number of minutes/);
  // Longer than the lease means a task still running when its lease expires is
  // handed to a second worker and the same work is paid for twice.
  assert.throws(() => parseWorkArgs(['--timeout=20']), /exceeds --lease-minutes=15/);
  assert.equal(parseWorkArgs(['--timeout=20', '--lease-minutes=30']).timeoutMs, 20 * 60 * 1000);
});

test('a host states the invocation limit it will enforce rather than leaving it to be discovered', () => {
  assert.equal(createOpenCodeAdapter({}).invocationTimeoutMs, 10 * 60 * 1000);
  assert.equal(createOpenCodeAdapter({ timeoutMs: 90_000 }).invocationTimeoutMs, 90_000);
});

test('a dispatch meets the recorded throughput floor before it spends ten minutes per role on it', async () => {
  const ground = mkdtempSync(join(tmpdir(), 'construct-ground-'));
  try {
    // The recorded observation is at 40 surveyed documents; a ground at least
    // that large is what it was measured against.
    for (let i = 0; i < 40; i += 1) {
      writeFileSync(join(ground, `doc-${String(i)}.md`), `# doc ${String(i)}\nbeta in the EU\n`);
    }
    const { out } = await runAll([
      ['source', 'add', '--kind=directory', `--locator=${ground}`],
      ['outcome', 'launch a paid beta to EU users next month'],
      () => work([`--dir=${ground}`, '--model=ollama/qwen3.6:35b'], standInHost()),
    ]);
    assert.match(out, /nearest recorded observation \(2026-08-10, ollama\/qwen3\.6:35b\)/);
    // A caution with no next move is a slower failure, so both ways out are named.
    assert.match(out, /--timeout=<minutes>/);
    assert.match(out, /construct outcome --workspace=<name>/);
    assert.match(out, /docs\/internal\/stakeholder-acceptance-phase-5\.md/);
  } finally {
    rmSync(ground, { recursive: true, force: true });
  }
});

test('a dispatch on a model nothing was measured on is not cautioned about one that was', async () => {
  const ground = mkdtempSync(join(tmpdir(), 'construct-ground-'));
  try {
    for (let i = 0; i < 40; i += 1) {
      writeFileSync(join(ground, `doc-${String(i)}.md`), `# doc ${String(i)}\nbeta in the EU\n`);
    }
    const { out } = await runAll([
      ['source', 'add', '--kind=directory', `--locator=${ground}`],
      ['outcome', 'launch a paid beta to EU users next month'],
      () => work(['--model=claude-sonnet-5'], standInHost()),
    ]);
    assert.doesNotMatch(out, /nearest recorded observation/);
  } finally {
    rmSync(ground, { recursive: true, force: true });
  }
});

test('a timeout failure names the flag that moves the wall, not just the wall', async () => {
  const timedOut: HostAdapter = {
    ...standInHost(),
    invoke: async (): Promise<HostResult> => ({
      id: 'x',
      status: 'error',
      output: null,
      error: { messages: ['Host "opencode" invocation exceeded 600000ms'] },
    }),
  };
  const { code, out } = await runAll([
    ['outcome', 'launch a paid beta to EU users next month'],
    () => work([], timedOut),
  ]);
  assert.equal(code, 1);
  assert.match(out, /invocation exceeded 600000ms — raise it with --timeout=<minutes>/);
});

test('every command leaves this build\'s catalog mark on the store it opens', async () => {
  // The mark is what lets an older installed Construct say its catalog is
  // behind: the newer build must leave word as a side effect of ordinary use,
  // not as a ceremony nobody runs.
  await runAll([
    ['log'],
    async () => {
      const store = openStore(
        join(process.env.XDG_DATA_HOME as string, 'construct', 'construct.db'),
      );
      try {
        const mark = catalogHighWater(store);
        assert.ok(mark, 'opening the store recorded a catalog sighting');
        assert.equal(mark.domains, DOMAINS.length);
        assert.ok(mark.version.length > 0);
      } finally {
        store.close();
      }
      return 0;
    },
  ]);
});
