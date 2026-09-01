/**
 * tests/kernel/run/model-floor.test.ts — a planner-built brief declares a
 * model floor.
 *
 * `modelFloor` was declared and read at every dispatch seam, but nothing the
 * planner built ever set it: `briefFor` and `askBriefFor` both left the field
 * off, so every real run computed a floor of 'any' and the below-floor
 * degradation path was reachable only from a hand-written brief. These tests
 * go through `startRun` and `startAskNamed` rather than constructing a brief,
 * for the same reason spine-challenges.test.ts does — a brief written by a
 * test is exactly the thing that would have passed while the real path did
 * not set the field at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { getTask } from '../../../src/kernel/store/tasks.ts';
import { startRunSelected, startAskNamed } from '../../../src/kernel/run/outcome.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';

const AT = '2026-08-21T00:00:00.000Z';

function withStore<T>(body: (store: ReturnType<typeof openStore>) => T): T {
  const fixture = sterile();
  const store = openStore(join(fixture.paths.dataDir, 'construct.db'));
  try {
    return body(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

async function withStoreAsync<T>(
  body: (store: ReturnType<typeof openStore>) => Promise<T>,
): Promise<T> {
  const fixture = sterile();
  const store = openStore(join(fixture.paths.dataDir, 'construct.db'));
  try {
    return await body(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

function briefsFor(store: ReturnType<typeof openStore>, taskIds: readonly string[]): Brief[] {
  return taskIds.map((id) => {
    const task = getTask(store, id);
    assert.ok(task, `expected task ${id}`);
    return task.brief as Brief;
  });
}

test('an outcome brief for a licensed-review domain declares frontier, not any', () => {
  withStore((store) => {
    const started = startRunSelected(store, {
      runId: 'run-privacy-floor',
      outcome: 'Handle GDPR data subject requests for EU customers',
      at: AT,
      domains: ['privacy'],
    });
    const briefs = briefsFor(store, started.tasks);
    const privacy = briefs.find((b) => b.role === 'privacy');
    assert.ok(privacy, 'this outcome must implicate privacy');
    assert.equal(privacy.modelFloor, 'frontier');
  });
});

test('an outcome brief for a domain with no licensed-review obligation declares capable, not any', () => {
  withStore((store) => {
    const started = startRunSelected(store, {
      runId: 'run-accessibility-floor',
      outcome: 'Add screen reader support and WCAG contrast fixes to the settings page',
      at: AT,
      domains: ['accessibility'],
    });
    const briefs = briefsFor(store, started.tasks);
    assert.ok(briefs.length > 0, 'this outcome must implicate something');
    for (const brief of briefs) {
      assert.equal(
        brief.modelFloor,
        'capable',
        `${brief.role} must declare capable, never the unfloored any`,
      );
    }
  });
});

test('an ask brief for a licensed-review domain declares frontier, matching the outcome brief for the same domain', async () => {
  await withStoreAsync(async (store) => {
    const started = await startAskNamed(store, {
      runId: 'run-privacy-ask-floor',
      outcome: 'What does our contract say about EU customer data?',
      at: AT,
      host: 'test-host',
      namer: () => Promise.resolve([{ domain: 'privacy', why: 'the question is about EU customer data' }]),
    });
    const briefs = briefsFor(store, started.tasks);
    assert.equal(briefs.length, 1, 'an ask dispatches exactly one role');
    assert.equal(briefs[0]?.role, 'privacy');
    assert.equal(briefs[0]?.question, 'What does our contract say about EU customer data?');
    assert.equal(briefs[0]?.modelFloor, 'frontier');
  });
});

test('an ask brief for a domain with no licensed-review obligation declares capable, not any', async () => {
  await withStoreAsync(async (store) => {
    const started = await startAskNamed(store, {
      runId: 'run-ops-ask-floor',
      outcome: 'Who gets paged when the settings page goes down?',
      at: AT,
      host: 'test-host',
      namer: () => Promise.resolve([{ domain: 'operations', why: 'the question is about on-call routing' }]),
    });
    const briefs = briefsFor(store, started.tasks);
    assert.equal(briefs.length, 1, 'an ask dispatches exactly one role');
    assert.equal(briefs[0]?.role, 'operations');
    assert.equal(briefs[0]?.modelFloor, 'capable');
  });
});
