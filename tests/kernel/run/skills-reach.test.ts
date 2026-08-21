/**
 * tests/kernel/run/skills-reach.test.ts — the method library reaching a
 * dispatched role: what the assignment says about it, what a run records about
 * it, and the difference between nobody looking and looking to find nothing.
 *
 * The host is a fake for the same reason it is elsewhere in this directory:
 * what is under test is which text the coordinator hands over and which facts
 * it writes down, and a real host makes that slower without making it truer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import type { Store } from '../../../src/kernel/store/open.ts';
import { enqueueTask } from '../../../src/kernel/store/tasks.ts';
import { readWorkLog } from '../../../src/kernel/store/worklog.ts';
import { assignmentFor, workRun } from '../../../src/kernel/run/coordinator.ts';
import type { SkillsReachable } from '../../../src/kernel/skills/reach.ts';
import type { HostAdapter, HostContext, HostResult } from '../../../src/kernel/hosts/interface.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';

const AT = '2026-08-21T00:00:00.000Z';

function brief(role = 'security'): Brief {
  return {
    id: `t-${role}`,
    outcome: 'launch a paid beta to EU users next month',
    role,
    inputs: [],
    capabilities: [],
    postconditions: [],
  };
}

const REACHABLE: SkillsReachable = {
  offers: [
    {
      name: 'investigative-research',
      description: 'multi-source research whose conclusions survive a hostile reader',
      reach: 'installed',
      locator: '/tmp/skills-dir',
    },
    {
      name: 'written-voice',
      description: 'one plain house voice for prose someone else will read',
      reach: 'checkout',
      locator: '/tmp/checkout/skills/written-voice/SKILL.md',
    },
  ],
  installDir: '/tmp/skills-dir',
  sourceDir: '/tmp/checkout/skills',
};

const NOTHING_REACHABLE: SkillsReachable = {
  offers: [],
  installDir: '/tmp/skills-dir',
  sourceDir: null,
};

test('an assignment nobody supplied a library to says nothing about method skills', () => {
  const assignment = assignmentFor(brief());
  assert.doesNotMatch(assignment, /method skills/i);
  assert.doesNotMatch(assignment, /investigative-research/);
});

test('an assignment carries every reachable skill, with what it is for and where it is', () => {
  const assignment = assignmentFor(brief(), undefined, { skills: REACHABLE });
  assert.match(assignment, /investigative-research \(installed at \/tmp\/skills-dir\)/);
  assert.match(
    assignment,
    /written-voice \(read the file at \/tmp\/checkout\/skills\/written-voice\/SKILL\.md\)/,
  );
  assert.match(assignment, /conclusions survive a hostile reader/);
});

test('a machine that was read and holds none says so rather than staying quiet', () => {
  const assignment = assignmentFor(brief(), undefined, { skills: NOTHING_REACHABLE });
  assert.match(assignment, /No portable method skills are reachable/);
  assert.match(assignment, /Do not name or cite one\./);
});

test('an answer-shaped dispatch is told about the library too', () => {
  const question = { ...brief(), question: 'do we need a DPA for this vendor?' };
  const assignment = assignmentFor(question, undefined, { skills: REACHABLE });
  assert.match(assignment, /investigative-research/);
});

interface FakeHost extends HostAdapter {
  readonly assignments: string[];
}

function fakeHost(): FakeHost {
  const assignments: string[] = [];
  return {
    name: 'fake',
    kind: 'general',
    capabilities: ['concurrent'] as const,
    assignments,
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    async invoke(request: unknown, context?: HostContext): Promise<HostResult> {
      const req = request as { role: string; task: string };
      assignments.push(req.task);
      return {
        id: context?.invocationId ?? req.role,
        status: 'ok',
        output: { text: `${req.role} reporting`, usage: { cost: 0, steps: 1 } },
        error: null,
      };
    },
  } as FakeHost;
}

async function withStoreAsync<T>(fn: (store: Store) => Promise<T>): Promise<T> {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    return await fn(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

test('a run records what the role could reach, and the assignment carries it', async () => {
  await withStoreAsync(async (store) => {
    enqueueTask(store, {
      id: 't-security',
      run: 'run-1',
      role: 'security',
      brief: brief(),
      at: AT,
    });
    const host = fakeHost();
    await workRun(store, host, {
      owner: 'test',
      clock: () => AT,
      spendCeiling: 10,
      skills: () => REACHABLE,
    });
    const offered = readWorkLog(store, 'run-1').filter(
      (entry) => entry.action === 'skills-offered',
    );
    assert.equal(offered.length, 1);
    assert.deepEqual((offered[0].detail as { offered: string[] }).offered, [
      'investigative-research (installed)',
      'written-voice (checkout)',
    ]);
    assert.match(host.assignments[0], /investigative-research/);
  });
});

test('a run on a machine holding none records that, rather than recording nothing', async () => {
  await withStoreAsync(async (store) => {
    enqueueTask(store, {
      id: 't-security',
      run: 'run-1',
      role: 'security',
      brief: brief(),
      at: AT,
    });
    await workRun(store, fakeHost(), {
      owner: 'test',
      clock: () => AT,
      spendCeiling: 10,
      skills: () => NOTHING_REACHABLE,
    });
    const offered = readWorkLog(store, 'run-1').filter(
      (entry) => entry.action === 'skills-offered',
    );
    assert.equal(offered.length, 1);
    assert.deepEqual((offered[0].detail as { offered: string[] }).offered, []);
    assert.equal((offered[0].detail as { sourceDir: string | null }).sourceDir, null);
  });
});

test('a run nobody handed a library to writes no such record at all', async () => {
  await withStoreAsync(async (store) => {
    enqueueTask(store, {
      id: 't-security',
      run: 'run-1',
      role: 'security',
      brief: brief(),
      at: AT,
    });
    await workRun(store, fakeHost(), { owner: 'test', clock: () => AT, spendCeiling: 10 });
    assert.equal(
      readWorkLog(store, 'run-1').filter((entry) => entry.action === 'skills-offered')
        .length,
      0,
    );
  });
});

test('the library is read once for the run, not once per role', async () => {
  await withStoreAsync(async (store) => {
    for (const role of ['security', 'privacy', 'operations']) {
      enqueueTask(store, { id: `t-${role}`, run: 'run-1', role, brief: brief(role), at: AT });
    }
    let reads = 0;
    await workRun(store, fakeHost(), {
      owner: 'test',
      clock: () => AT,
      spendCeiling: 10,
      skills: () => {
        reads += 1;
        return REACHABLE;
      },
    });
    assert.equal(reads, 1);
    assert.equal(
      readWorkLog(store, 'run-1').filter((entry) => entry.action === 'skills-offered')
        .length,
      3,
    );
  });
});
