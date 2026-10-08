/**
 * tests/kernel/source/change-tracking.test.ts — a refresh says which items
 * moved, finished work that cited them is flagged and put to the person, a
 * Jira fixture stands in for the tracker, and the fabricated-grounding run
 * from the UAT is refused end to end.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { record } from '../../../src/kernel/broker/definition.ts';
import { addSource } from '../../../src/kernel/state/sources.ts';
import { listDriftFindings } from '../../../src/kernel/state/drift.ts';
import { listOpenDecisions } from '../../../src/kernel/state/decisions.ts';
import { readDirectorySource } from '../../../src/hosts/sources/directory.ts';
import { createJiraFixtureReader, FIXTURE_TEXT_CAP } from '../../../src/hosts/sources/jira-fixture.ts';
import { hostReaders } from '../../../src/hosts/sources/readers.ts';
import { createSourceService } from '../../../src/kernel/source/service.ts';
import { brokerFixture } from '../broker/support.ts';

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
async function call(fx: ReturnType<typeof brokerFixture>, name: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const t = tool(name);
  return (await t.run(fx.broker, t.validate(record(args)))) as Record<string, any>;
}

test('the directory reader fingerprints content, reports items, and records supersession', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'construct-dir-'));
  try {
    writeFileSync(join(dir, 'strategy-2025.md'), '# 2025\nNo webhooks.\n');
    writeFileSync(join(dir, 'strategy-2026.md'), '# 2026\n**Supersedes:** strategy-2025.md\n');
    const a = await readDirectorySource({ sourceId: 's', kind: 'directory', locator: dir });
    assert.equal(a.outcome, 'read');
    if (a.outcome !== 'read') return;
    assert.deepEqual(a.report.items!.map((i) => i.externalRef), ['strategy-2025.md', 'strategy-2026.md']);
    assert.equal(a.report.items![0]!.attributes!.supersededBy, 'strategy-2026.md');
    utimesSync(join(dir, 'strategy-2025.md'), new Date(), new Date(Date.now() + 5000));
    const b = await readDirectorySource({ sourceId: 's', kind: 'directory', locator: dir });
    assert.equal(b.outcome === 'read' && b.report.digest, a.report.digest, 'touching a file without changing it is not a change');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a Jira fixture stands in for the tracker: issues become citable items, reported not witnessed, and only when configured', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'construct-jira-'));
  try {
    writeFileSync(join(dir, 'PLAT.json'), JSON.stringify({ issues: [{ key: 'PLAT-102', summary: 'b' }, { key: 'PLAT-101', summary: 'a' }] }));
    const read = await createJiraFixtureReader(dir)({ sourceId: 'jira-plat', kind: 'jira', locator: 'PLAT' });
    assert.equal(read.outcome, 'read');
    if (read.outcome === 'read') {
      assert.deepEqual(read.report.items!.map((i) => i.externalRef), ['PLAT-101', 'PLAT-102']);
      assert.equal(read.report.evidence, 'reported');
    }
    // The fixture keeps text the way the hook keeps a connector's: readable, without credentials, cut and marked at the cap.
    const BODY = 'a1B2c3D4e5F6g7H8i9J0';
    const issue = { key: 'PLAT-103', self: 'https://acme.atlassian.net/rest/api/3/issue/103', summary: 'Rotate keys', description: `Rotate ghp_${BODY}${BODY.slice(0, 4)} and say "done".` };
    const long = { key: 'PLAT-104', summary: 'Long', description: 'x '.repeat(FIXTURE_TEXT_CAP) };
    writeFileSync(join(dir, 'KEYS.json'), JSON.stringify([issue, long]));
    const keys = await createJiraFixtureReader(dir)({ sourceId: 'jira-keys', kind: 'jira', locator: 'KEYS' });
    assert.equal(keys.outcome, 'read');
    if (keys.outcome === 'read') {
      const [a, b] = keys.report.items!;
      assert.equal(a!.attributes!.text, 'PLAT-103\nhttps://acme.atlassian.net/rest/api/3/issue/103\nRotate keys\nRotate [redacted] and say "done".');
      assert.equal(a!.attributes!.fingerprint, createHash('sha256').update(JSON.stringify(issue)).digest('hex'), 'the version is the whole issue as exported');
      assert.equal(a!.attributes!.url, 'https://acme.atlassian.net/browse/PLAT-103');
      assert.equal(a!.attributes!.truncated, undefined);
      assert.equal(b!.attributes!.truncated, true);
      assert.equal((b!.attributes!.text as string).length, FIXTURE_TEXT_CAP);
    }
    assert.equal((await createJiraFixtureReader(dir)({ sourceId: 'x', kind: 'jira', locator: 'NOPE' })).outcome, 'unreachable');
    assert.ok(!hostReaders({}).has('jira'));
    assert.ok(hostReaders({ CONSTRUCT_JIRA_FIXTURES: dir }).has('jira'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a refresh names added, modified, and removed items, and content that changes back is still a change', async () => {
  const fx = brokerFixture();
  try {
    const s = fx.broker.store;
    const at = fx.ctx.now();
    const dir = join(fx.broker.root, 'notes');
    mkdirSync(dir);
    writeFileSync(join(dir, 'a.md'), 'v1');
    writeFileSync(join(dir, 'b.md'), 'keep');
    addSource(s, { id: 'notes', kind: 'directory', locator: dir, purpose: 'notes', authorityLevel: 'informative', sensitivity: 'internal', canRead: true, canWrite: false, at });
    const svc = createSourceService(s, { readers: hostReaders({}), root: fx.broker.root });
    const first = await svc.refresh('notes', at, () => fx.ctx.nextId('snap'));
    assert.equal(first.outcome, 'changed');
    writeFileSync(join(dir, 'a.md'), 'v2');
    writeFileSync(join(dir, 'c.md'), 'new');
    rmSync(join(dir, 'b.md'));
    const second = await svc.refresh('notes', at, () => fx.ctx.nextId('snap'));
    assert.deepEqual(second.changes, { added: ['c.md'], removed: ['b.md'], modified: ['a.md'] });
    writeFileSync(join(dir, 'a.md'), 'v1');
    writeFileSync(join(dir, 'b.md'), 'keep');
    rmSync(join(dir, 'c.md'));
    assert.equal((await svc.refresh('notes', at, () => fx.ctx.nextId('snap'))).outcome, 'changed', 'back to an earlier state is still a change');
    assert.equal((await svc.refresh('notes', at, () => fx.ctx.nextId('snap'))).outcome, 'unchanged');
  } finally {
    fx.cleanup();
  }
});

async function runManaged(fx: ReturnType<typeof brokerFixture>, evidence: { ref: string; excerpt?: string }[], findings: string[], request = 'summarize the notes') {
  const started = await call(fx, 'start_outcome', { workflowId: 'managed-outcome', input: { request } });
  const runId = started.run.id as string;
  const submit = async (output: Record<string, unknown>, ev: { ref: string; excerpt?: string }[]) => {
    const w = (await call(fx, 'claim_work', { runId })).work;
    return call(fx, 'submit_work', { stepRunId: w.stepRunId, owner: w.owner, token: w.token, output, evidence: ev });
  };
  await submit({ plan: ['read notes'], assumptions: [], blockers: [] }, []);
  const done = await submit({ summary: 'summary', findings, changes: [] }, evidence);
  return { runId, done };
}

test('the fabricated run from the UAT is refused: a citation to a file that does not exist does not validate', async () => {
  const fx = brokerFixture();
  try {
    const { done } = await runManaged(fx, [{ ref: 'docs/evidence/q4-forecast-NONEXISTENT.md', excerpt: 'Northwind ARR $2.4M' }], ['Northwind is worth $2.4M ARR']);
    assert.notEqual(done.step.state, 'succeeded');
    assert.ok(done.validation.some((v: { ok: boolean }) => !v.ok));
    assert.deepEqual(done.evidence, { witnessed: 0, reported: 0, unverified: 0, unresolved: 1 });
  } finally {
    fx.cleanup();
  }
});

test('a change to a file finished work cited opens a drift finding and puts the choice in the inbox; dismissing closes it', async () => {
  const fx = brokerFixture();
  try {
    const s = fx.broker.store;
    const at = fx.ctx.now();
    const dir = join(fx.broker.root, 'notes');
    mkdirSync(dir);
    writeFileSync(join(dir, 'pricing.md'), 'Enterprise only for v1.');
    addSource(s, { id: 'notes', kind: 'directory', locator: dir, purpose: 'notes', authorityLevel: 'informative', sensitivity: 'internal', canRead: true, canWrite: false, at });
    await call(fx, 'sources', { action: 'refresh', id: 'notes' });
    const { runId } = await runManaged(fx, [{ ref: 'notes/pricing.md', excerpt: 'Enterprise only' }], ['v1 is Enterprise only']);
    let w = (await call(fx, 'claim_work', { runId })).work;
    await call(fx, 'submit_work', { stepRunId: w.stepRunId, owner: w.owner, token: w.token, output: { verification: 'read back', passed: true }, evidence: [{ ref: 'notes/pricing.md' }] });
    w = (await call(fx, 'claim_work', { runId })).work;
    const rec = await call(fx, 'submit_work', { stepRunId: w.stepRunId, owner: w.owner, token: w.token, output: { deliverableId: 'pricing-summary', summary: 'v1 is Enterprise only', findings: ['Enterprise only'] }, evidence: [{ ref: 'notes/pricing.md' }] });
    assert.equal(rec.run.state, 'succeeded');
    assert.deepEqual(rec.evidence, { witnessed: 1, reported: 0, unverified: 0, unresolved: 0 });

    writeFileSync(join(dir, 'pricing.md'), 'Pro gets webhooks at launch.');
    const refreshed = await call(fx, 'sources', { action: 'refresh', id: 'notes' });
    assert.deepEqual(refreshed.changes.modified, ['pricing.md']);
    assert.equal(refreshed.staleDeliverables.length, 1, 'one finding per run, not one per draft');
    const finding = listDriftFindings(s, { status: 'open' })[0]!;
    assert.match(finding.summary, /pricing\.md/);
    const question = listOpenDecisions(s).find((d) => (d.subject as { driftFindingIds?: string[] } | null)?.driftFindingIds?.includes(finding.id))!;
    assert.deepEqual(question.options, ['revise', 're-run', 'dismiss']);
    const boot = await call(fx, 'bootstrap');
    assert.match(boot.next, /decision/);
    await call(fx, 'decide', { decisionId: question.id, resolution: 'dismiss' });
    assert.equal(listDriftFindings(s, { status: 'open' }).length, 0);
  } finally {
    fx.cleanup();
  }
});

test('new files in a busy source raise one question for the refresh, not one per deliverable', async () => {
  const fx = brokerFixture();
  try {
    const s = fx.broker.store;
    const at = fx.ctx.now();
    const dir = join(fx.broker.root, 'notes');
    mkdirSync(dir);
    writeFileSync(join(dir, 'a.md'), 'alpha');
    addSource(s, { id: 'notes', kind: 'directory', locator: dir, purpose: 'notes', authorityLevel: 'informative', sensitivity: 'internal', canRead: true, canWrite: false, at });
    await call(fx, 'sources', { action: 'refresh', id: 'notes' });
    for (const n of [1, 2]) {
      const { runId } = await runManaged(fx, [{ ref: 'notes/a.md', excerpt: 'alpha' }], [`finding ${String(n)}`], `summarize the notes, pass ${String(n)}`);
      for (const out of [{ verification: 'ok', passed: true }, { deliverableId: `d${String(n)}`, summary: 's', findings: ['f'] }]) {
        const w = (await call(fx, 'claim_work', { runId })).work;
        await call(fx, 'submit_work', { stepRunId: w.stepRunId, owner: w.owner, token: w.token, output: out, evidence: [{ ref: 'notes/a.md' }] });
      }
    }
    const before = listOpenDecisions(s).length;
    writeFileSync(join(dir, 'b.md'), 'new');
    writeFileSync(join(dir, 'c.md'), 'newer');
    const r = await call(fx, 'sources', { action: 'refresh', id: 'notes' });
    assert.equal(r.staleDeliverables.length, 2);
    assert.equal(listOpenDecisions(s).length - before, 1, 'one question covers both deliverables');
  } finally {
    fx.cleanup();
  }
});

test('a later read reuses fingerprints of files that did not move, so a new session does not re-hash everything', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'construct-reuse-'));
  try {
    writeFileSync(join(dir, 'old.md'), '# Old\nStatus: Superseded\n');
    const first = await readDirectorySource({ sourceId: 's', kind: 'directory', locator: dir });
    if (first.outcome !== 'read') throw new Error('unread');
    const item = first.report.items![0]!;
    const previous = [{ ref: item.externalRef, fingerprint: 'reused-fp', attributes: item.attributes }];
    // A fresh process has an empty cache; simulate it by naming a fingerprint only the previous read could supply.
    const { readDirectorySource: freshReader } = await import(`../../../src/hosts/sources/directory.ts?fresh=${String(Date.now())}`);
    const second = await freshReader({ sourceId: 's', kind: 'directory', locator: dir, previous });
    assert.equal(second.report.items[0].attributes.fingerprint, 'reused-fp');
    assert.equal(second.report.items[0].attributes.supersededBy, '(the document says it is superseded)', 'what the file said about itself survives reuse');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removing a file only flags work that cited that file in that source, not a same-named item elsewhere', async () => {
  const fx = brokerFixture();
  try {
    const s = fx.broker.store;
    const at = fx.ctx.now();
    const dir = join(fx.broker.root, 'notes');
    mkdirSync(dir);
    writeFileSync(join(dir, 'plan.md'), 'notes plan');
    writeFileSync(join(fx.broker.root, 'docs', 'plan.md'), 'docs plan');
    addSource(s, { id: 'notes', kind: 'directory', locator: dir, purpose: 'notes', authorityLevel: 'informative', sensitivity: 'internal', canRead: true, canWrite: false, at });
    await call(fx, 'sources', { action: 'refresh', id: 'notes' });
    // A web page is citable once its read is recorded.
    addSource(s, { id: 'web', kind: 'other', purpose: 'pages read on the open web', authorityLevel: 'informative', sensitivity: 'public', canRead: true, canWrite: false, at });
    await call(fx, 'sources', { action: 'report', id: 'web', partial: true, items: [{ ref: 'https://example.com/plan.md', text: 'other plan' }] });
    const { runId } = await runManaged(fx, [{ ref: 'docs/plan.md' }, { ref: 'https://example.com/plan.md' }], ['other plan'], 'summarize the other plan');
    for (const out of [{ verification: 'ok', passed: true }, { deliverableId: 'x', summary: 's', findings: ['f'] }]) {
      const w = (await call(fx, 'claim_work', { runId })).work;
      await call(fx, 'submit_work', { stepRunId: w.stepRunId, owner: w.owner, token: w.token, output: out, evidence: [{ ref: 'docs/plan.md' }] });
    }
    rmSync(join(dir, 'plan.md'));
    const r = await call(fx, 'sources', { action: 'refresh', id: 'notes' });
    assert.deepEqual(r.changes.removed, ['plan.md']);
    assert.equal((r.staleDeliverables ?? []).length, 0, 'docs/plan.md and a web page named plan.md are not notes/plan.md');
  } finally {
    fx.cleanup();
  }
});

async function finishedCiting(fx: ReturnType<typeof brokerFixture>, refs: string[], name: string) {
  const { runId, done } = await runManaged(fx, refs.map((ref) => ({ ref })), ['the ledger is called synchronously'], `summarize the architecture page, cited as ${name}`);
  assert.equal(done.step.state, 'succeeded', JSON.stringify(done.validation));
  for (const out of [{ verification: 'read back', passed: true }, { deliverableId: name, summary: 's', findings: ['f'] }]) {
    const w = (await call(fx, 'claim_work', { runId })).work;
    await call(fx, 'submit_work', { stepRunId: w.stepRunId, owner: w.owner, token: w.token, output: out, evidence: refs.map((ref) => ({ ref })) });
  }
  return runId;
}

test('a cited page that changes flags the work that cited it, whether by its url, by <source>:<id>, or by its bare id', async () => {
  const fx = brokerFixture();
  try {
    const s = fx.broker.store;
    const at = fx.ctx.now();
    const URL = 'https://wiki.example.com/spaces/ENG/pages/98765/Architecture';
    addSource(s, { id: 'confluence', kind: 'docs', purpose: 'engineering wiki', authorityLevel: 'informative', sensitivity: 'internal', canRead: true, canWrite: false, at });
    await call(fx, 'sources', { action: 'report', id: 'confluence', items: [{ ref: '98765', url: URL, title: 'Architecture', updatedAt: '2026-09-01', text: 'The checkout service calls the ledger synchronously.' }] });
    const forms: Record<string, string> = { 'by-url': `${URL}#overview`, 'by-source': 'confluence:98765', 'by-id': '98765' };
    for (const [name, ref] of Object.entries(forms)) await finishedCiting(fx, [ref], name);
    const changed = await call(fx, 'sources', { action: 'report', id: 'confluence', items: [{ ref: '98765', url: URL, title: 'Architecture', updatedAt: '2026-10-01', text: 'The checkout service queues ledger writes.' }] });
    assert.deepEqual(changed.changes.modified, ['98765']);
    assert.equal(changed.staleDeliverables.length, 3, 'each form of citation is matched to the page');
    const findings = listDriftFindings(s, { status: 'open' });
    assert.equal(new Set(findings.flatMap((f) => f.affected)).size, 3);
    assert.ok(findings.every((f) => /cites 98765 in confluence/.test(f.summary)));
  } finally {
    fx.cleanup();
  }
});

test('a complete re-read that drops a page cited by its url flags the work through the address the earlier read recorded', async () => {
  const fx = brokerFixture();
  try {
    const s = fx.broker.store;
    const at = fx.ctx.now();
    const URL = 'https://wiki.example.com/pages/98765';
    addSource(s, { id: 'confluence', kind: 'docs', purpose: 'engineering wiki', authorityLevel: 'informative', sensitivity: 'internal', canRead: true, canWrite: false, at });
    await call(fx, 'sources', { action: 'report', id: 'confluence', items: [{ ref: '98765', url: URL, text: 'The ledger is called synchronously.' }, { ref: '11111', text: 'Another page.' }] });
    await finishedCiting(fx, [URL], 'cited-by-url');
    const reread = await call(fx, 'sources', { action: 'report', id: 'confluence', items: [{ ref: '11111', text: 'Another page.' }] });
    assert.deepEqual(reread.changes.removed, ['98765']);
    assert.equal(reread.staleDeliverables.length, 1);
    assert.match(listDriftFindings(s, { status: 'open' })[0]!.summary, /cites 98765 in confluence/);
  } finally {
    fx.cleanup();
  }
});

test('review finding: the current manifest is the newest read even after a long history', async () => {
  const fx = brokerFixture();
  try {
    const { recordObservation } = await import('../../../src/kernel/state/drift.ts');
    const { currentManifest } = await import('../../../src/kernel/source/manifest.ts');
    const s = fx.broker.store;
    addSource(s, { id: 'long', kind: 'docs', purpose: 'wiki', authorityLevel: 'informative', sensitivity: 'internal', canRead: true, canWrite: false, at: fx.ctx.now() });
    const base = Date.parse('2026-01-01T00:00:00Z');
    for (let i = 0; i < 2105; i++) {
      recordObservation(s, { id: `o-${String(i)}`, sourceId: 'long', kind: 'source.changed', summary: 'read', evidence: { manifest: [{ ref: `v${String(i)}`, kind: 'item', fingerprint: String(i) }] }, at: new Date(base + i * 1000).toISOString() });
    }
    assert.equal(currentManifest(s, 'long')![0]!.ref, 'v2104');
  } finally {
    fx.cleanup();
  }
});
