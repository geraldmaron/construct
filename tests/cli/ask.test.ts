/**
 * tests/cli/ask.test.ts — the question surface, driven the way a user drives it.
 *
 * The property under test throughout is weight. `construct ask` exists because
 * a question phrased as an outcome pays for a fan-out it does not need, and
 * every assertion here is about that bargain holding: one concern dispatched
 * rather than all of them, an answer rather than a work product, no stance
 * asked for and so no decision framed — while the things that make an answer
 * trustworthy stay exactly as expensive as they were, which is to say the
 * record, the grounding, and the citation challenge.
 *
 * The other half is what the cheap surface must never quietly become. A
 * question that lands in a high-risk concern gets one grounded pass and no
 * licensed review, and a user who cannot tell that from a full run has been
 * handed the most dangerous thing this tool can produce: a legal-flavored
 * answer with none of the qualifications a legal-flavored answer carries.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ask, main, parseAskArgs } from '../../src/cli/index.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';
import { openStore } from '../../src/kernel/store/open.ts';
import { readWorkLog } from '../../src/kernel/store/worklog.ts';
import { sterileHome } from '../harness/sterile.ts';
import { listTasks } from '../../src/kernel/store/tasks.ts';
import { openDecisions } from '../../src/kernel/store/decisions.ts';
import { planFor } from '../../src/kernel/store/plans.ts';
import { assignmentFor } from '../../src/kernel/run/coordinator.ts';
import { askBriefFor, primaryImplication } from '../../src/kernel/run/ask.ts';
import type { Brief } from '../../src/kernel/brief/schema.ts';

// A dispatch reads the machine's agent skills directory to find out what
// method it can offer a role, so home is moved for this file: what the suite
// observes must not depend on what is installed for whoever runs it.
sterileHome();

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
  /** The data dir the run wrote into, still open for inspection. */
  readonly dataHome: string;
}

/**
 * One `ask` against a throwaway data dir, with both streams captured and the
 * dir left in place so a test can read the store back. The caller removes it.
 */
async function runAsk(argv: string[], host?: HostAdapter): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-ask-'));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
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
  try {
    const code = await ask(argv, host);
    return { code, out: out.join(''), err: err.join(''), dataHome: join(root, 'share') };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
  }
}

function storeIn(dataHome: string) {
  return openStore(join(dataHome, 'construct', 'construct.db'));
}

/**
 * A host that names concerns for the question and then answers as whichever
 * role is dispatched. One object rather than two because the ask surface makes
 * both calls in one command, which is the thing being tested.
 */
function askingHost(
  named: readonly { readonly domain: string; readonly why: string }[],
  answer = 'ANSWER\nthe roadmap defers it [unverified]\n\nLIMITS\nnothing else was declared',
): HostAdapter & { readonly assignments: () => readonly string[] } {
  const assignments: string[] = [];
  return {
    name: 'stand-in-ask',
    kind: 'general',
    capabilities: [],
    assignments: () => assignments,
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (request: unknown): Promise<HostResult> => {
      const { role, task } = request as { role: string; task?: string };
      if (role === 'implication-namer') {
        return { id: role, status: 'ok', output: { text: JSON.stringify({ domains: named }) }, error: null };
      }
      assignments.push(task ?? '');
      return { id: role, status: 'ok', output: { text: answer, usage: { cost: 0.002, steps: 1 } }, error: null };
    },
  };
}

const ROADMAP_Q = 'what does our roadmap say about the billing migration';

test('a question is answered by one concern even when it implicates several', async () => {
  const host = askingHost([
    { domain: 'product-scoping', why: 'the question is about what the roadmap commits to' },
    { domain: 'program-sequencing', why: 'a migration has an order' },
    { domain: 'measurement', why: 'the roadmap states targets' },
  ]);
  const { code, out, dataHome } = await runAsk(['--host=opencode', ROADMAP_Q], host);
  try {
    assert.equal(code, 0);
    assert.match(out, /answering: product-scoping/);
    // The concerns nobody was dispatched to are named rather than dropped: the
    // cheap surface must not read as the complete one.
    assert.match(out, /also implicated, and not asked: program-sequencing, measurement/);
    assert.match(out, /construct outcome/);

    const store = storeIn(dataHome);
    try {
      const tasks = listTasks(store);
      assert.equal(tasks.length, 1, 'a question enqueues one task, whatever it implicated');
      assert.equal(tasks[0].role, 'product-scoping');

      // The record still shows everything the question touched. A log listing
      // one concern where the inference found three would understate the
      // question, which is the accountability half of the same bargain.
      const implicated = readWorkLog(store)
        .filter((entry) => entry.action === 'domain-implicated')
        .map((entry) => entry.role);
      assert.deepEqual(implicated.sort(), ['measurement', 'product-scoping', 'program-sequencing']);

      const notDispatched = readWorkLog(store)
        .filter((entry) => entry.action === 'concern-not-dispatched')
        .map((entry) => entry.role);
      assert.deepEqual(notDispatched.sort(), ['measurement', 'program-sequencing']);

      // A log entry naming a task id nobody enqueued would read as work that
      // happened. The undispatched concerns carry no task reference.
      for (const entry of readWorkLog(store).filter((e) => e.action === 'concern-not-dispatched')) {
        assert.equal(entry.task, null);
      }
    } finally {
      store.close();
    }
  } finally {
    rmSync(dataHome, { recursive: true, force: true });
  }
});

