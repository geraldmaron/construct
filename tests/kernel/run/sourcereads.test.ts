/**
 * tests/kernel/run/sourcereads.test.ts — the coverage judgments between a
 * survey and the read record: every listed document earns a complete row by
 * its citable path, a capped listing carries its remainder as partial, an
 * unreachable source says so, an empty one is a complete read of nothing, and
 * the record is written once per run rather than re-surveyed into a cache.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import type { Store } from '../../../src/kernel/store/open.ts';
import { addSource, sourceReadsFor } from '../../../src/kernel/store/sources.ts';
import {
  readsFromSurvey,
  recordRunSourceReads,
} from '../../../src/kernel/run/sourcereads.ts';
import type { SourceSurvey } from '../../../src/kernel/run/sourcereads.ts';

const AT = '2026-08-10T00:00:00.000Z';

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

const LISTED: SourceSurvey = {
  source: 'src-1',
  locator: '/ground/docs',
  outcome: 'listed',
  documents: [
    { path: '/ground/docs/plan.md', bytes: 120 },
    { path: '/ground/docs/spec.md', bytes: 340 },
  ],
  total: 2,
};

test('each listed document becomes a complete read by its citable path', () => {
  const reads = readsFromSurvey('run-1', LISTED, AT);
  assert.equal(reads.length, 2);
  assert.deepEqual(
    reads.map((r) => [r.descriptor, r.coverage]),
    [
      ['/ground/docs/plan.md', 'complete'],
      ['/ground/docs/spec.md', 'complete'],
    ],
  );
  assert.equal(reads[0]?.detail, '120 bytes');
});

test('a capped listing carries the remainder as a partial read, never silence', () => {
  const reads = readsFromSurvey('run-1', { ...LISTED, total: 9 }, AT);
  assert.equal(reads.length, 3);
  const partial = reads[2];
  assert.equal(partial?.coverage, 'partial');
  assert.equal(partial?.descriptor, '/ground/docs');
  assert.match(partial?.detail ?? '', /2 of 9 documents/);
});

test('an unreachable source is one row saying why', () => {
  const reads = readsFromSurvey(
    'run-1',
    { source: 'src-2', locator: 'PROJ', outcome: 'unreachable', reason: 'no jira connector' },
    AT,
  );
  assert.equal(reads.length, 1);
  assert.equal(reads[0]?.coverage, 'unreachable');
  assert.match(reads[0]?.detail ?? '', /no jira connector/);
});

test('an empty listing is a complete read of nothing, not an absent record', () => {
  const reads = readsFromSurvey('run-1', { ...LISTED, documents: [], total: 0 }, AT);
  assert.equal(reads.length, 1);
  assert.equal(reads[0]?.coverage, 'complete');
  assert.match(reads[0]?.detail ?? '', /no readable documents/);
});

test('recording writes once per run; a second survey never rewrites evidence', () => {
  withStore((store) => {
    addSource(store, {
      id: 'src-1',
      workspace: 'default',
      kind: 'directory',
      locator: '/ground/docs',
      addedAt: AT,
    });

    const first = recordRunSourceReads(store, 'run-1', [LISTED], AT);
    assert.equal(first.skipped, false);
    assert.equal(first.recorded, 2);
    assert.equal(sourceReadsFor(store, 'run-1').length, 2);

    const again = recordRunSourceReads(
      store,
      'run-1',
      [{ ...LISTED, documents: [], total: 0 }],
      AT,
    );
    assert.equal(again.skipped, true);
    assert.equal(again.recorded, 0);
    assert.equal(sourceReadsFor(store, 'run-1').length, 2, 'the first record is the record');
  });
});

test('a binary document earns a partial read row that says listed, not extracted', () => {
  const reads = readsFromSurvey(
    'run-1',
    {
      source: 's1',
      locator: '/ground',
      outcome: 'listed',
      documents: [
        { path: '/ground/plan.md', bytes: 10 },
        { path: '/ground/contract.pdf', bytes: 999, binary: true },
      ],
      total: 2,
    },
    AT,
  );
  assert.equal(reads[0]!.coverage, 'complete');
  assert.equal(reads[1]!.coverage, 'partial');
  assert.match(reads[1]!.detail, /listed, not extracted/);
  assert.match(reads[1]!.detail, /treat its content as unknown/);
});

test('an extracted binary document reads complete and points at its extraction', () => {
  const reads = readsFromSurvey(
    'run-1',
    {
      source: 's1',
      locator: '/ground',
      outcome: 'listed',
      documents: [
        {
          path: '/ground/contract.pdf',
          bytes: 999,
          binary: true,
          extraction: {
            outcome: 'extracted',
            tier: 'docling-local',
            path: '/cache/contract-abc.md',
            characters: 4200,
          },
        },
      ],
      total: 1,
    },
    AT,
  );
  assert.equal(reads[0]!.coverage, 'complete');
  assert.equal(reads[0]!.descriptor, '/ground/contract.pdf', 'the original is what gets cited');
  assert.match(reads[0]!.detail, /extracted by docling-local/);
  assert.match(reads[0]!.detail, /\/cache\/contract-abc\.md/);
  assert.match(reads[0]!.detail, /cite the original/);
});

test('a binary document no rung could put into words stays partial, with the reason', () => {
  const reads = readsFromSurvey(
    'run-1',
    {
      source: 's1',
      locator: '/ground',
      outcome: 'listed',
      documents: [
        {
          path: '/ground/call.mp4',
          bytes: 5,
          binary: true,
          extraction: {
            outcome: 'refused',
            reason: 'no ASR provider is available',
            remediation: 'install one',
          },
        },
      ],
      total: 1,
    },
    AT,
  );
  assert.equal(reads[0]!.coverage, 'partial');
  assert.match(reads[0]!.detail, /extraction refused: no ASR provider is available/);
  assert.match(reads[0]!.detail, /install one/);
});

/**
 * "The rest went unread" reads as more of the same, and over a repository it
 * means something else: the role was shown the design documents and not the
 * implementation. It is licensed to open either, and it will not go looking
 * for a gap whose shape it cannot see.
 */
test('a prose-ranked survey over a codebase says how much of the remainder is code', () => {
  const reads = readsFromSurvey(
    'run-1',
    {
      source: 's1',
      locator: '/ground/repo',
      outcome: 'listed',
      documents: [{ path: '/ground/repo/README.md', bytes: 120 }],
      total: 3412,
      emphasis: 'prose',
      unlistedCode: 3300,
    },
    '2026-08-13T00:00:00.000Z',
  );

  const partial = reads.find((read) => read.coverage === 'partial');
  assert.match(partial?.detail ?? '', /listed 1 of 3412 documents/);
  assert.match(partial?.detail ?? '', /ranked prose-first/);
  assert.match(partial?.detail ?? '', /3300 of them source files/);
  assert.match(partial?.detail ?? '', /may still open by path/);
});

test('a prose ground drops no code and says nothing about code', () => {
  const reads = readsFromSurvey(
    'run-1',
    {
      source: 's1',
      locator: '/ground/policies',
      outcome: 'listed',
      documents: [{ path: '/ground/policies/a.md', bytes: 10 }],
      total: 40,
      emphasis: 'prose',
    },
    '2026-08-13T00:00:00.000Z',
  );

  const partial = reads.find((read) => read.coverage === 'partial');
  assert.match(partial?.detail ?? '', /the rest went unread/);
  assert.doesNotMatch(partial?.detail ?? '', /source files/);
});
