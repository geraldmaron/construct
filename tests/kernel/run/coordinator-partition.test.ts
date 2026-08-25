/**
 * tests/kernel/run/coordinator-partition.test.ts — the division of a run's
 * ground, on the path that actually dispatches.
 *
 * partition.test.ts pins the rule as a function. This pins the wiring, which is
 * a different claim and the one a user would feel: that `workRun` reads the
 * relationships the user declared, hands each role its own slice, licenses each
 * role exactly the roots of the slice it got — the assignment and the citation
 * gate must never judge different ground — tells it only about the sources it
 * holds, and records both halves where a deliverable's provenance is read from.
 *
 * A pure-function test cannot catch any of that going unwired.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import type { Store } from '../../../src/kernel/store/open.ts';
import { workRun } from '../../../src/kernel/run/coordinator.ts';
import { enqueueTask } from '../../../src/kernel/store/tasks.ts';
import { readWorkLog } from '../../../src/kernel/store/worklog.ts';
import {
  addSource,
  recordSourceRead,
  setSourceDeclaration,
} from '../../../src/kernel/store/sources.ts';
import { declareSourceEdge } from '../../../src/kernel/store/source-edges.ts';
import type { SourceRelation } from '../../../src/kernel/store/source-edges.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';
import type { HostAdapter, HostContext, HostResult } from '../../../src/kernel/hosts/interface.ts';

const AT = '2026-08-25T00:00:00.000Z';
const STRATEGY = '/ground/strategy';
const PLAN = '/ground/plan';

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

function brief(role: string): Brief {
  return {
    id: `t-${role}`,
    outcome: 'launch a paid beta to EU users next month',
    role,
    inputs: [],
    capabilities: [],
    postconditions: [],
  };
}

/** A host that keeps each dispatch's assignment against the task it belonged to. */
function recordingHost(): HostAdapter & { readonly byTask: Map<string, string> } {
  const byTask = new Map<string, string>();
  return {
    name: 'fake',
    kind: 'general',
    capabilities: [],
    byTask,
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (request: unknown, context?: HostContext): Promise<HostResult> => {
      const req = request as { role: string; task: string };
      const id = context?.invocationId ?? req.role;
      byTask.set(id, req.task);
      return { id, status: 'ok', output: { text: `${req.role} reporting`, usage: { cost: 0 } }, error: null };
    },
  } as unknown as HostAdapter & { readonly byTask: Map<string, string> };
}

/**
 * Two described sources, read by one run, joined however the caller says, and
 * two roles waiting to be dispatched against them.
 */
function seedRun(store: Store, relation: SourceRelation): void {
  for (const [id, locator, tier] of [
    ['src-strategy', STRATEGY, 'source-of-truth'],
    ['src-plan', PLAN, 'aspirational'],
  ] as const) {
    addSource(store, { id, workspace: 'default', kind: 'directory', locator, addedAt: AT });
    setSourceDeclaration(
      store,
      id,
      { authority: tier, relevance: `why ${locator} is here`, sensitive: false },
      AT,
    );
    recordSourceRead(store, {
      run: 'run-1',
      source: id,
      descriptor: `${locator}/doc.md`,
      coverage: 'complete',
      detail: '1 of 1 documents',
      recordedAt: AT,
    });
  }
  declareSourceEdge(store, {
    id: 'rel-1',
    workspace: 'default',
    from: 'src-strategy',
    to: 'src-plan',
    relation,
    note: 'stated by the person who declared both',
    declaredAt: AT,
  });
  for (const role of ['strategy', 'product']) {
    enqueueTask(store, { id: `t-${role}`, run: 'run-1', role, brief: brief(role), at: AT });
  }
}

/** The `role-dispatched` entry each task recorded, keyed by task. */
function dispatchRecords(store: Store): Map<string, { ground: string[]; related: unknown[] }> {
  const records = new Map<string, { ground: string[]; related: unknown[] }>();
  for (const entry of readWorkLog(store, 'run-1')) {
    if (entry.action !== 'role-dispatched') continue;
    const detail = entry.detail as { ground?: string[]; related?: unknown[] };
    records.set(entry.task as string, {
      ground: detail.ground ?? [],
      related: detail.related ?? [],
    });
  }
  return records;
}

