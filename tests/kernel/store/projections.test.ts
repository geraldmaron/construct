/**
 * tests/kernel/store/projections.test.ts — the two ways a projection row is
 * written, and the difference between them.
 *
 * An import writes the whole snapshot, because the tracker is the authority on
 * its own row. A crossing from Construct writes through the authority filter,
 * and the properties held here are what that filter is for: a tracker-owned
 * field the tracker recorded survives an assertion that tries to change it, a
 * tracker-owned field an assertion invents never reaches the snapshot at all,
 * and the audit copy of what was asserted is preserved either way — the filter
 * governs the reconcilable snapshot, never the evidence.
 *
 * A crossing is marked in sync only by a caller that has been told it landed,
 * so that mark is its own step rather than a side effect of writing the row.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import type { Store } from '../../../src/kernel/store/open.ts';
import {
  getProjection,
  markProjectionSynced,
  projectDomainFields,
  putProjection,
} from '../../../src/kernel/store/projections.ts';
import { buildProjection } from '../../../src/kernel/tracker/projection.ts';
import { mappedFieldsByAuthority } from '../../../src/kernel/tracker/authority.ts';

const AT = '2026-08-13T00:00:00.000Z';
const LATER = '2026-08-14T00:00:00.000Z';

function withStore(fn: (store: Store) => void): void {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    fn(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

/** What an import of one live issue leaves behind: every field, both sides. */
function imported(store: Store): void {
  putProjection(
    store,
    buildProjection(
      {
        id: 'PROJ-14',
        title: 'ship the onboarding flow',
        description: 'as agreed in the kickoff',
        status: 'in progress',
        assignee: 'dana',
        priority: 'P2',
        labels: ['onboarding'],
      },
      { tracker: 'jira', workspace: 'acme', importedAt: AT },
    ),
  );
}

test('a domain assertion moves the fields it owns and leaves every tracker-owned one exactly as found', () => {
  withStore((store) => {
    imported(store);
    projectDomainFields(
      store,
      buildProjection(
        {
          id: 'PROJ-14',
          title: 'ship the onboarding flow by Q4',
          description: 'as agreed in the kickoff\n\nWhy: note:n-1#L3',
          // The assertion asks for all four anyway, which is the case the
          // filter exists for: a caller that means well and is still wrong.
          status: 'done',
          assignee: 'construct',
          priority: 'P0',
          labels: [],
        },
        { tracker: 'jira', workspace: 'acme', importedAt: LATER },
      ),
    );

    const stored = getProjection(store, 'jira:PROJ-14');
    assert.ok(stored);
    assert.equal(stored.fields.title, 'ship the onboarding flow by Q4', 'the domain field is projected');
    assert.match(String(stored.fields.description), /note:n-1#L3/);
    assert.equal(stored.fields.status, 'in progress', 'the tracker still owns its status');
    assert.equal(stored.fields.assignee, 'dana');
    assert.equal(stored.fields.priority, 'P2');
    assert.deepEqual(stored.fields.labels, ['onboarding']);
    // And the row still says who owns what, so a later reconcile reads the
    // same rule this write obeyed.
    assert.equal(stored.field_authority.status, 'tracker');
    assert.equal(stored.field_authority.title, 'domain');
  });
});

test('no field the tracker owns reaches the snapshot on a first assertion either', () => {
  withStore((store) => {
    const asserted: Record<string, unknown> = { id: 'PROJ-9', title: 'a new one', description: 'why' };
    for (const field of mappedFieldsByAuthority().tracker) asserted[field] = 'asserted';
    projectDomainFields(
      store,
      buildProjection(asserted, { tracker: 'jira', workspace: 'acme', importedAt: AT }),
    );

    const stored = getProjection(store, 'jira:PROJ-9');
    assert.ok(stored);
    // Asked of the map rather than of a list kept here, so a field that changes
    // sides changes this test with it.
    for (const field of mappedFieldsByAuthority().tracker) {
      assert.equal(stored.fields[field], undefined, `${field} is the tracker's, so nothing asserted it`);
      assert.equal(stored.field_authority[field], undefined);
    }
    assert.equal(stored.fields.title, 'a new one');
    // The audit copy is untouched by the filter: what Construct proposed is
    // exactly what an auditor needs to be able to read back.
    assert.equal((stored.raw_record as Record<string, unknown>).status, 'asserted');
  });
});

test('the audit copy of the first assertion survives every assertion after it', () => {
  withStore((store) => {
    projectDomainFields(
      store,
      buildProjection({ id: 'PROJ-9', title: 'first' }, { tracker: 'jira', importedAt: AT }),
    );
    projectDomainFields(
      store,
      buildProjection({ id: 'PROJ-9', title: 'second' }, { tracker: 'jira', importedAt: LATER }),
    );
    const stored = getProjection(store, 'jira:PROJ-9');
    assert.equal(stored?.fields.title, 'second');
    assert.equal((stored?.raw_record as Record<string, unknown>).title, 'first');
    assert.equal(stored?.importedAt, AT, 'and the row keeps when it was first written');
  });
});

test('a crossing is marked in sync only by name, and says so when there was no row to mark', () => {
  withStore((store) => {
    projectDomainFields(
      store,
      buildProjection({ id: 'PROJ-9', title: 'first' }, { tracker: 'jira', importedAt: AT }),
    );
    assert.equal(getProjection(store, 'jira:PROJ-9')?.state, 'projected');
    assert.equal(getProjection(store, 'jira:PROJ-9')?.reconciledAt, null);

    assert.equal(markProjectionSynced(store, 'jira:PROJ-9', LATER), true);
    assert.equal(getProjection(store, 'jira:PROJ-9')?.state, 'in_sync');
    assert.equal(getProjection(store, 'jira:PROJ-9')?.reconciledAt, LATER);

    assert.equal(markProjectionSynced(store, 'jira:nothing-here', LATER), false);
  });
});
