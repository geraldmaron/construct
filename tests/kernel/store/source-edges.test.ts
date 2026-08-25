/**
 * tests/kernel/store/source-edges.test.ts — the relationship substrate.
 *
 * Two properties carry the weight. The first mirrors `sources`: a relationship
 * is retired, never edited and never deleted, enforced by the database rather
 * than by callers remembering — a run assembled under a relationship keeps that
 * relationship readable afterwards. The second is the one that makes a
 * model-proposed relationship safe to have at all: proposing writes nothing
 * into the relationships table, and no path exists from a proposal to a live
 * relationship that does not pass a recorded decision.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import {
  addSource,
  decideProposal,
  retireSource,
  setWriteConsent,
} from '../../../src/kernel/store/sources.ts';
import {
  adoptProposedEdge,
  declareSourceEdge,
  getSourceEdge,
  proposedSourceEdge,
  proposeSourceEdge,
  relationPhrase,
  retireSourceEdge,
  reverseRelationPhrase,
  sourceEdgesAmong,
  sourceEdgesFor,
  sourceEdgesTouching,
} from '../../../src/kernel/store/source-edges.ts';

const AT = '2026-08-25T00:00:00.000Z';
const LATER = '2026-08-25T01:00:00.000Z';

function withStore<T>(fn: (store: ReturnType<typeof openStore>) => T): T {
  const fixture = sterile();
  const store = openStore(join(fixture.paths.dataDir, 'construct.db'));
  try {
    return fn(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

function twoSources(store: ReturnType<typeof openStore>): void {
  addSource(store, { id: 'src-a', workspace: 'ops', kind: 'directory', locator: '/strategy', addedAt: AT });
  addSource(store, { id: 'src-b', workspace: 'ops', kind: 'git', locator: '/repo', addedAt: AT });
}

const EDGE = {
  id: 'rel-1',
  workspace: 'ops',
  from: 'src-a',
  to: 'src-b',
  relation: 'governs' as const,
  note: 'the strategy sets what the repo is held to',
  declaredAt: AT,
};

test('a relationship is declared, listed, and retired, and its history stays', () => {
  withStore((store) => {
    twoSources(store);
    declareSourceEdge(store, EDGE);

    assert.deepEqual(
      sourceEdgesFor(store, 'ops').map((edge) => [edge.from, edge.relation, edge.to]),
      [['src-a', 'governs', 'src-b']],
    );
    assert.equal(getSourceEdge(store, 'rel-1')?.note, 'the strategy sets what the repo is held to');
    assert.deepEqual(sourceEdgesTouching(store, 'src-b').map((edge) => edge.id), ['rel-1']);

    retireSourceEdge(store, 'rel-1', LATER);
    assert.deepEqual(sourceEdgesFor(store, 'ops'), [], 'a retired relationship governs nothing');
    assert.deepEqual(sourceEdgesTouching(store, 'src-b'), []);
    assert.equal(
      sourceEdgesFor(store, 'ops', { includeRetired: true })[0]?.retiredAt,
      LATER,
      'and stays readable, because runs were assembled under it',
    );
  });
});

test('a relationship is retired, never edited and never deleted', () => {
  withStore((store) => {
    twoSources(store);
    declareSourceEdge(store, EDGE);
    assert.throws(
      () => store.db.prepare("UPDATE source_edges SET relation = 'feeds' WHERE id = ?").run('rel-1'),
      /retired, never edited/,
    );
    assert.throws(
      () => store.db.prepare('DELETE FROM source_edges WHERE id = ?').run('rel-1'),
      /retired, never deleted/,
    );
    retireSourceEdge(store, 'rel-1', LATER);
    assert.throws(
      () => retireSourceEdge(store, 'rel-1', LATER),
      /already retired/,
      'retiring twice is a caller who believed something false, not a no-op',
    );
  });
});

test('a relationship needs two live sources that are not the same source', () => {
  withStore((store) => {
    twoSources(store);
    assert.throws(
      () => declareSourceEdge(store, { ...EDGE, to: 'src-a' }),
      /does not stand in a relationship to itself/,
    );
    assert.throws(() => declareSourceEdge(store, { ...EDGE, to: 'src-gone' }), /no source src-gone/);
    assert.throws(
      () => declareSourceEdge(store, { ...EDGE, relation: 'informs' as 'governs' }),
      /unknown relationship "informs"/,
    );
    retireSource(store, 'src-b', LATER);
    assert.throws(() => declareSourceEdge(store, EDGE), /retired.*joins nothing/);
  });
});

test('the same pair may not be related the same way twice while the first stands', () => {
  withStore((store) => {
    twoSources(store);
    declareSourceEdge(store, EDGE);
    assert.throws(() => declareSourceEdge(store, { ...EDGE, id: 'rel-2' }), /UNIQUE/i);
    // The other direction is a different statement and is allowed.
    declareSourceEdge(store, { ...EDGE, id: 'rel-3', from: 'src-b', to: 'src-a' });
    assert.equal(sourceEdgesFor(store, 'ops').length, 2);
  });
});

test('ground assembly is offered only relationships with both ends in the ground it holds', () => {
  withStore((store) => {
    twoSources(store);
    addSource(store, { id: 'src-c', workspace: 'ops', kind: 'directory', locator: '/other', addedAt: AT });
    declareSourceEdge(store, EDGE);
    declareSourceEdge(store, { ...EDGE, id: 'rel-2', from: 'src-b', to: 'src-c', relation: 'feeds' });
    assert.deepEqual(sourceEdgesAmong(store, ['src-a', 'src-b']).map((e) => e.id), ['rel-1']);
    assert.deepEqual(sourceEdgesAmong(store, []).map((e) => e.id), []);
  });
});

test('a relationship reads out loud from either end', () => {
  assert.equal(relationPhrase('supersedes'), 'supersedes');
  assert.equal(reverseRelationPhrase('supersedes'), 'is superseded by');
  assert.equal(relationPhrase('contradicts'), reverseRelationPhrase('contradicts'));
});

const PROPOSAL = {
  id: 'prop-1',
  workspace: 'ops',
  run: null,
  source: 'src-a',
  change: 'relate /strategy supersedes /repo',
  justification: 'the strategy names the repo plan as replaced',
  proposedAt: AT,
};

const PROPOSED = {
  from: 'src-a',
  to: 'src-b',
  relation: 'supersedes' as const,
  note: 'the newer plan',
  recordedAt: AT,
};

test('proposing a relationship creates a row to decide on and no relationship at all', () => {
  withStore((store) => {
    twoSources(store);
    proposeSourceEdge(store, PROPOSAL, PROPOSED);
    assert.equal(proposedSourceEdge(store, 'prop-1')?.relation, 'supersedes');
    assert.deepEqual(sourceEdgesFor(store, 'ops'), [], 'nothing became live by being noticed');
  });
});

test('a proposed relationship is refused without a decision, standing consent or not', () => {
  withStore((store) => {
    twoSources(store);
    // The workspace's blanket yes to the low-risk class does not reach it: the
    // proposal is filed high-risk precisely because it reshapes future ground.
    setWriteConsent(store, 'ops', true, AT);
    proposeSourceEdge(store, PROPOSAL, PROPOSED);
    assert.throws(
      () => adoptProposedEdge(store, 'prop-1', 'adopted by decision', LATER),
      /no authority to apply/,
    );
    assert.deepEqual(sourceEdgesFor(store, 'ops'), [], 'and the refusal left nothing behind');
  });
});

test('a rejected relationship is not adopted by asking again', () => {
  withStore((store) => {
    twoSources(store);
    proposeSourceEdge(store, PROPOSAL, PROPOSED);
    decideProposal(store, 'prop-1', 'rejected', 'these two are not the same plan', LATER);
    assert.throws(() => adoptProposedEdge(store, 'prop-1', 'adopted', LATER), /was rejected/);
    assert.deepEqual(sourceEdgesFor(store, 'ops'), []);
  });
});

test('an approved relationship becomes live, once, and carries the words it was proposed in', () => {
  withStore((store) => {
    twoSources(store);
    proposeSourceEdge(store, PROPOSAL, PROPOSED);
    decideProposal(store, 'prop-1', 'approved', 'yes, the older one is past', LATER);
    const edge = adoptProposedEdge(store, 'prop-1', 'adopted by decision', LATER);

    assert.equal(edge.relation, 'supersedes');
    assert.equal(edge.note, 'the newer plan');
    assert.deepEqual(sourceEdgesFor(store, 'ops').map((e) => e.id), [edge.id]);
    assert.throws(() => adoptProposedEdge(store, 'prop-1', 'again', LATER), /already applied/);
    assert.equal(sourceEdgesFor(store, 'ops').length, 1);
  });
});

test('a proposal that proposes no relationship is not one this path can adopt', () => {
  withStore((store) => {
    twoSources(store);
    assert.throws(() => adoptProposedEdge(store, 'prop-none', 'adopted', LATER), /proposes no relationship/);
  });
});