test('two sources the user split reach one dispatch each, with only their own roots and tiers', async () => {
  await withStoreAsync(async (store) => {
    seedRun(store, 'covers-same-initiative');
    const host = recordingHost();

    const report = await workRun(store, host, {
      owner: 'w1',
      clock: () => AT,
      spendCeiling: 100,
      concurrency: 1,
    });
    assert.equal(report.dispatched, 2);

    const records = dispatchRecords(store);
    // Which task holds which side is the partition's business, not this test's.
    // What must hold is that the two sides went to different roles and that
    // between them the roles hold all of the run's ground.
    assert.deepEqual(
      [...records.values()].map((record) => record.ground).sort(),
      [['src-plan'], ['src-strategy']],
      'each role got one side of the initiative, and between them they hold both',
    );

    for (const [task, record] of records) {
      const assignment = host.byTask.get(task);
      assert.ok(assignment, task);
      const held = record.ground[0] === 'src-strategy' ? STRATEGY : PLAN;
      const withheld = held === STRATEGY ? PLAN : STRATEGY;
      const tier = held === STRATEGY ? 'source of truth' : 'aspirational';

      // The material this role was actually given, and the material it was not.
      assert.match(assignment!, new RegExp(`- ${held}/doc\\.md \\(${record.ground[0]}\\) \\[complete\\]`), task);
      assert.ok(!assignment!.includes(`${withheld}/doc.md`), task);

      // The roots it may read past the survey, narrowed with the material —
      // otherwise the assignment and the citation gate judge different ground.
      assert.match(assignment!, new RegExp(`declared roots, by its full path:\\n- ${held}\\n`), task);
      assert.ok(!assignment!.includes(`- ${withheld}\n`), `${task} has no licence to read what it was not given`);

      // And what the user said this source is: its own tier, not the other's.
      assert.match(assignment!, new RegExp(`\\(${record.ground[0]}\\) — ${tier}:`), task);
      assert.ok(!assignment!.includes(`${withheld} (`), task);

      // A relationship with one end outside this dispatch's ground describes
      // nothing the role is holding, so it is not spoken.
      assert.ok(
        !assignment!.includes('stated by the person who declared both'),
        'a role is not told about a boundary it cannot see both sides of',
      );
      assert.deepEqual(record.related, [], task);
    }
  });
});

test('two sources the user bound together reach both dispatches, and the boundary is on the record', async () => {
  await withStoreAsync(async (store) => {
    seedRun(store, 'governs');
    const host = recordingHost();

    await workRun(store, host, {
      owner: 'w1',
      clock: () => AT,
      spendCeiling: 100,
      concurrency: 1,
    });

    for (const task of ['t-strategy', 't-product']) {
      const assignment = host.byTask.get(task);
      assert.ok(assignment, task);
      assert.match(assignment!, new RegExp(`- ${STRATEGY}/doc\\.md \\(src-strategy\\)`), task);
      assert.match(assignment!, new RegExp(`- ${PLAN}/doc\\.md \\(src-plan\\)`), task);
      // What governs cannot be read apart from what it governs, so both roots
      // are licensed to both. Roots are listed sorted, as they always were.
      assert.match(assignment!, new RegExp(`declared roots, by its full path:\\n- ${PLAN}\\n- ${STRATEGY}\\n`), task);
      // The relationship itself, in the user's words, and what a crossing owes.
      assert.match(assignment!, new RegExp(`- ${STRATEGY} governs ${PLAN}\\.`), task);
      assert.match(assignment!, /The user says: "stated by the person who declared both"/, task);
      assert.match(assignment!, /has crossed a boundary somebody drew, so say which one/, task);
    }

    const records = dispatchRecords(store);
    for (const task of ['t-strategy', 't-product']) {
      assert.deepEqual(records.get(task)?.ground, ['src-strategy', 'src-plan'], task);
      assert.deepEqual(
        records.get(task)?.related,
        [{ from: STRATEGY, relation: 'governs', to: PLAN }],
        task,
      );
    }
  });
});

test('with nothing related, the dispatch path hands every role the whole ground', async () => {
  await withStoreAsync(async (store) => {
    seedRun(store, 'covers-same-initiative');
    // Retire the only relationship: the run is exactly as it was before anybody
    // said anything about how these two stand.
    store.db.prepare('UPDATE source_edges SET retired_at = ? WHERE id = ?').run(AT, 'rel-1');
    const host = recordingHost();

    await workRun(store, host, {
      owner: 'w1',
      clock: () => AT,
      spendCeiling: 100,
      concurrency: 1,
    });

    const records = dispatchRecords(store);
    for (const task of ['t-strategy', 't-product']) {
      const assignment = host.byTask.get(task);
      assert.match(assignment!, new RegExp(`- ${STRATEGY}/doc\\.md`), task);
      assert.match(assignment!, new RegExp(`- ${PLAN}/doc\\.md`), task);
      assert.deepEqual(records.get(task)?.ground, ['src-strategy', 'src-plan'], task);
      assert.deepEqual(records.get(task)?.related, [], task);
    }
  });
});