test("the plan has one step, so it schedules only work that is going to happen", async () => {
  const host = askingHost([
    { domain: 'product-scoping', why: 'roadmap scope' },
    { domain: 'program-sequencing', why: 'ordering' },
  ]);
  const { out, dataHome } = await runAsk(['--host=opencode', ROADMAP_Q], host);
  try {
    assert.match(out, /plan .*: 1 step/);
    const store = storeIn(dataHome);
    try {
      const runId = readWorkLog(store)[0].run;
      const plan = planFor(store, runId);
      assert.ok(plan);
      assert.equal(plan.steps.length, 1);
      assert.equal(plan.steps[0].domain, 'product-scoping');
    } finally {
      store.close();
    }
  } finally {
    rmSync(dataHome, { recursive: true, force: true });
  }
});

test('the answer is printed, not left for a second command to collect', async () => {
  const host = askingHost([{ domain: 'product-scoping', why: 'roadmap scope' }]);
  const { code, out, dataHome } = await runAsk(['--host=opencode', ROADMAP_Q], host);
  try {
    assert.equal(code, 0);
    assert.match(out, /the roadmap defers it/);
    assert.doesNotMatch(out, /\[unverified\]/);
    assert.match(out, /still needs checking against a source/);
    assert.match(out, /— Construct, framed through product-scoping, \$/);
    assert.match(out, /construct log --run /);
  } finally {
    rmSync(dataHome, { recursive: true, force: true });
  }
});

test('an ask asks for no stance, so no decision is framed out of one voice', async () => {
  const host = askingHost([{ domain: 'product-scoping', why: 'roadmap scope' }]);
  const { dataHome } = await runAsk(['--host=opencode', ROADMAP_Q], host);
  try {
    const assignment = host.assignments()[0];
    assert.ok(assignment, 'the role was dispatched');
    assert.ok(
      !/declare a stance/i.test(assignment) && !/\bproceed \| hold\b/i.test(assignment),
      'the stance protocol has no meaning with one role in the room',
    );
    assert.match(assignment, /answering a question, not producing a work product/);
    assert.match(assignment, /The question the user asked:/);

    const store = storeIn(dataHome);
    try {
      assert.equal(openDecisions(store).length, 0, 'one voice cannot disagree with itself');
    } finally {
      store.close();
    }
  } finally {
    rmSync(dataHome, { recursive: true, force: true });
  }
});

test('a question landing in a high-risk concern says so before it answers', async () => {
  const host = askingHost([
    { domain: 'product-scoping', why: 'it reads as scoping' },
    { domain: 'privacy', why: 'it asks what we hold about customers' },
  ]);
  const { out, dataHome } = await runAsk(
    ['--host=opencode', 'what personal data do we keep about trial users'],
    host,
  );
  try {
    // The high-tier concern answers even though it was named second: a
    // licensed-review obligation dropped because a lower-tier signal scored
    // higher is exactly the silent failure this surface must not have.
    assert.match(out, /answering: privacy/);
    assert.match(out, /high risk/);
    assert.match(out, /licensed attorney/);
    assert.match(out, /not a review/);
    assert.match(out, /construct outcome/);
  } finally {
    rmSync(dataHome, { recursive: true, force: true });
  }
});

test('a question with no host is recorded and routed, and says nobody answered it', async () => {
  const { code, out, dataHome } = await runAsk(['launch a paid beta to EU users next month']);
  try {
    assert.equal(code, 0);
    assert.match(out, /answering: /);
    assert.match(out, /Nobody was dispatched/);
    assert.match(out, /construct ask --host=/);
    const store = storeIn(dataHome);
    try {
      // Routed and planned, with nothing claiming an answer was produced.
      assert.equal(listTasks(store).length, 1);
      assert.equal(listTasks(store)[0].state, 'pending');
    } finally {
      store.close();
    }
  } finally {
    rmSync(dataHome, { recursive: true, force: true });
  }
});

test('a question nothing in the catalog owns is recorded rather than dropped', async () => {
  const { code, out, dataHome } = await runAsk(['xyzzy plugh frobnicate']);
  try {
    assert.equal(code, 0);
    assert.match(out, /no concern in the catalog owns this question/);
    assert.match(out, /Nothing was inferred/);
    const store = storeIn(dataHome);
    try {
      assert.equal(listTasks(store).length, 0);
      assert.ok(readWorkLog(store).some((e) => e.action === 'no-domains-implicated'));
    } finally {
      store.close();
    }
  } finally {
    rmSync(dataHome, { recursive: true, force: true });
  }
});

