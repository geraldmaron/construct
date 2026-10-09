/**
 * tests/kernel/source/service.test.ts — declarations sync into state, locators
 * are checked by kind, refresh dedupes by digest and records reachability,
 * status names authority and freshness, and a host's report keeps each
 * item's address, keeps its text without credentials, and says when it cut.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSourceService, REPORTED_TEXT_CAP } from '../../../src/kernel/source/service.ts';
import { locatorProblem, parseDocsLocator } from '../../../src/kernel/source/locators.ts';
import { describeConnector, connectorDeclaration, BUILTIN_CONNECTOR_DECLARATIONS, type SourceReader } from '../../../src/kernel/source/connector.ts';
import { validateSourcesFile } from '../../../src/kernel/project/sources-file.ts';
import { getSource, listSources, authorityOf } from '../../../src/kernel/state/sources.ts';
import { listObservations, recordObservation } from '../../../src/kernel/state/drift.ts';
import { currentManifest } from '../../../src/kernel/source/manifest.ts';
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

test('declarations sync into state: add, update, retire, and leave local sources alone', () => {
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

    assert.throws(() => svc.syncDeclarations(file([{ ...jira, id: 'scratch' }]), at()), /scratch exists on this machine as a directory source; declare the jira one under a new id/);
    assert.equal(getSource(fx.store, 'scratch')?.origin, 'local', 'a refused sync changes nothing');
    assert.throws(() => svc.syncDeclarations(file([docs]), at()), /was retired; declare it under a new id/);
    assert.throws(() => svc.syncDeclarations(file([{ ...jira, locator: 'bad key' }]), at()), /project key/);
  } finally {
    fx.cleanup();
  }
});

test('committing a local source under its own id and kind makes it declared and keeps what was read from it', () => {
  const fx = freshStore();
  try {
    const at = clock();
    const svc = createSourceService(fx.store, { readers: new Map() });
    svc.addLocal({ id: 'jira', kind: 'jira', purpose: 'named by the person', locator: 'PROJ', authorityLevel: 'informative', authoritativeFor: [], notAuthoritativeFor: [], freshnessHours: null, sensitivity: 'confidential' }, at());
    let n = 0;
    svc.reportRead('jira', { items: [{ ref: 'PROJ-1', title: 'Retry policy', updatedAt: '2026-09-01', text: 'retries back off over 24h' }] }, at(), () => `snap-${String((n += 1))}`);
    const synced = svc.syncDeclarations(file([{ ...jira, locator: undefined }]), at());
    assert.deepEqual(synced, { added: [], updated: ['jira'], retired: [] });
    const s = getSource(fx.store, 'jira')!;
    assert.equal(s.origin, 'declared');
    assert.equal(s.authorityLevel, 'authoritative', 'the committed declaration governs');
    assert.equal(s.sensitivity, 'internal');
    assert.equal(s.locator, 'PROJ', 'a local locator stays when the committed file names none');
    assert.deepEqual(currentManifest(fx.store, 'jira')?.map((e) => e.ref), ['PROJ-1'], 'the read recorded before it was committed carries over');
    assert.deepEqual(svc.syncDeclarations(file([]), at()).retired, ['jira'], 'once committed, it follows the file');

    const scratch = { id: 'scratch', kind: 'other', purpose: 'notes', authorityLevel: 'informative', authoritativeFor: [], notAuthoritativeFor: [], freshnessHours: null, sensitivity: 'confidential' } as const;
    svc.addLocal({ ...scratch, locator: null }, at());
    assert.deepEqual(svc.syncDeclarations(file([scratch]), at()).updated, ['scratch'], 'a local source committed exactly as it stands is reported, because it is now declared');
    assert.equal(getSource(fx.store, 'scratch')?.origin, 'declared');
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

function wikiService() {
  const fx = freshStore();
  const at = clock();
  let n = 0;
  const nextId = () => `id-${String(++n)}`;
  const svc = createSourceService(fx.store, { readers: new Map() });
  svc.addLocal({ id: 'wiki', kind: 'docs', purpose: 'design pages', locator: 'confluence:space:ENG', authorityLevel: 'informative', authoritativeFor: [], notAuthoritativeFor: [], freshnessHours: null, sensitivity: 'confidential' }, at());
  const entry = (ref: string) => currentManifest(fx.store, 'wiki')!.find((e) => e.ref === ref);
  return { fx, at, nextId, svc, entry };
}

test('a reported item keeps its address, and a later report that omits it keeps the one recorded', () => {
  const { fx, at, nextId, svc, entry } = wikiService();
  try {
    const url = 'https://acme.atlassian.net/wiki/spaces/ENG/pages/98765';
    svc.reportRead('wiki', { items: [{ ref: '98765', title: 'Architecture', url, updatedAt: '2026-09-01T00:00:00Z', text: 'The gateway fronts every service.' }], partial: true }, at(), nextId);
    assert.equal(entry('98765')?.url, url);
    svc.reportRead('wiki', { items: [{ ref: '98765', updatedAt: '2026-09-02T00:00:00Z', text: 'The gateway fronts every service but billing.' }], partial: true }, at(), nextId);
    assert.equal(entry('98765')?.url, url, 'a newer version reported without its address keeps the address');
    svc.reportRead('wiki', { items: [{ ref: '11111', text: 'Other page.' }], partial: true }, at(), nextId);
    assert.equal(entry('98765')?.url, url, 'an item a partial read did not name keeps its address');
    assert.throws(() => svc.reportRead('wiki', { items: [{ ref: '22222', url: 'ftp://files.example/x' }] }, at(), nextId), /not an http\(s\) address/);
    assert.throws(() => svc.reportRead('wiki', { items: [{ ref: '22222', url: 'https://me:hunter2@wiki.example/x' }] }, at(), nextId), /carries credentials/);
  } finally {
    fx.cleanup();
  }
});

test('an address gained on a re-read of the same text is recorded, and is not called a change to the item', () => {
  const { fx, at, nextId, svc, entry } = wikiService();
  try {
    svc.reportRead('wiki', { items: [{ ref: '98765', text: 'The gateway fronts every service.' }], partial: true }, at(), nextId);
    assert.equal(entry('98765')?.url, undefined);
    const again = svc.reportRead('wiki', { items: [{ ref: '98765', url: 'https://wiki.example/pages/98765', text: 'The gateway fronts every service.' }], partial: true }, at(), nextId);
    assert.equal(again.outcome, 'changed', 'the read is recorded, not dismissed as unchanged');
    assert.deepEqual(again.changes?.modified ?? [], [], 'the item itself did not change');
    assert.equal(entry('98765')?.url, 'https://wiki.example/pages/98765');
  } finally {
    fx.cleanup();
  }
});

test('text past the cap is cut, the item is marked, and the report names it', () => {
  const { fx, at, nextId, svc, entry } = wikiService();
  try {
    const long = `Intro. ${'word '.repeat(REPORTED_TEXT_CAP / 4)}The end.`;
    const r = svc.reportRead('wiki', { items: [{ ref: 'long', text: long }, { ref: 'short', text: 'Short page.' }] }, at(), nextId);
    assert.deepEqual(r.truncated, ['long']);
    assert.equal(entry('long')?.truncated, true);
    assert.equal(entry('long')?.text?.length, REPORTED_TEXT_CAP);
    assert.equal(entry('short')?.truncated, undefined);
    const thin = svc.reportRead('wiki', { items: [{ ref: 'long', text: long.slice(0, 100) }, { ref: 'short', text: 'Short page.' }] }, at(), nextId);
    assert.equal(thin.truncated, undefined, 'a report that kept nothing cut names nothing');
  } finally {
    fx.cleanup();
  }
});

test('stored text and titles have credentials removed, while the version is still judged on what was read', () => {
  const { fx, at, nextId, svc, entry } = wikiService();
  try {
    const BODY = 'a1B2c3D4e5F6g7H8i9J0';
    const secret = `ghp_${BODY}${BODY.slice(0, 4)}`;
    const text = `Deploy with GITHUB_TOKEN=${secret} from the runbook.`;
    svc.reportRead('wiki', { items: [{ ref: 'runbook', title: `Runbook ${secret}`, text }] }, at(), nextId);
    const e = entry('runbook')!;
    assert.ok(!e.text!.includes(secret), 'the token is not kept');
    assert.match(e.text!, /GITHUB_TOKEN=\[redacted\] from the runbook/);
    assert.equal(e.fingerprint, createHash('sha256').update(text).digest('hex'), 'the fingerprint is of what was read, unredacted');
    const same = svc.reportRead('wiki', { items: [{ ref: 'runbook', text }] }, at(), nextId);
    assert.equal(same.outcome, 'unchanged', 'the same text read again is the same version');
    const rotated = svc.reportRead('wiki', { items: [{ ref: 'runbook', text: text.replace(secret, `ghp_${BODY.split('').reverse().join('')}0000`) }] }, at(), nextId);
    assert.deepEqual(rotated.changes?.modified, ['runbook'], 'a rotated secret is still a change to the page');
    const tables = (fx.store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    for (const table of tables) {
      const rows = JSON.stringify(fx.store.db.prepare(`SELECT * FROM "${table}"`).all());
      assert.ok(!rows.includes(secret), `no row of ${table} holds the token`);
    }
  } finally {
    fx.cleanup();
  }
});

test('text recorded with a credential in it is kept without it whenever a later report carries it forward', () => {
  const { fx, at, nextId, svc, entry } = wikiService();
  try {
    const BODY = 'a1B2c3D4e5F6g7H8i9J0';
    const secret = `ghp_${BODY}${BODY.slice(0, 4)}`;
    const runbook = `Deploy with GITHUB_TOKEN=${secret} from the runbook.`;
    const other = `Rotate ${secret} every quarter.`;
    const sha = (t: string) => createHash('sha256').update(t).digest('hex');
    // A manifest whose text was kept exactly as read, credentials and all.
    recordObservation(fx.store, { id: 'planted', sourceId: 'wiki', kind: 'source.changed', summary: 'wiki changed', evidence: { digest: 'sha256:planted', evidence: 'reported', items: 2, partial: true, manifest: [{ ref: 'other', kind: 'item', fingerprint: sha(other), text: other }, { ref: 'runbook', kind: 'item', fingerprint: sha(runbook), text: runbook }] }, at: at() });
    assert.ok(entry('runbook')!.text!.includes(secret));

    const again = svc.reportRead('wiki', { items: [{ ref: 'runbook', text: runbook }], partial: true }, at(), nextId);
    assert.deepEqual(again.changes?.modified ?? [], [], 'the same version read again is not a change to the item');
    assert.equal(entry('runbook')!.text, 'Deploy with GITHUB_TOKEN=[redacted] from the runbook.', 'the item read again keeps its text without the token');
    assert.equal(entry('other')!.text, 'Rotate [redacted] every quarter.', 'an item the partial read did not name is carried forward without the token');
    const settled = svc.reportRead('wiki', { items: [{ ref: 'runbook', text: runbook }], partial: true }, at(), nextId);
    assert.equal(settled.outcome, 'unchanged', 'once cleaned, carrying the text forward changes nothing');
  } finally {
    fx.cleanup();
  }
});

test('unchanged provider versions cannot conceal corrected content, including beyond the retention cap', () => {
  const { fx, at, nextId, svc, entry } = wikiService();
  try {
    const common = { ref: 'policy', updatedAt: '2026-09-01', fingerprint: 'provider-revision-1' };
    const original = `${'x'.repeat(REPORTED_TEXT_CAP)}Access denied.`;
    svc.reportRead('wiki', { items: [{ ...common, text: original }] }, at(), nextId);
    const before = entry('policy')!.fingerprint;
    const correction = svc.reportRead('wiki', { items: [{ ...common, text: original.replace('denied', 'opened') }] }, at(), nextId);
    assert.deepEqual(correction.changes?.modified, ['policy']);
    assert.notEqual(entry('policy')!.fingerprint, before);
    const again = svc.reportRead('wiki', { items: [{ ...common, text: original.replace('denied', 'opened') }] }, at(), nextId);
    assert.equal(again.outcome, 'unchanged');
  } finally {
    fx.cleanup();
  }
});
