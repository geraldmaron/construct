/**
 * tests/kernel/run/groundpass.test.ts — the grounding pass a run takes before
 * anything is dispatched, driven straight from the sterile harness with the
 * walk supplied as an argument.
 *
 * That is the property under test as much as the counts are: the pass decides
 * what a survey is worth without knowing how one is taken, so a test can hand
 * it a survey no filesystem produced. What it must get right is that recording
 * happens once per run (the read record is evidence, not a cache), that a
 * second pass says so and writes nothing, and that the log entry separates the
 * documents listed from the roots the roles are licensed past.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import type { Store } from '../../../src/kernel/store/open.ts';
import { addSource } from '../../../src/kernel/store/sources.ts';
import { recordPlan } from '../../../src/kernel/store/plans.ts';
import { readWorkLog } from '../../../src/kernel/store/worklog.ts';
import { sourceReadsFor } from '../../../src/kernel/store/sources.ts';
import { buildPlan } from '../../../src/kernel/plan/planner.ts';
import { groundRun, groundingSummary } from '../../../src/kernel/run/groundpass.ts';
import type { SourceSurvey } from '../../../src/kernel/run/sourcereads.ts';

const AT = '2026-08-11T00:00:00.000Z';

function withStore<T>(fn: (store: Store) => T): T {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    return fn(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

/** A run whose plan declares one directory source, and nothing read yet. */
function planned(store: Store, run: string): void {
  addSource(store, {
    id: 'src-1',
    workspace: 'acme',
    kind: 'directory',
    locator: '/ground/docs',
    addedAt: AT,
  });
  recordPlan(
    store,
    buildPlan({
      id: `plan-${run}`,
      run,
      outcome: 'ship the pilot',
      densified: null,
      implicated: [],
      inferredBy: 'keywords',
      sources: [
        {
          id: 'src-1',
          workspace: 'acme',
          kind: 'directory',
          locator: '/ground/docs',
          addedAt: AT,
          retiredAt: null,
        },
      ],
      workspace: 'acme',
      mode: 'team',
      plannedAt: AT,
    }),
  );
}

const SURVEY: SourceSurvey = {
  source: 'src-1',
  locator: '/ground/docs',
  outcome: 'listed',
  documents: [
    { path: '/ground/docs/plan.md', bytes: 120 },
    {
      path: '/ground/docs/scan.pdf',
      bytes: 900,
      binary: true,
      extraction: { outcome: 'extracted', path: '/cache/scan.txt', tier: 'pdftotext', characters: 400 },
    },
  ],
  total: 2,
};

test('the pass records the survey it was handed and logs what was licensed', () => {
  withStore((store) => {
    planned(store, 'run-1');
    const pass = groundRun(store, 'run-1', AT, () => [SURVEY]);

    assert.ok(pass, 'a plan declaring a source grounds');
    assert.equal(pass.documents, 2);
    assert.equal(pass.extracted, 1);
    assert.equal(pass.unreachable, 0);
    assert.equal(pass.skipped, false);
    assert.equal(sourceReadsFor(store, 'run-1').length, 2, 'each listed document earns a read row');

    const logged = readWorkLog(store, 'run-1').filter((e) => e.action === 'sources-read');
    assert.equal(logged.length, 1);
    assert.deepEqual((logged[0].detail as { licensedRoots: string[] }).licensedRoots, [
      '/ground/docs',
    ]);
  });
});

test('a second pass over the same run reports skipped and writes nothing', () => {
  withStore((store) => {
    planned(store, 'run-1');
    groundRun(store, 'run-1', AT, () => [SURVEY]);

    let walked = 0;
    const again = groundRun(store, 'run-1', AT, () => {
      walked += 1;
      return [SURVEY];
    });

    assert.equal(walked, 1, 'the survey is still taken; only the recording is once');
    assert.equal(again?.skipped, true);
    assert.equal(again?.recorded, 0);
    assert.equal(
      readWorkLog(store, 'run-1').filter((e) => e.action === 'sources-read').length,
      1,
      'the second pass adds no log entry',
    );
  });
});

test('a run with no plan, and a plan declaring nothing, both ground to null', () => {
  withStore((store) => {
    assert.equal(groundRun(store, 'run-missing', AT, () => [SURVEY]), null);

    recordPlan(
      store,
      buildPlan({
        id: 'plan-run-2',
        run: 'run-2',
        outcome: 'ship the pilot',
        densified: null,
        implicated: [],
        inferredBy: 'keywords',
        sources: [],
        workspace: 'acme',
        mode: 'team',
        plannedAt: AT,
      }),
    );
    assert.equal(groundRun(store, 'run-2', AT, () => [SURVEY]), null);
  });
});

test('the summary counts documents, sources, extractions and unreachable ground', () => {
  assert.equal(
    groundingSummary({
      surveys: [SURVEY],
      recorded: 2,
      skipped: false,
      documents: 2,
      unreachable: 0,
      extracted: 1,
    }),
    '2 documents from 1 source, 1 extracted',
  );
  assert.equal(
    groundingSummary({
      surveys: [SURVEY, SURVEY],
      recorded: 1,
      skipped: false,
      documents: 1,
      unreachable: 1,
      extracted: 0,
    }),
    '1 document from 2 sources (1 unreachable)',
  );
});
