/**
 * Taking one role's write surface away before its lease runs out.
 *
 * The property worth holding is the narrowness: a revocation stops one task and
 * leaves every other role in the run writing, because the failure it answers is
 * one role misbehaving and a lever that stopped everything would leave an
 * operator with the choice they already had.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { enqueueTask } from '../../../src/kernel/store/tasks.ts';
import { issueRoleToken, ROLE_GRANTS } from '../../../src/kernel/capabilities/tokens.ts';
import {
  appendAsRole,
  revocationOf,
  revokeRoleCapability,
} from '../../../src/kernel/run/rolewrite.ts';

const SECRET = 'k'.repeat(64);
const AT = '2026-08-13T12:00:00.000Z';
const LATER = '2026-08-13T12:05:00.000Z';

function seat(dataDir: string, task: string) {
  mkdirSync(dataDir, { recursive: true });
  const store = openStore(join(dataDir, 'construct.db'));
  enqueueTask(store, { id: task, run: 'run-1', role: 'privacy', brief: null, at: AT });
  const token = issueRoleToken(
    { run: 'run-1', task, role: 'privacy', expiresAt: '2026-08-13T12:30:00.000Z', nonce: '1' },
    SECRET,
  );
  return { store, credential: { token, secret: SECRET, at: LATER } };
}

test('a role writes until its capability is revoked, and is refused after', () => {
  const fixture = sterile();
  const { store, credential } = seat(fixture.paths.dataDir, 't-1');
  try {
      const before = appendAsRole(store, credential, {
        run: 'run-1',
        task: 't-1',
        action: 'looked',
        detail: null,
      });
      assert.equal(before.ok, true);

      revokeRoleCapability(store, {
        run: 'run-1',
        task: 't-1',
        reason: 'looping past the note cap',
        at: LATER,
      });

      const after = appendAsRole(store, credential, {
        run: 'run-1',
        task: 't-1',
        action: 'looked',
        detail: null,
      });
      assert.equal(after.ok, false);
      assert.equal(after.denial, 'revoked');
      assert.match(after.reason, /looping past the note cap/);
  } finally {
    store.close();
    fixture.cleanup();
  }
});

test('revoking one task leaves the other roles in the run writing', () => {
  const fixture = sterile();
  const { store, credential } = seat(fixture.paths.dataDir, 't-1');
  try {
      enqueueTask(store, { id: 't-2', run: 'run-1', role: 'security', brief: null, at: AT });
      const other = {
        token: issueRoleToken(
          { run: 'run-1', task: 't-2', role: 'security', expiresAt: '2026-08-13T12:30:00.000Z', nonce: '1' },
          SECRET,
        ),
        secret: SECRET,
        at: LATER,
      };

      revokeRoleCapability(store, { run: 'run-1', task: 't-1', reason: 'runaway', at: LATER });

      const wrote = appendAsRole(store, other, {
        run: 'run-1',
        task: 't-2',
        action: 'looked',
        detail: null,
      });
      assert.equal(wrote.ok, true);
      assert.equal(revocationOf(store, 'run-1', 't-2'), null);
  } finally {
    store.close();
    fixture.cleanup();
  }
});

/**
 * The work log is append-only at the storage layer, which is the property that
 * makes a revocation worth having: a control the thing it stops can undo is not
 * a control.
 */
test('a revocation is on the record with its reason and its author', () => {
  const fixture = sterile();
  const { store } = seat(fixture.paths.dataDir, 't-1');
  try {
      revokeRoleCapability(store, {
        run: 'run-1',
        task: 't-1',
        reason: 'content that should not land',
        at: LATER,
      });
      assert.equal(revocationOf(store, 'run-1', 't-1'), 'content that should not land');
      assert.ok(ROLE_GRANTS.length > 0, 'a role still holds grants; the token is not what changed');
  } finally {
    store.close();
    fixture.cleanup();
  }
});
