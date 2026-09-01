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
import { main, outcome, work } from '../../src/cli/index.ts';
import { createOpenCodeAdapter } from '../../src/hosts/opencode/adapter.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';
import { openStore } from '../../src/kernel/store/open.ts';
import { readRunDispatch } from '../../src/kernel/store/dispatch.ts';
import { catalogHighWater } from '../../src/kernel/store/catalog.ts';
import { DOMAINS } from '../../src/kernel/implication/domains.ts';
import { planFor } from '../../src/kernel/store/plans.ts';
import { readWorkLog } from '../../src/kernel/store/worklog.ts';
import { sterileHome } from '../harness/sterile.ts';


// A dispatch reads the machine's agent skills directory to find out what
// method it can offer a role, so home is moved for this file: what the suite
// observes must not depend on what is installed for whoever runs it.
sterileHome();


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

test('construct outcome without --host or --domains refuses keyword staffing', async () => {
  const { code, err } = await run(() => outcome(['launch a paid beta to EU users next month'], undefined, {}));
  assert.equal(code, 2);
  assert.match(err, /--domains|--host/);
  assert.match(err, /Keyword routing is not a product staffing path/);
});

test('construct outcome --domains names staff without a model', async () => {
  const { code, out } = await run([
    'outcome',
    '--domains=privacy,commerce-tax,program-sequencing,product-scoping',
    'launch a paid beta to EU users next month',
  ]);
  assert.equal(code, 0);
  for (const domain of ['privacy', 'commerce-tax', 'program-sequencing', 'product-scoping']) {
    assert.match(out, new RegExp(domain));
  }
  assert.match(out, /You named these/);
});

test('an empty --domains list is a usage error, not a silent empty staff', async () => {
  const { code, err } = await run(['outcome', '--domains=', 'xyzzy plugh frobnicate']);
  assert.equal(code, 2);
  assert.match(err, /--domains needs at least one domain name/);
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

test('an outcome with no host named refuses rather than keyword-staffing', async () => {
  const { code, err } = await run(() => outcome([ANSWERED], undefined, {}));
  assert.equal(code, 2);
  assert.match(err, /--domains|--host/);
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

test('a user-named log entry does not claim a model was consulted', async () => {
  const { out } = await runAll([['outcome', '--domains=privacy', ANSWERED], ['log']]);
  assert.match(out, /domain-implicated/);
  assert.ok(!out.includes('inferred by: namer'), 'user-named staff must not advertise a model cost');
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

test('the same outcome consults the namer again — no outcome-text naming cache', async () => {
  const host = namingHost(NAMED);
  await runAll([
    () => outcome(['--host=opencode', SILENT], host),
    () => outcome(['--host=opencode', SILENT], host),
  ]);
  assert.equal(host.calls(), 2, 'catalog and project context change; the same words may be named again');
});

test('filing an outcome cannot cost money unless the user asks it to', async () => {
  const host = namingHost(NAMED);
  const { code, err } = await run(() => outcome([SILENT], undefined, {}));
  assert.equal(code, 2);
  assert.equal(host.calls(), 0, 'the default path must never consult a model');
  assert.match(err, /--host/);
  assert.match(err, /--domains/);
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

test('a namer that fails leaves nothing inferred, and the failure is stated everywhere', async () => {
  const { code, out } = await runAll([
    () => outcome(['--host=opencode', ANSWERED], brokenHost()),
    ['log'],
  ]);
  assert.equal(code, 0, 'a broken host must not crash the run');
  assert.doesNotMatch(out, /signals: /, 'keywords must not staff after a namer failure');
  assert.match(out, /could not be consulted/);
  assert.match(out, /nothing was inferred/);
  assert.match(out, /namer-failed/, 'the failure is in the log, not only on screen');
});

test('an outcome writes a work log the user can read back', async () => {
  const { out } = await runAll([['outcome', '--domains=privacy,commerce-tax,program-sequencing,product-scoping', 'launch a paid beta to EU users next month'], ['log']]);
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

test('construct work without project init refuses rather than ambient-dispatching', async () => {
  const { code, err } = await run(() => work(['--all'], standInHost()));
  assert.equal(code, 1);
  assert.match(err, /requires an initialized project/);
  assert.match(err, /construct init/);
});

test('construct show without a run id is a usage error, not a dump', async () => {
  const { show } = await import('../../src/cli/index.ts');
  const { code, err } = await run(() => Promise.resolve(show([])));
  assert.equal(code, 2);
  assert.match(err, /usage: construct show/);
});

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

for (const command of [['outcome', '--domains=product-scoping', 'ship a thing'], ['log'], ['inbox'], ['decide', 'd-1', 'yes']]) {
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
    ['outcome', '--domains=privacy,security', 'store customer emails for the newsletter and secure the signup endpoint'],
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
  assert.match(result.out, /routed to [a-z-]+ by user/);
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



test('an outcome plans against the workspace it was given, not always the default one', async () => {
  const ground = mkdtempSync(join(tmpdir(), 'construct-ground-'));
  try {
    writeFileSync(join(ground, 'notes.md'), '# Notes\n\nThe billing migration is deferred.\n');
    const { out } = await runAll([
      ['source', 'add', '--kind=directory', `--locator=${ground}`, '--workspace=waveb'],
      ['outcome', '--domains=privacy,product-scoping', 'ship the paid beta'],
      ['outcome', '--workspace=waveb', '--domains=privacy,product-scoping', 'ship the paid beta'],
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


test('a host states the invocation limit it will enforce rather than leaving it to be discovered', () => {
  assert.equal(createOpenCodeAdapter({}).invocationTimeoutMs, 10 * 60 * 1000);
  assert.equal(createOpenCodeAdapter({ timeoutMs: 90_000 }).invocationTimeoutMs, 90_000);
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
