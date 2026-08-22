/**
 * tests/kernel/run/voicerecord.test.ts — the voice a run was worked in is a
 * fact the run already holds, not one the user re-states.
 *
 * Written against the real store, like promotion.test.ts and for the same
 * reason: the claim being made is partly a storage property. The override is
 * recovered from the append-only work log rather than from a table something
 * could rewrite afterwards, and a stub log would prove nothing about that.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import type { Store } from '../../../src/kernel/store/open.ts';
import { appendWorkLog } from '../../../src/kernel/store/worklog.ts';
import { VOICE_OVERRIDE_ACTION, voiceOverrideFor } from '../../../src/kernel/run/voicerecord.ts';

const RUN = 'run-1';
const AT = '2026-08-21T00:00:00.000Z';

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

function record(store: Store, run: string, detail: unknown, at = AT): void {
  appendWorkLog(store, { run, task: `${run}:privacy`, role: 'privacy', action: VOICE_OVERRIDE_ACTION, detail, at });
}

test('a run nobody overrode reads back as the house voice, which needs no record', () => {
  withStore((store) => {
    appendWorkLog(store, { run: RUN, role: 'construct', action: 'role-dispatched', at: AT });
    assert.equal(voiceOverrideFor(store, RUN), null);
  });
});

test('the voice a run was worked in is recovered from its own record, verbatim', () => {
  withStore((store) => {
    record(store, RUN, { instruction: 'Write it as a limerick.', source: 'cli --voice' });
    assert.deepEqual(voiceOverrideFor(store, RUN), {
      instruction: 'Write it as a limerick.',
      source: 'cli --voice',
    });
  });
});

/**
 * Two invocations naming different voices are the user changing their mind, not
 * asking for one document in two registers. Order is the log's own sequence:
 * the timestamps are caller-supplied, so the later entry here carries the
 * EARLIER clock reading deliberately — a skewed clock must not be able to
 * decide which voice a document is written in.
 */
test('where a run was worked twice under different voices, the last one asked for wins', () => {
  withStore((store) => {
    record(store, RUN, { instruction: 'Write it as a limerick.', source: 'cli --voice' });
    record(store, RUN, { instruction: 'Write it as a court filing.', source: 'cli --voice' }, '2020-01-01T00:00:00.000Z');
    assert.equal(voiceOverrideFor(store, RUN)?.instruction, 'Write it as a court filing.');
  });
});

test('one run\'s voice never reaches another run\'s document', () => {
  withStore((store) => {
    record(store, RUN, { instruction: 'Write it as a limerick.', source: 'cli --voice' });
    assert.equal(voiceOverrideFor(store, 'run-2'), null);
  });
});

/**
 * Binding an empty voice block would replace the house rules with nothing at
 * all, which is worse than either voice — so a record whose instruction did not
 * survive leaves the house voice standing rather than silently emptying it.
 */
test('a record with no instruction left in it is not an override to compose under', () => {
  withStore((store) => {
    record(store, RUN, { instruction: '   ', source: 'cli --voice' });
    record(store, RUN, { source: 'cli --voice' });
    record(store, RUN, null);
    assert.equal(voiceOverrideFor(store, RUN), null);
  });
});

test('a real override is not lost to a malformed record written after it', () => {
  withStore((store) => {
    record(store, RUN, { instruction: 'Write it as a limerick.', source: 'cli --voice' });
    record(store, RUN, { instruction: '' });
    assert.equal(voiceOverrideFor(store, RUN)?.instruction, 'Write it as a limerick.');
  });
});
