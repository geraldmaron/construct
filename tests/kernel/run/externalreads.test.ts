/**
 * tests/kernel/run/externalreads.test.ts — the provenance class for research a
 * role did outside the run's declared ground.
 *
 * The property under test: what the host reports reading is recorded as
 * testimony, in the role's own name, in both the work log and its own listable
 * table — and a read that evidences nothing is refused rather than stored,
 * because a locator with nothing taken from it claims to have been somewhere
 * and proves it was worth nothing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import type { Store } from '../../../src/kernel/store/open.ts';
import { enqueueTask } from '../../../src/kernel/store/tasks.ts';
import { readWorkLog } from '../../../src/kernel/store/worklog.ts';
import { issueRoleToken } from '../../../src/kernel/capabilities/tokens.ts';
import {
  EXTERNAL_READ_ACTION,
  EXTERNAL_READ_CAP,
  EXTERNAL_READ_CAP_ACTION,
  recordExternalReadAsRole,
} from '../../../src/kernel/run/rolewrite.ts';
import { externalReadsFor, recordExternalRead } from '../../../src/kernel/store/externalreads.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';

const SECRET = 'kernel-secret-for-tests';
const AT = '2026-08-13T00:00:00.000Z';
const EXPIRES = '2026-08-13T00:15:00.000Z';
const RUN = 'run-1';
const TASK = 't-privacy';

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

function brief(role: string): Brief {
  return {
    id: `t-${role}`,
    outcome: 'launch a paid beta to EU users next month',
    role,
    inputs: [],
    capabilities: [],
    postconditions: [],
    challenges: [],
  };
}

function seed(store: Store): void {
  enqueueTask(store, { id: TASK, run: RUN, role: 'privacy', brief: brief('privacy'), at: AT });
}

function credential(at = AT) {
  return {
    token: issueRoleToken({ run: RUN, task: TASK, role: 'privacy', expiresAt: EXPIRES, nonce: '1' }, SECRET),
    secret: SECRET,
    at,
  };
}

const READ = {
  run: RUN,
  task: TASK,
  locator: 'https://gdpr-info.eu/art-30-gdpr/',
  took: 'Article 30 requires a record of processing activities for controllers over 250 staff',
};

test('a reported external read lands in the role name, in the log and in its own listing', () => {
  withStore((store) => {
    seed(store);
    const outcome = recordExternalReadAsRole(store, credential(), READ);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.ok === true && outcome.role, 'privacy');

    const listed = externalReadsFor(store, RUN);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.role, 'privacy', 'the role comes from the token, not the request');
    assert.equal(listed[0]?.locator, READ.locator);
    assert.match(listed[0]?.took ?? '', /Article 30/);

    const entry = readWorkLog(store, RUN).find((e) => e.action.endsWith(EXTERNAL_READ_ACTION));
    assert.ok(entry, 'it is also what the role did, in its own name, on the append-only log');
  });
});

test('a read that evidences nothing is refused rather than stored', () => {
  withStore((store) => {
    seed(store);
    const nothingTaken = recordExternalReadAsRole(store, credential(), { ...READ, took: '   ' });
    assert.equal(nothingTaken.ok, false);
    assert.match(nothingTaken.ok === false ? nothingTaken.reason : '', /evidences nothing/);

    const nowhere = recordExternalReadAsRole(store, credential(), { ...READ, locator: '' });
    assert.equal(nowhere.ok, false);
    assert.match(nowhere.ok === false ? nowhere.reason : '', /name where you read/);

    assert.equal(externalReadsFor(store, RUN).length, 0);
  });
});

test('a token for another task cannot record a read against this one', () => {
  withStore((store) => {
    seed(store);
    const wrongScope = {
      token: issueRoleToken(
        { run: RUN, task: 't-security', role: 'security', expiresAt: EXPIRES, nonce: '2' },
        SECRET,
      ),
      secret: SECRET,
      at: AT,
    };
    const denied = recordExternalReadAsRole(store, wrongScope, READ);
    assert.equal(denied.ok, false);
    assert.equal(denied.ok === false && denied.denial, 'wrong-task');
    assert.equal(externalReadsFor(store, RUN).length, 0);
  });
});

test('the cap bounds a looping role, and the cap event lands once rather than once per retry', () => {
  withStore((store) => {
    seed(store);
    for (let i = 0; i < EXTERNAL_READ_CAP; i += 1) {
      const ok = recordExternalReadAsRole(store, credential(), { ...READ, locator: `${READ.locator}#${String(i)}` });
      assert.equal(ok.ok, true);
    }
    const over = recordExternalReadAsRole(store, credential(), READ);
    assert.equal(over.ok, false);
    const again = recordExternalReadAsRole(store, credential(), READ);
    assert.equal(again.ok, false);

    assert.equal(externalReadsFor(store, RUN).length, EXTERNAL_READ_CAP);
    const capEvents = readWorkLog(store, RUN).filter((e) => e.action.endsWith(EXTERNAL_READ_CAP_ACTION));
    assert.equal(capEvents.length, 1, 'the log records that the window closed, not the shape of the loop');
  });
});

test('the table is append-only: a recorded read cannot be edited or deleted', () => {
  withStore((store) => {
    recordExternalRead(store, { ...READ, role: 'privacy', recordedAt: AT });
    assert.throws(
      () => store.db.prepare('UPDATE external_reads SET took = ?').run('something else'),
      /append-only/,
    );
    assert.throws(() => store.db.prepare('DELETE FROM external_reads').run(), /append-only/);
  });
});
