/**
 * tests/kernel/run/unmet-concerns.test.ts — a concern the catalog cannot carry
 * reaches the record, and reaches nothing else.
 *
 * The property under test has two halves and both matter. The first is that
 * the gap is visible at all: a run whose namer proposed four concerns this
 * catalog has never heard of used to produce exactly the same log as a run
 * whose catalog covered the outcome, and a user reading either could not tell
 * which they were holding. The second is that visibility buys no authority.
 * An unmet concern enqueues no task, mints no role, and changes no routing —
 * it is a report about the catalog, and staffing it is a decision somebody
 * accepts later, never a side effect of recording an outcome.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { readWorkLog } from '../../../src/kernel/store/worklog.ts';
import { startRun, startRunNamed } from '../../../src/kernel/run/outcome.ts';
import { reasonClause } from '../../../src/cli/index.ts';

const AT = '2026-08-13T00:00:00.000Z';

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

/** The entries this file is about, in log order. */
function unmetEntries(store: ReturnType<typeof openStore>, run: string) {
  return readWorkLog(store, run)
    .filter((entry) => entry.action === 'concern-unmet')
    .map((entry) => entry.detail as Record<string, unknown>);
}

test('a concern the catalog cannot carry is written to the work log with its reason', async () => {
  await withStoreAsync(async (store) => {
    const started = await startRunNamed(store, {
      runId: 'run-unmet',
      outcome: 'Build a place-connected history atlas from archival records',
      at: AT,
      host: 'test-host',
      namer: () =>
        Promise.resolve([
          { domain: 'privacy', why: 'records name people who may still be living' },
          {
            domain: 'community-consent',
            why: 'descendants of the people in these records have a stake in how they are shown',
          },
          { domain: 'source-rights', why: 'each archive licenses its scans on its own terms' },
        ]),
    });

    assert.equal(started.inferredBy, 'namer');
    const unmet = unmetEntries(store, 'run-unmet');
    assert.deepEqual(
      unmet.map((d) => [d.proposed, d.reason]),
      [
        ['community-consent', 'not-in-catalog'],
        ['source-rights', 'not-in-catalog'],
      ],
      'both proposals outside the catalog are named, in the order the namer gave them',
    );
    assert.equal(
      unmet[0]?.why,
      'descendants of the people in these records have a stake in how they are shown',
      "the namer's own words are the evidence; a paraphrase would be the record arguing with itself",
    );
    assert.equal(unmet[0]?.host, 'test-host', 'which host proposed it is part of the record');
  });
});

test('an unmet concern enqueues nothing and leaves routing exactly as it was', async () => {
  await withStoreAsync(async (store) => {
    const started = await startRunNamed(store, {
      runId: 'run-no-dispatch',
      outcome: 'Build a place-connected history atlas from archival records',
      at: AT,
      namer: () =>
        Promise.resolve([
          { domain: 'privacy', why: 'records name people who may still be living' },
          { domain: 'community-consent', why: 'descendants have a stake in how these records are shown' },
        ]),
    });

    assert.equal(started.implicated.length, 1, 'only the catalog domain implicates');
    assert.equal(started.tasks.length, 1, 'the refused concern must not become work');
    assert.equal(started.implicated[0]?.domain, 'privacy');
  });
});

test('a run whose catalog covered the outcome records no unmet concern', async () => {
  await withStoreAsync(async (store) => {
    await startRunNamed(store, {
      runId: 'run-covered',
      outcome: 'Launch a paid beta to EU users next month',
      at: AT,
      namer: () => Promise.resolve([{ domain: 'privacy', why: 'EU users means GDPR obligations' }]),
    });
    assert.deepEqual(unmetEntries(store, 'run-covered'), []);
  });
});

test('the zero-model path records no unmet concern, because keywords cannot propose outside the catalog', async () => {
  await withStoreAsync(async (store) => {
    startRun(store, {
      runId: 'run-keywords',
      outcome: 'Handle GDPR data subject requests for EU customers',
      at: AT,
    });
    assert.deepEqual(unmetEntries(store, 'run-keywords'), []);
  });
});

test('the log line shows what was asked for, so a reader can judge whether the catalog should carry it', () => {
  const line = reasonClause('concern-unmet', {
    proposed: 'community-consent',
    reason: 'not-in-catalog',
    why: 'descendants have a stake in how these records are shown',
  });
  assert.match(line, /community-consent/);
  assert.match(line, /not-in-catalog/);
  assert.match(line, /descendants have a stake in how these records are shown/);
});