test('with no declared sources the answer is stated to rest on the model, not on your material', async () => {
  const host = askingHost([{ domain: 'product-scoping', why: 'roadmap scope' }]);
  const { out, dataHome } = await runAsk(['--host=opencode', ROADMAP_Q], host);
  try {
    assert.match(out, /no sources declared/);
    assert.match(out, /rests on what the model knows/);
  } finally {
    rmSync(dataHome, { recursive: true, force: true });
  }
});

test('over a workspace with declared sources, the one dispatch is grounded in them', async () => {
  const ground = mkdtempSync(join(tmpdir(), 'construct-ground-'));
  writeFileSync(
    join(ground, 'roadmap.md'),
    '# Roadmap\n\nBilling migration: deferred to Q3 pending the processor contract.\n',
  );
  const host = askingHost([{ domain: 'product-scoping', why: 'roadmap scope' }]);
  const root = mkdtempSync(join(tmpdir(), 'construct-ask-'));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  const out: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (chunk: string) => {
    out.push(String(chunk));
    return true;
  };
  try {
    await main(['source', 'add', '--kind=directory', `--locator=${ground}`]);
    const code = await ask(['--host=opencode', ROADMAP_Q], host);
    assert.equal(code, 0);
    const text = out.join('');
    assert.match(text, /grounded: 1 document from 1 source/);

    // The assignment the role actually received is the grounded protocol, not
    // the no-material one. Those two rules contradict each other, so exactly
    // one may ever be spoken — and an ask must get the same one `work` does.
    const assignment = host.assignments()[0];
    assert.match(assignment, /Your material for this task is these documents/);
    assert.match(assignment, /roadmap\.md/);
    assert.ok(
      !/Whatever files happen to be around you are not evidence/.test(assignment),
      'the no-material rule must not be spoken to a grounded dispatch',
    );

    const store = storeIn(join(root, 'share'));
    try {
      const runId = readWorkLog(store).find((e) => e.action === 'outcome-received')!.run;
      assert.ok(
        readWorkLog(store).some((e) => e.run === runId && e.action === 'sources-read'),
        'what the run read is on the record, as it is for an outcome run',
      );
    } finally {
      store.close();
    }
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    rmSync(root, { recursive: true, force: true });
    rmSync(ground, { recursive: true, force: true });
  }
});

test('a host that cannot answer reports the failure rather than an empty answer', async () => {
  const failing: HostAdapter = {
    name: 'stand-in-ask',
    kind: 'general',
    capabilities: [],
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (request: unknown): Promise<HostResult> => {
      if ((request as { role: string }).role === 'implication-namer') {
        return {
          id: 'namer',
          status: 'ok',
          output: { text: JSON.stringify({ domains: [{ domain: 'product-scoping', why: 'scope' }] }) },
          error: null,
        };
      }
      return { id: 'role', status: 'error', output: null, error: { message: 'model refused' } };
    },
  };
  const { code, err, dataHome } = await runAsk(['--host=opencode', ROADMAP_Q], failing);
  try {
    assert.equal(code, 1);
    assert.match(err, /no answer/);
  } finally {
    rmSync(dataHome, { recursive: true, force: true });
  }
});

test('the ask brief owes the citation challenge and nothing shaped for a work product', () => {
  const brief = askBriefFor({
    runId: 'run-1',
    question: ROADMAP_Q,
    implication: { domain: 'product-scoping', concern: 'what to build', score: 0, signals: ['roadmap'] },
    inferredBy: 'namer',
  });
  assert.deepEqual(brief.challenges, ['claims-cited']);
  assert.equal(brief.question, ROADMAP_Q);
  // scope-diff asks what the brief requested that the deliverable does not
  // cover. An answer is not measured against a template's coverage.
  assert.ok(!(brief.challenges ?? []).includes('scope-diff'));
});

test('the high-tier concern answers over a stronger low-tier one', () => {
  const primary = primaryImplication([
    { domain: 'product-scoping', concern: 'a', score: 9, signals: ['x'] },
    { domain: 'contracts', concern: 'b', score: 1, signals: ['y'] },
  ]);
  assert.equal(primary?.domain, 'contracts');
});

test('an outcome brief is untouched: it still owes the work product and a stance', () => {
  const brief: Brief = {
    id: 't',
    outcome: 'move the warehouse',
    role: 'product-scoping',
    inputs: [],
    capabilities: [],
    postconditions: [],
    challenges: ['claims-cited'],
  };
  const assignment = assignmentFor(brief);
  assert.match(assignment, /The outcome the user asked for:/);
  assert.ok(!/answering a question/.test(assignment));
});

test('a question is required, and a host flag without a host is a usage error', () => {
  assert.equal(parseAskArgs(['--host=claude', 'why', 'is', 'this']).question, 'why is this');
  assert.equal(parseAskArgs([]).question, '');
  assert.throws(() => parseAskArgs(['--model=x', 'q']), /only applies when a host is named/);
  assert.throws(() => parseAskArgs(['--host=nope', 'q']), /unknown host/);
  assert.throws(() => parseAskArgs(['--ceiling=-1', 'q']), /non-negative/);
});
