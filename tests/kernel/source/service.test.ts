/**
 * tests/kernel/source/service.test.ts — declarations sync into state, locators
 * are checked by kind, refresh dedupes by digest and records reachability,
 * and status names authority and freshness.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSourceService } from '../../../src/kernel/source/service.ts';
import { locatorProblem, parseDocsLocator } from '../../../src/kernel/source/locators.ts';
import { describeConnector, connectorDeclaration, BUILTIN_CONNECTOR_DECLARATIONS, type SourceReader } from '../../../src/kernel/source/connector.ts';
import { validateSourcesFile } from '../../../src/kernel/project/sources-file.ts';
import { getSource, listSources, authorityOf } from '../../../src/kernel/state/sources.ts';
import { listObservations } from '../../../src/kernel/state/drift.ts';
import { freshStore, clock } from '../state/support.ts';

const file = (sources: unknown[]) => validateSourcesFile({ format: 'construct-sources', formatVersion: 2, sources }, 'sources.json');
const jira = { id: 'jira', kind: 'jira', purpose: 'work tracking', locator: 'PROJ', authorityLevel: 'authoritative', authoritativeFor: ['work_item', 'status'], notAuthoritativeFor: ['capacity'], sensitivity: 'internal', capabilities: { read: true, write: true } };
const docs = { id: 'docs', kind: 'docs', purpose: 'design docs', locator: 'confluence:space:ENG', authorityLevel: 'authoritative', authoritativeFor: ['requirement'], sensitivity: 'internal', freshnessHours: 24 };

test('locators are checked by kind with a sentence that says the expected shape', () => {
  assert.equal(locatorProblem('github', 'acme/ledger'), null);
  assert.match(locatorProblem('github', 'acme')!, /<owner>\/<repo>/);
  assert.match(locatorProblem('github', 'acme/ledger/issues/4')!, /names more than that/);
  assert.equal(locatorProblem('jira', 'PROJ'), null);
  assert.match(locatorProblem('jira', 'proj-1')!, /project key/);
  assert.deepEqual(parseDocsLocator('notion:workspace:Product/Specs'), { provider: 'notion', container: 'workspace', id: 'Product/Specs' });
  assert.match(locatorProblem('docs', 'wiki')!, /names no provider/);
  assert.match(locatorProblem('docs', 'sharepoint:site:x')!, /not a docs provider/);
  assert.match(locatorProblem('directory', 'relative/path')!, /absolute path/);
  assert.match(locatorProblem('directory', '/a/../etc')!, /\.\./);
  assert.match(locatorProblem('git', 'https://user:token@github.com/a/b.git')!, /no credentials/);
  assert.equal(locatorProblem('git', 'git@github.com:a/b.git'), null);
  assert.equal(locatorProblem('hris', null), null);
  assert.match(locatorProblem('hris', '  ')!, /names nothing/);
});

test('connector declarations say what a system supplies and what it is commonly mistaken for', () => {
  const j = connectorDeclaration('jira')!;
  assert.ok(j.supplies.includes('throughput_history'));
  assert.ok(j.commonlyMistakenFor.includes('capacity'));
  assert.match(describeConnector(j), /not authoritative for capacity/);
  assert.match(describeConnector(j), /Credentials stay with the environment/);
  const h = connectorDeclaration('hris')!;
  assert.equal(h.write, false);
  assert.deepEqual(h.writeTiers, []);
  for (const c of BUILTIN_CONNECTOR_DECLARATIONS) assert.ok(c.notes.length > 0 && c.supplies.length > 0);
  assert.equal(connectorDeclaration('salesforce'), null);
});

test('declarations sync into state: add, update, retire, and never touch local sources', () => {
  const fx = freshStore();
  try {
    const at = clock();
    const svc = createSourceService(fx.store, { readers: new Map() });
    svc.addLocal({ id: 'scratch', kind: 'directory', purpose: 'local notes', locator: '/tmp/notes', authorityLevel: 'informative', authoritativeFor: [], notAuthoritativeFor: [], freshnessHours: null, sensitivity: 'confidential' }, at());

    const first = svc.syncDeclarations(file([jira, docs]), at());
    assert.deepEqual(first, { added: ['jira', 'docs'], updated: [], retired: [] });
    assert.equal(getSource(fx.store, 'jira')?.origin, 'declared');
    assert.deepEqual(authorityOf(fx.store, 'jira'), { authoritativeFor: ['status', 'work_item'], notAuthoritativeFor: ['capacity'] });

    const again = svc.syncDeclarations(file([jira, docs]), at());
    assert.deepEqual(again, { added: [], updated: [], retired: [] });

    const changed = svc.syncDeclarations(file([{ ...jira, authoritativeFor: ['work_item'], notAuthoritativeFor: ['capacity', 'status'], purpose: 'tickets' }]), at());
    assert.deepEqual(changed, { added: [], updated: ['jira'], retired: ['docs'] });
    assert.deepEqual(authorityOf(fx.store, 'jira'), { authoritativeFor: ['work_item'], notAuthoritativeFor: ['capacity', 'status'] });
    assert.equal(getSource(fx.store, 'jira')?.purpose, 'tickets');
    assert.equal(getSource(fx.store, 'docs')?.status, 'retired');
    assert.equal(getSource(fx.store, 'scratch')?.status, 'active');
    assert.equal(listSources(fx.store, { status: 'active' }).length, 2);

    assert.throws(() => svc.syncDeclarations(file([{ ...jira, id: 'scratch', kind: 'directory', locator: '/x' }]), at()), /exists locally/);
    assert.throws(() => svc.syncDeclarations(file([docs]), at()), /was retired; declare it under a new id/);
    assert.throws(() => svc.syncDeclarations(file([{ ...jira, locator: 'bad key' }]), at()), /project key/);
  } finally {
    fx.cleanup();
  }
});

test('a declared locator wins; a sensitive local locator survives a sync that declares none', () => {
  const fx = freshStore();
  try {
    const at = clock();
    const svc = createSourceService(fx.store, { readers: new Map() });
    svc.syncDeclarations(file([{ ...docs, locator: undefined }]), at());
    assert.equal(getSource(fx.store, 'docs')?.locator, null);
    svc.setLocalLocator('docs', 'confluence:space:SECRET', at());
    svc.syncDeclarations(file([{ ...docs, locator: undefined, purpose: 'renamed' }]), at());
    assert.equal(getSource(fx.store, 'docs')?.locator, 'confluence:space:SECRET');
    assert.equal(getSource(fx.store, 'docs')?.purpose, 'renamed');
    assert.throws(() => svc.setLocalLocator('docs', 'nonsense', at()), /names no provider/);
  } finally {
    fx.cleanup();
  }
});

test('refresh records a snapshot once per digest, marks reachability, and observes changes', async () => {
  const fx = freshStore();
  try {
    const at = clock();
    let n = 0;
    const nextId = () => `id-${String(++n)}`;
    let digest = 'aaa';
    let fail = false;
    const reader: SourceReader = async ({ locator }) => {
      if (fail) throw new Error('401 from Jira');
      return { outcome: 'read', report: { digest, summary: `read ${locator ?? ''}`, evidence: 'witnessed', items: [{ externalRef: 'PROJ-1', kind: 'work_item', name: 'Ship' }] } };
    };
    const svc = createSourceService(fx.store, { readers: new Map([['jira', reader]]) });
    svc.syncDeclarations(file([jira, docs]), at());

    const first = await svc.refresh('jira', at(), nextId);
    assert.equal(first.outcome, 'changed');
    assert.equal(getSource(fx.store, 'jira')?.reachability, 'reachable');
    const second = await svc.refresh('jira', at(), nextId);
    assert.equal(second.outcome, 'unchanged');
    assert.equal(second.snapshot?.id, first.snapshot?.id);
    digest = 'bbb';
    const third = await svc.refresh('jira', at(), nextId);
    assert.equal(third.outcome, 'changed');
    assert.deepEqual(listObservations(fx.store, { sourceId: 'jira' }).map((o) => o.kind), ['source.changed', 'source.changed']);

    fail = true;
    const down = await svc.refresh('jira', at(), nextId);
    assert.equal(down.outcome, 'unreachable');
    assert.equal(down.reason, '401 from Jira');
    assert.equal(getSource(fx.store, 'jira')?.reachability, 'unreachable');

    const noReader = await svc.refresh('docs', at(), nextId);
    assert.equal(noReader.outcome, 'unreachable');
    assert.match(noReader.reason!, /nothing in this session can read a docs source/);

    const status = svc.status('jira', at());
    assert.equal(status.freshness, 'no_expectation');
    assert.deepEqual(status.notAuthoritativeFor, ['capacity']);
    assert.equal(svc.status('docs', at()).freshness, 'never_read');
    const summary = svc.summary(at());
    assert.equal(summary.total, 2);
    assert.equal(summary.unreachable, 2);
    assert.equal(summary.neverRead, 1);
  } finally {
    fx.cleanup();
  }
});
