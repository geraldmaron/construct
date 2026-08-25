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
  docsLocatorContainerName,
  docsLocatorProblem,
  docsReadNamesLocatorContainer,
  engagementMode,
  getSource,
  githubLocatorProblem,
  latestSourceReads,
  markApplied,
  parseDocsLocator,
  pendingProposals,
  getProposal,
  proposeWrite,
  recordSourceRead,
  retireSource,
  setEngagementMode,
  setWriteConsent,
  sourceReadsFor,
  sourcesFor,
  setSourceDeclaration,
  setSourceShape,
  sourceDeclaration,
  sourceShape,
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

test('latestSourceReads is empty until a source has been read, then holds only its newest run', () => {
  withStore((store) => {
    declare(store);
    assert.deepEqual(latestSourceReads(store, 'src-1'), [], 'nothing recorded yet is not a run of nothing');

    recordSourceRead(store, {
      run: 'run-1',
      source: 'src-1',
      descriptor: 'issues in PROJ',
      coverage: 'complete',
      detail: '3 of 3',
      recordedAt: AT,
    });
    const first = latestSourceReads(store, 'src-1');
    assert.equal(first.length, 1);
    assert.equal(first[0]?.run, 'run-1');

    recordSourceRead(store, {
      run: 'run-2',
      source: 'src-1',
      descriptor: 'issues in PROJ',
      coverage: 'complete',
      detail: '4 of 4',
      recordedAt: LATER,
    });
    recordSourceRead(store, {
      run: 'run-2',
      source: 'src-1',
      descriptor: 'issues in PROJ closed',
      coverage: 'complete',
      detail: '1 of 1',
      recordedAt: LATER,
    });
    const latest = latestSourceReads(store, 'src-1');
    // Only run-2's rows come back — run-1's are history now, not the baseline.
    assert.equal(latest.length, 2);
    assert.ok(latest.every((r) => r.run === 'run-2'));
    assert.deepEqual(
      latest.map((r) => r.detail),
      ['4 of 4', '1 of 1'],
      'ascending order within the run, same as sourceReadsFor',
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
    // Standing consent needs to know the source is safe, so the source is
    // declared not sensitive; without a declaration it would wait for a person.
    setSourceDeclaration(
      store,
      'src-1',
      { authority: 'working', relevance: 'the tracker', sensitive: false },
      AT,
    );
    assert.equal(writeConsentAllowsLowRisk(store, 'acme'), false);
    setWriteConsent(store, 'acme', true, AT);
    propose(store, 'p-low', 'low');
    propose(store, 'p-high', 'high');
    markApplied(store, 'p-low', 'auto', LATER);
    assert.equal(decisionOf(store, 'p-low')?.basis, 'standing-consent');
    assert.throws(() => markApplied(store, 'p-high', 'auto', LATER), /high-risk never applies/);
  });
});

test('standing consent will not carry a change into a source nobody declared', () => {
  withStore((store) => {
    declare(store);
    setWriteConsent(store, 'acme', true, AT);
    propose(store, 'p-low', 'low');
    // No declaration on src-1: its safety is unknown, not assumed, so the
    // blanket yes does not reach it.
    assert.throws(() => markApplied(store, 'p-low', 'auto', LATER), /no declaration/);
  });
});

test('standing consent will not carry a change whose action a model chose', () => {
  withStore((store) => {
    declare(store);
    setSourceDeclaration(
      store,
      'src-1',
      { authority: 'working', relevance: 'the tracker', sensitive: false },
      AT,
    );
    setWriteConsent(store, 'acme', true, AT);
    proposeWrite(store, {
      id: 'p-model',
      workspace: 'acme',
      run: 'run-1',
      source: 'src-1',
      change: 'update p-model',
      justification: 'note line 4',
      risk: 'low',
      proposedAt: AT,
      actionSource: 'model',
    });
    assert.throws(() => markApplied(store, 'p-model', 'auto', LATER), /chosen by a model/);

    // The same finding, action left to the mechanical keyword default, does
    // ride the standing yes.
    propose(store, 'p-keyword', 'low');
    markApplied(store, 'p-keyword', 'auto', LATER);
    assert.equal(decisionOf(store, 'p-keyword')?.basis, 'standing-consent');
  });
});

test('a proposal with no recorded action origin does not ride standing consent', () => {
  withStore((store) => {
    declare(store);
    setSourceDeclaration(
      store,
      'src-1',
      { authority: 'working', relevance: 'the tracker', sensitive: false },
      AT,
    );
    setWriteConsent(store, 'acme', true, AT);
    // A write_proposals row with no proposal_action_sources companion — the
    // shape a proposal filed before that table existed has, and the shape a
    // model-chosen action left unrecorded would have. The apply gate must read
    // the absence as the refusing side, not wave it into the standing lane.
    store.db
      .prepare(
        `INSERT INTO write_proposals
           (id, workspace, run, source, change, justification, risk, proposed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('p-unrecorded', 'acme', 'run-1', 'src-1', 'update p-unrecorded', 'note', 'low', AT);
    assert.equal(getProposal(store, 'p-unrecorded')?.actionSource, 'model');
    assert.throws(() => markApplied(store, 'p-unrecorded', 'auto', LATER), /chosen by a model/);
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

test('a source nobody described reads null, so nothing downstream is handed a tier the user never stated', () => {
  withStore((store) => {
    declare(store);
    assert.equal(sourceDeclaration(store, 'src-1'), null);
  });
});

test('what a user says a source is survives the round trip, and restating it moves it', () => {
  withStore((store) => {
    declare(store);
    setSourceDeclaration(
      store,
      'src-1',
      { authority: 'aspirational', relevance: 'the 2027 wish list', sensitive: false },
      AT,
    );
    assert.deepEqual(sourceDeclaration(store, 'src-1'), {
      authority: 'aspirational',
      relevance: 'the 2027 wish list',
      sensitive: false,
    });
    setSourceDeclaration(
      store,
      'src-1',
      { authority: 'source-of-truth', relevance: 'the signed plan', sensitive: true },
      LATER,
    );
    assert.deepEqual(sourceDeclaration(store, 'src-1'), {
      authority: 'source-of-truth',
      relevance: 'the signed plan',
      sensitive: true,
    });
  });
});

test('a tier nobody defined and a description of a source that does not exist are refused, not stored', () => {
  withStore((store) => {
    declare(store);
    assert.throws(
      () =>
        setSourceDeclaration(
          store,
          'src-1',
          { authority: 'mostly-true' as never, relevance: '', sensitive: false },
          AT,
        ),
      /unknown authority/,
    );
    assert.throws(
      () =>
        setSourceDeclaration(
          store,
          'ghost',
          { authority: 'working', relevance: '', sensitive: false },
          AT,
        ),
      /no source ghost/,
    );
    assert.equal(sourceDeclaration(store, 'src-1'), null);
  });
});

/**
 * Standing consent is a judgment about a class of change made before anyone
 * knew where it would land. A source its owner called sensitive is outside it,
 * and the proof that this is the declaration doing the work rather than the
 * risk class is that the same low-risk proposal applies once a person decides
 * it.
 */
test('standing consent does not reach a source the user declared sensitive', () => {
  withStore((store) => {
    declare(store);
    setWriteConsent(store, 'acme', true, AT);
    setSourceDeclaration(
      store,
      'src-1',
      { authority: 'working', relevance: 'the customer tracker', sensitive: true },
      AT,
    );
    propose(store, 'p-low', 'low');
    assert.throws(() => markApplied(store, 'p-low', 'auto', LATER), /declared sensitive/);
    decideProposal(store, 'p-low', 'approved', 'read it and it is fine', LATER);
    markApplied(store, 'p-low', 'done', LATER);
    assert.equal(decisionOf(store, 'p-low')?.basis, 'human-approval');
  });
});

test('a source with no declared shape reads null, so the survey keeps its old default', () => {
  withStore((store) => {
    declare(store);
    assert.equal(sourceShape(store, 'src-1'), null);
  });
});

test('a shape is a setting, so declaring it twice moves it rather than failing', () => {
  withStore((store) => {
    declare(store);
    setSourceShape(store, 'src-1', { emphasis: 'code', cap: 200 }, AT);
    assert.deepEqual(sourceShape(store, 'src-1'), { emphasis: 'code', cap: 200 });
    setSourceShape(store, 'src-1', { emphasis: 'all', cap: 5 }, LATER);
    assert.deepEqual(sourceShape(store, 'src-1'), { emphasis: 'all', cap: 5 });
  });
});

test('an unknown emphasis or a cap that lists nothing is refused, not stored', () => {
  withStore((store) => {
    declare(store);
    assert.throws(
      () => setSourceShape(store, 'src-1', { emphasis: 'prose-ish' as never, cap: 10 }, AT),
      /unknown emphasis/,
    );
    assert.throws(() => setSourceShape(store, 'src-1', { emphasis: 'prose', cap: 0 }, AT), /positive/);
    assert.equal(sourceShape(store, 'src-1'), null);
  });
});

test('a docs locator that names its provider and container is declared like any other source', () => {
  withStore((store) => {
    addSource(store, {
      id: 'src-docs',
      workspace: 'acme',
      kind: 'docs',
      locator: 'confluence:space:ENG',
      addedAt: AT,
    });
    assert.equal(getSource(store, 'src-docs')?.locator, 'confluence:space:ENG');

    addSource(store, {
      id: 'src-drive',
      workspace: 'acme',
      kind: 'docs',
      locator: 'google-docs:folder:1AbC-drive-id',
      addedAt: AT,
    });
    addSource(store, {
      id: 'src-notion',
      workspace: 'acme',
      kind: 'docs',
      locator: 'notion:workspace:Product/Specs',
      addedAt: AT,
    });
    assert.equal(sourcesFor(store, 'acme').length, 3);
  });
});

test('a docs locator missing its provider, container, or id is refused in plain language, not stored', () => {
  withStore((store) => {
    const declareDocs = (locator: string): void =>
      addSource(store, { id: 'src-bad', workspace: 'acme', kind: 'docs', locator, addedAt: AT });

    // A blank locator is caught by the same generic check every kind shares
    // (exercised elsewhere); what is specific to docs starts at "wiki".
    assert.throws(() => declareDocs('wiki'), /names no provider/);
    assert.throws(() => declareDocs('confluence:ENG'), /names no container/);
    assert.throws(() => declareDocs('confluence::ENG'), /leaves it empty/);
    assert.throws(() => declareDocs('confluence:space:'), /leaves the id empty/);
    assert.throws(
      () => declareDocs('sharepoint:site:ENG'),
      /not a docs provider Construct knows \(google-docs, confluence, notion\)/,
    );
    assert.equal(sourcesFor(store, 'acme').length, 0);
  });
});

test('a github locator that names an owner and repository is declared like any other source', () => {
  withStore((store) => {
    addSource(store, {
      id: 'src-gh',
      workspace: 'acme',
      kind: 'github',
      locator: 'anthropics/claude-code',
      addedAt: AT,
    });
    assert.equal(getSource(store, 'src-gh')?.locator, 'anthropics/claude-code');
    assert.equal(sourcesFor(store, 'acme').length, 1);
  });
});

test('a github locator missing its owner or repository, or naming more than one, is refused in plain language, not stored', () => {
  withStore((store) => {
    const declareGithub = (locator: string): void =>
      addSource(store, { id: 'src-bad', workspace: 'acme', kind: 'github', locator, addedAt: AT });

    // A blank locator is caught by the same generic check every kind shares
    // (exercised elsewhere); what is specific to github starts at "claude-code".
    assert.throws(() => declareGithub('claude-code'), /has no "\/" separating them/);
    assert.throws(() => declareGithub('/claude-code'), /leaves it empty/);
    assert.throws(() => declareGithub('anthropics/'), /leaves the repository empty/);
    assert.throws(() => declareGithub('anthropics/claude-code/issues/4'), /names more than that/);
    assert.equal(sourcesFor(store, 'acme').length, 0);
  });
});

test('githubLocatorProblem names an empty locator directly, the one shape addSource never lets reach it, and clears a well-formed one', () => {
  assert.match(githubLocatorProblem('') ?? '', /names no repository/);
  assert.equal(githubLocatorProblem('anthropics/claude-code'), null);
});

test('docsLocatorProblem names an empty locator directly, the one shape addSource never lets reach it', () => {
  assert.match(docsLocatorProblem('') ?? '', /names nothing to read/);
  assert.equal(parseDocsLocator(''), null);
});

test('parseDocsLocator and docsLocatorProblem agree: one succeeds exactly where the other has nothing to report', () => {
  assert.deepEqual(parseDocsLocator('confluence:space:ENG'), {
    provider: 'confluence',
    container: 'space',
    id: 'ENG',
  });
  assert.equal(docsLocatorProblem('confluence:space:ENG'), null);

  assert.equal(parseDocsLocator('not-a-docs-locator'), null);
  assert.match(docsLocatorProblem('not-a-docs-locator') ?? '', /names no provider/);

  assert.equal(docsLocatorContainerName({ provider: 'confluence', container: 'space', id: 'ENG' }), 'space ENG');
  assert.equal(
    docsLocatorContainerName({ provider: 'notion', container: 'workspace', id: 'Product/Specs' }),
    'workspace Product',
  );
});

test('a read row is auditable against its locator: the descriptor must name the same container', () => {
  // The house example this convention exists for: "14 of 14 pages in space
  // X" is checkable only if X is the container the locator actually declared.
  assert.equal(
    docsReadNamesLocatorContainer('confluence:space:ENG', '14 of 14 pages in space ENG'),
    true,
  );
  // Case is not the audit: a reader writing "Space ENG" still named the same container.
  assert.equal(
    docsReadNamesLocatorContainer('confluence:space:ENG', '14 of 14 pages in Space ENG'),
    true,
  );
  // A descriptor naming a different container fails the check rather than
  // passing on the strength of the source id alone.
  assert.equal(
    docsReadNamesLocatorContainer('confluence:space:ENG', '14 of 14 pages in space OTHER'),
    false,
  );
  // A locator that never parsed names no container, so nothing can check
  // against it — this reads as unauditable, not as a pass by default.
  assert.equal(docsReadNamesLocatorContainer('wiki', '14 of 14 pages in space ENG'), false);
});

test('a retired source is done being described', () => {
  withStore((store) => {
    declare(store);
    retireSource(store, 'src-1', LATER);
    assert.throws(
      () =>
        setSourceDeclaration(
          store,
          'src-1',
          { authority: 'working', relevance: 'too late', sensitive: false },
          LATER,
        ),
      /was retired at/,
    );
    assert.equal(sourceDeclaration(store, 'src-1'), null);
  });
});
