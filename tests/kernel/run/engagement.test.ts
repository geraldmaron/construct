/**
 * tests/kernel/run/engagement.test.ts — a role is told why it was engaged.
 *
 * Every implication already carries its evidence: the user's naming signal on
 * the selected path, a stated reason on the named one. Dispatch used to drop
 * it, so a role began work knowing neither which concern fired nor what was
 * cited for it — and then had to guess at its own remit. These tests hold both
 * variants to the same rule: the evidence reaches the assignment verbatim, and
 * the provenance travels with it, because a user naming and a model's stated
 * reason are not the same quality of evidence.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { getTask } from '../../../src/kernel/store/tasks.ts';
import {
  startRunNamed,
  startRunSelected,
  USER_NAMED_SIGNAL,
} from '../../../src/kernel/run/outcome.ts';
import { assignmentFor } from '../../../src/kernel/run/coordinator.ts';
import { validateBrief } from '../../../src/kernel/brief/schema.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';

const AT = '2026-08-05T00:00:00.000Z';

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

/** The same, awaiting the body — closing the store under an in-flight write is
 * the failure this separate form exists to avoid. */
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

function briefOf(store: ReturnType<typeof openStore>, taskId: string): Brief {
  const task = getTask(store, taskId);
  assert.ok(task, `expected task ${taskId}`);
  return task.brief as Brief;
}

test('user-named domains travel into the assignment, labelled as the user\'s choice', () => {
  withStore((store) => {
    const started = startRunSelected(store, {
      runId: 'run-user',
      outcome: 'Handle GDPR data subject requests for EU customers',
      at: AT,
      domains: ['privacy'],
    });
    assert.ok(started.tasks.length > 0, 'selected privacy must staff a task');

    const brief = briefOf(store, started.tasks[0]);
    assert.ok(brief.engagement, 'the brief carries why the role was engaged');
    assert.equal(brief.engagement.inferredBy, 'user');
    assert.deepEqual(brief.engagement.evidence, [USER_NAMED_SIGNAL]);

    const assignment = assignmentFor(brief);
    assert.match(assignment, /You were engaged because:/);
    for (const signal of brief.engagement.evidence) {
      assert.ok(assignment.includes(signal), `assignment must cite ${signal} verbatim`);
    }
    assert.match(assignment, /the user named your domain themselves/);
    // The concern is stated as the role's own, not merely as evidence.
    assert.ok(assignment.includes(brief.engagement.concern));
  });
});

test("a namer's stated reason travels the same way, labelled as a model's reason", async () => {
  await withStoreAsync(async (store) => {
    const started = await startRunNamed(store, {
      runId: 'run-namer',
      outcome: 'Launch a paid beta to EU users next month',
      at: AT,
      host: 'test-host',
      namer: () =>
        Promise.resolve([
          { domain: 'privacy', why: 'EU users means GDPR obligations before launch.' },
        ]),
    });
    assert.equal(started.inferredBy, 'namer');

    const brief = briefOf(store, started.tasks[0]);
    assert.deepEqual(brief.engagement?.evidence, [
      'EU users means GDPR obligations before launch.',
    ]);
    assert.equal(brief.engagement?.inferredBy, 'namer');

    const assignment = assignmentFor(brief);
    assert.ok(assignment.includes('EU users means GDPR obligations before launch.'));
    assert.match(assignment, /a model read the outcome and gave that as its reason/);
  });
});

test('the assignment warns that engagement evidence is not the outcome and may not be cited as one', () => {
  withStore((store) => {
    const started = startRunSelected(store, {
      runId: 'run-user-2',
      outcome: 'Handle GDPR data subject requests for EU customers',
      at: AT,
      domains: ['privacy'],
    });
    const brief = briefOf(store, started.tasks[0]);
    const assignment = assignmentFor(brief);
    // This is the exact defect a real run produced: the deliverable quoted the
    // namer's inferred evidence back as if it were the user's stated outcome,
    // citing it `[cite:outcome brief]`. The assignment now names that form and
    // says it is wrong, and gives the role the correct tag to use instead.
    assert.match(assignment, /not the user's own words, and not the outcome/);
    assert.match(assignment, /\[cite:outcome brief\]/);
    assert.match(assignment, /\[cite:engagement\]/);
  });
});

test('a user who named the staff is quoted as the user, not as an inference', () => {
  withStore((store) => {
    const started = startRunSelected(store, {
      runId: 'run-user',
      outcome: 'Rework the billing emails',
      at: AT,
      domains: ['privacy'],
    });
    const assignment = assignmentFor(briefOf(store, started.tasks[0]));
    assert.match(assignment, /You were engaged because: named by the user/);
    assert.match(assignment, /the user named your domain themselves/);
  });
});

test('a brief with no engagement is still a valid brief, and its assignment claims none', () => {
  const plain: Brief = {
    id: 'b',
    outcome: 'Ship the thing',
    role: 'privacy',
    inputs: [],
    capabilities: [],
    postconditions: [],
  };
  assert.equal(validateBrief(plain).ok, true);
  assert.doesNotMatch(assignmentFor(plain), /You were engaged because/);

  // Half an engagement would claim evidence that was never there.
  const hollow = {
    ...plain,
    engagement: { concern: 'privacy of people', evidence: [], inferredBy: 'keywords' },
  };
  const problems = validateBrief(hollow).problems.map((p) => p.field);
  assert.deepEqual(problems, ['engagement.evidence']);
});

test('a repaired namer answer writes a namer-retried entry and travels on the run', async () => {
  await withStoreAsync(async (store) => {
    const started = await startRunNamed(store, {
      runId: 'run-repaired',
      outcome: 'Launch a paid beta to EU users next month',
      at: AT,
      host: 'test-host',
      namer: () =>
        Promise.resolve({
          namings: [{ domain: 'privacy', why: 'EU users means GDPR obligations before launch.' }],
          retried: true,
          firstFailure: 'the host replied with malformed JSON',
        }),
    });
    assert.equal(started.inferredBy, 'namer');
    assert.equal(started.namerRetriedAfter, 'the host replied with malformed JSON');

    const { readWorkLog } = await import('../../../src/kernel/store/worklog.ts');
    const entries = readWorkLog(store, 'run-repaired');
    const retried = entries.find((e) => e.action === 'namer-retried');
    assert.ok(retried, 'the repair is in the log, not only on the result');
    assert.equal(
      (retried?.detail as { firstFailure?: string }).firstFailure,
      'the host replied with malformed JSON',
    );
  });
});
