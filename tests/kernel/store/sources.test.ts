/**
 * tests/kernel/store/sources.test.ts — the grounding surfaces.
 *
 * The properties held here are the write disciplines, not conveniences: a
 * source retires and never edits or deletes, provenance is append-only and
 * refuses to cite a source that does not exist, a proposal cannot apply
 * without authority, a rejection cannot be applied over, and high risk never
 * rides standing consent. Each is a property of the store — triggers and
 * refusing write paths — rather than of callers behaving.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import {
  addSource,
  decideProposal,
  decisionOf,
  engagementMode,
  getSource,
  markApplied,
  pendingProposals,
  proposeWrite,
  recordSourceRead,
  retireSource,
  setEngagementMode,
  setWriteConsent,
  sourceReadsFor,
  sourcesFor,
  writeConsentAllowsLowRisk,
} from '../../../src/kernel/store/sources.ts';

const AT = '2026-08-05T00:00:00.000Z';
const LATER = '2026-08-05T01:00:00.000Z';

function withStore<T>(fn: (store: ReturnType<typeof openStore>) => T): T {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    return fn(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

function declare(store: ReturnType<typeof openStore>, id = 'src-1'): void {
  addSource(store, { id, workspace: 'acme', kind: 'jira', locator: 'PROJ', addedAt: AT });
}

test('a source is listed while active and excluded once retired, but never gone', () => {
  withStore((store) => {
    declare(store);
    assert.equal(sourcesFor(store, 'acme').length, 1);
    retireSource(store, 'src-1', LATER);
    assert.equal(sourcesFor(store, 'acme').length, 0);
    assert.equal(sourcesFor(store, 'acme', { includeRetired: true }).length, 1);
    assert.equal(getSource(store, 'src-1')?.retiredAt, LATER);
  });
});

test('retiring twice is an error, and a retired source cannot be revived or edited', () => {
  withStore((store) => {
    declare(store);
    retireSource(store, 'src-1', LATER);
    assert.throws(() => retireSource(store, 'src-1', LATER), /already retired/);
    assert.throws(() =>
      store.db.prepare('UPDATE sources SET retired_at = NULL WHERE id = ?').run('src-1'),
    );
    assert.throws(() => store.db.prepare('DELETE FROM sources WHERE id = ?').run('src-1'));
  });
});

test('a duplicate active declaration is refused; re-declaring after retirement is allowed', () => {
  withStore((store) => {
    declare(store);
    assert.throws(() =>
      addSource(store, { id: 'src-2', workspace: 'acme', kind: 'jira', locator: 'PROJ', addedAt: AT }),
    );
    retireSource(store, 'src-1', LATER);
    addSource(store, { id: 'src-2', workspace: 'acme', kind: 'jira', locator: 'PROJ', addedAt: LATER });
    assert.equal(sourcesFor(store, 'acme').length, 1);
  });
});

test('sources are workspace-scoped: another workspace does not see them', () => {
  withStore((store) => {
    declare(store);
    assert.equal(sourcesFor(store, 'other').length, 0);
  });
});

test('engagement mode defaults to team and records as a changeable setting', () => {
  withStore((store) => {
    assert.equal(engagementMode(store, 'acme'), 'team');
    setEngagementMode(store, 'acme', 'seat', AT);
    assert.equal(engagementMode(store, 'acme'), 'seat');
    setEngagementMode(store, 'acme', 'team', LATER);
    assert.equal(engagementMode(store, 'acme'), 'team');
  });
});

test('provenance refuses an unknown source and is append-only once written', () => {
  withStore((store) => {
    assert.throws(
      () =>
        recordSourceRead(store, {
          run: 'run-1',
          source: 'ghost',
          descriptor: 'issues',
          coverage: 'complete',
          detail: '0 of 0',
          recordedAt: AT,
        }),
      /no source ghost/,
    );
    declare(store);
    recordSourceRead(store, {
      run: 'run-1',
      source: 'src-1',
      descriptor: 'issues in PROJ',
      coverage: 'unreachable',
      detail: 'connector returned 401',
      recordedAt: AT,
    });
    const reads = sourceReadsFor(store, 'run-1');
    assert.equal(reads.length, 1);
    assert.equal(reads[0]?.coverage, 'unreachable');
    assert.throws(() => store.db.prepare('DELETE FROM source_reads WHERE run = ?').run('run-1'));
    assert.throws(() =>
      store.db.prepare("UPDATE source_reads SET coverage = 'complete' WHERE run = ?").run('run-1'),
    );
  });
});

test('a proposal without justification or with an unknown source does not exist', () => {
  withStore((store) => {
    declare(store);
    assert.throws(
      () =>
        proposeWrite(store, {
          id: 'p1',
          workspace: 'acme',
          run: null,
          source: 'src-1',
          change: 'close PROJ-9',
          justification: '   ',
          risk: 'low',
          proposedAt: AT,
        }),
      /no justification/,
    );
    assert.throws(
      () =>
        proposeWrite(store, {
          id: 'p1',
          workspace: 'acme',
          run: null,
          source: 'ghost',
          change: 'close PROJ-9',
          justification: 'note line 4',
          risk: 'low',
          proposedAt: AT,
        }),
      /no source ghost/,
    );
  });
});

function propose(
  store: ReturnType<typeof openStore>,
  id: string,
  risk: 'low' | 'high' = 'low',
): void {
  proposeWrite(store, {
    id,
    workspace: 'acme',
    run: 'run-1',
    source: 'src-1',
    change: `update ${id}`,
    justification: 'note line 4',
    risk,
    proposedAt: AT,
  });
}

test('applying needs authority: approval applies, bare pending does not', () => {
  withStore((store) => {
    declare(store);
    propose(store, 'p1');
    assert.throws(() => markApplied(store, 'p1', 'done', LATER), /no authority/);
    decideProposal(store, 'p1', 'approved', 'looks right', AT);
    markApplied(store, 'p1', 'done', LATER);
    const decision = decisionOf(store, 'p1');
    assert.equal(decision?.verdict, 'applied');
    assert.equal(decision?.basis, 'human-approval');
  });
});

test('standing consent applies low risk only; high risk still demands a human', () => {
  withStore((store) => {
    declare(store);
    assert.equal(writeConsentAllowsLowRisk(store, 'acme'), false);
    setWriteConsent(store, 'acme', true, AT);
    propose(store, 'p-low', 'low');
    propose(store, 'p-high', 'high');
    markApplied(store, 'p-low', 'auto', LATER);
    assert.equal(decisionOf(store, 'p-low')?.basis, 'standing-consent');
    assert.throws(() => markApplied(store, 'p-high', 'auto', LATER), /high-risk never applies/);
  });
});

test('a rejection is final against apply, and applied is final against everything', () => {
  withStore((store) => {
    declare(store);
    propose(store, 'p1');
    decideProposal(store, 'p1', 'rejected', 'wrong ticket', AT);
    assert.throws(() => markApplied(store, 'p1', 'anyway', LATER), /rejected/);
    propose(store, 'p2');
    decideProposal(store, 'p2', 'approved', 'fine', AT);
    markApplied(store, 'p2', 'done', LATER);
    assert.throws(() => markApplied(store, 'p2', 'again', LATER), /already applied/);
    assert.throws(() => decideProposal(store, 'p2', 'rejected', 'too late', LATER), /already applied/);
  });
});

test('pending lists only undecided proposals, and proposal rows are immutable', () => {
  withStore((store) => {
    declare(store);
    propose(store, 'p1');
    propose(store, 'p2');
    decideProposal(store, 'p1', 'approved', 'fine', AT);
    const pending = pendingProposals(store, 'acme');
    assert.deepEqual(
      pending.map((p) => p.id),
      ['p2'],
    );
    assert.throws(() =>
      store.db.prepare("UPDATE write_proposals SET change = 'x' WHERE id = ?").run('p2'),
    );
    assert.throws(() => store.db.prepare('DELETE FROM write_proposals WHERE id = ?').run('p2'));
  });
});
