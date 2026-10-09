/**
 * tests/kernel/project/evidence.test.ts — a reference resolves only to
 * something real, and says how Construct knows it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEvidenceResolver, provenanceOf, stripLocator } from '../../../src/kernel/project/evidence.ts';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'construct-evidence-'));
  mkdirSync(join(root, 'docs', 'strategy'), { recursive: true });
  writeFileSync(join(root, 'docs', 'strategy', 'old.md'), '# Old\nNo webhooks.\n');
  writeFileSync(join(root, 'docs', 'strategy', 'new.md'), '# New\nSupersedes: old.md\nWebhooks are a bet.\n');
  const outside = mkdtempSync(join(tmpdir(), 'construct-outside-'));
  writeFileSync(join(outside, 'secret.md'), 'x');
  const input = {
    root,
    sources: [
      { id: 'strategy', kind: 'directory', locator: join(root, 'docs', 'strategy'), manifest: [{ ref: 'old.md', kind: 'file', fingerprint: 'a', supersededBy: 'new.md' }, { ref: 'new.md', kind: 'file', fingerprint: 'b' }] },
      { id: 'jira-plat', kind: 'jira', locator: 'PLAT', manifest: [{ ref: 'PLAT-101', kind: 'work_item', fingerprint: 'c', text: '{"key":"PLAT-101","summary":"Events"}' }] },
      { id: 'wiki', kind: 'docs', locator: 'confluence:ENG:1', manifest: null, neverRead: true },
    ],
    deliverableIds: new Set(['deliverable-1']),
    knows: (kind: string, id: string) => kind === 'decision' && id === 'q-1',
  };
  const resolve = createEvidenceResolver(input);
  const accept = createEvidenceResolver({ ...input, hostReads: 'accept' });
  return { root, outside, resolve, accept, cleanup: () => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); } };
}

test('a file inside the project resolves as witnessed, with its text; anchors and line ranges are ignored', () => {
  const p = project();
  try {
    const r = p.resolve('docs/strategy/new.md#bets');
    assert.equal(r?.kind, 'file');
    assert.equal(r?.provenance, 'witnessed');
    assert.match(r?.text ?? '', /Webhooks are a bet/);
    assert.equal(r?.sourceId, 'strategy');
    assert.ok(p.resolve('./docs/strategy/new.md:2-3'));
    assert.equal(stripLocator('a.md:12-30'), 'a.md');
  } finally {
    p.cleanup();
  }
});

test('missing files, paths outside the project, and invented items do not resolve', () => {
  const p = project();
  try {
    assert.equal(p.resolve('docs/evidence/q4-forecast.md'), null);
    assert.equal(p.resolve(join(p.outside, 'secret.md')), null);
    assert.equal(p.resolve('../secret.md'), null);
    assert.equal(p.resolve('jira-plat:PLAT-999'), null, 'a source Construct read has to contain the item');
    assert.equal(p.resolve('decision:q-404'), null);
    assert.equal(p.resolve(''), null);
  } finally {
    p.cleanup();
  }
});

test('sources, their items, deliverables, and kernel records resolve; an item no recorded read holds is the host\'s word, admitted only under accept', () => {
  const p = project();
  try {
    assert.equal(p.resolve('PLAT-101')?.provenance, 'reported', 'a manifest that does not say how it was obtained is a report, not Construct\'s own reading');
    assert.match(p.resolve('jira-plat:PLAT-101')?.text ?? '', /Events/);
    assert.equal(p.resolve('source:strategy')?.kind, 'source');
    assert.equal(p.resolve('deliverable:deliverable-1')?.kind, 'deliverable');
    assert.equal(p.resolve('decision:q-1')?.kind, 'record');
    assert.equal(p.resolve('wiki:Some Page'), null, 'under the default policy an unrecorded item does not resolve');
    assert.equal(p.accept('wiki:Some Page')?.provenance, 'unverified');
    assert.deepEqual(provenanceOf([{ ref: 'PLAT-101' }, { ref: 'wiki:x' }, { ref: 'nope.md' }], p.resolve), { witnessed: 0, reported: 1, unverified: 0, unresolved: 2 });
    assert.deepEqual(provenanceOf([{ ref: 'docs/strategy/new.md' }, { ref: 'PLAT-101' }, { ref: 'wiki:x' }, { ref: 'nope.md' }], p.accept), { witnessed: 1, reported: 1, unverified: 1, unresolved: 1 });
  } finally {
    p.cleanup();
  }
});

test('a superseded document says what replaced it', () => {
  const p = project();
  try {
    assert.equal(p.resolve('docs/strategy/old.md')?.supersededBy, 'new.md');
    assert.equal(p.resolve('strategy:new.md')?.supersededBy, undefined);
  } finally {
    p.cleanup();
  }
});

function connectors(hostReads?: 'require' | 'accept') {
  const root = mkdtempSync(join(tmpdir(), 'construct-connectors-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'a.md'), '# A\none\ntwo\n');
  const resolve = createEvidenceResolver({
    root,
    hostReads,
    sources: [
      { id: 'docs', kind: 'directory', locator: join(root, 'docs'), manifest: null },
      { id: 'jira', kind: 'jira', locator: 'PAY', provenance: 'reported', manifest: [{ ref: 'PAY-1', kind: 'item', fingerprint: 'p1', text: 'Refunds settle in two days.', updatedAt: '2026-09-30' }] },
      { id: 'github', kind: 'github', locator: 'acme/checkout', provenance: 'reported', manifest: [
        { ref: 'acme/checkout', kind: 'item', fingerprint: 'g0', text: 'the repository' },
        { ref: 'acme/checkout#311', kind: 'item', fingerprint: 'g1', text: 'PR 311 moves retries into the queue.' },
      ] },
      { id: 'confluence', kind: 'docs', locator: null, provenance: 'reported', manifest: [{ ref: '98765', kind: 'item', fingerprint: 'c1', text: 'The checkout service calls the ledger.', url: 'https://wiki.example.com/spaces/ENG/pages/98765/Architecture' }] },
      { id: 'web', kind: 'other', locator: null, provenance: 'reported', manifest: [{ ref: 'https://example.com/report', kind: 'item', fingerprint: 'w1', text: 'The report says 40%.' }] },
      { id: 'notion', kind: 'docs', locator: null, manifest: null, neverRead: true },
    ],
  });
  return { resolve, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('a partial read does not vouch for an item it never recorded', () => {
  const req = connectors();
  const acc = connectors('accept');
  try {
    assert.equal(req.resolve('jira:PAY-999'), null);
    assert.equal(acc.resolve('jira:PAY-999')?.provenance, 'unverified');
    assert.equal(acc.resolve('jira:PAY-999')?.text, undefined, 'an unverified item carries no text');
    const held = req.resolve('jira:PAY-1');
    assert.equal(held?.kind, 'item');
    assert.equal(held?.provenance, 'reported');
    assert.equal(held?.text, 'Refunds settle in two days.');
    assert.equal(held?.updatedAt, '2026-09-30');
  } finally {
    req.cleanup();
    acc.cleanup();
  }
});

test('items match exactly as recorded, before anything is stripped; anchors and line ranges narrow files only', () => {
  const c = connectors();
  try {
    assert.equal(c.resolve('github:acme/checkout#311')?.itemRef, 'acme/checkout#311', 'the pull request, not the repository item');
    assert.match(c.resolve('acme/checkout#311')?.text ?? '', /PR 311/);
    assert.equal(c.resolve('confluence:98765')?.text, 'The checkout service calls the ledger.');
    assert.equal(c.resolve('confluence:12345'), null);
    assert.equal(c.resolve('confluence:98765#heading'), null, 'an item ref is matched as recorded');
    assert.equal(c.resolve('docs/a.md:2-3')?.kind, 'file');
    assert.equal(c.resolve('docs/a.md#x')?.kind, 'file');
    assert.equal(c.resolve('docs:a.md#x')?.kind, 'file');
    assert.equal(c.resolve('#x'), null, 'a bare anchor names no file');
  } finally {
    c.cleanup();
  }
});

test('a url resolves to the item recorded under it, whatever its fragment, case, scheme, or trailing slash', () => {
  const req = connectors();
  const acc = connectors('accept');
  try {
    for (const ref of ['https://wiki.example.com/spaces/ENG/pages/98765/Architecture', 'HTTP://Wiki.Example.com/spaces/ENG/pages/98765/Architecture/#section', 'confluence:https://wiki.example.com/spaces/ENG/pages/98765/Architecture']) {
      const r = req.resolve(ref);
      assert.equal(r?.sourceId, 'confluence', ref);
      assert.equal(r?.itemRef, '98765', ref);
      assert.equal(r?.text, 'The checkout service calls the ledger.', ref);
    }
    assert.equal(req.resolve('https://example.com/report/')?.sourceId, 'web', 'a page reported under its address');
    assert.equal(req.resolve('https://example.com/invented'), null);
    const invented = acc.resolve('https://example.com/invented');
    assert.equal(invented?.kind, 'web');
    assert.equal(invented?.provenance, 'unverified');
  } finally {
    req.cleanup();
    acc.cleanup();
  }
});

test('Construct\'s own surfaces resolve as surfaces with no text, and source:<id>:<item> is <id>:<item>', () => {
  const c = connectors();
  try {
    for (const name of ['project_context', 'sources']) {
      const r = c.resolve(name);
      assert.equal(r?.kind, 'surface');
      assert.equal(r?.provenance, 'witnessed');
      assert.equal(r?.text, undefined);
    }
    assert.deepEqual({ ...c.resolve('source:jira:PAY-1'), ref: '' }, { ...c.resolve('jira:PAY-1'), ref: '' });
  } finally {
    c.cleanup();
  }
});

test('a whole host-read source resolves only after a recorded read; a directory source is witnessed', () => {
  const req = connectors();
  const acc = connectors('accept');
  try {
    assert.equal(req.resolve('notion'), null, 'a never-read source is not taken on the host\'s word');
    assert.equal(acc.resolve('notion')?.provenance, 'unverified');
    assert.equal(req.resolve('jira')?.provenance, 'reported');
    assert.equal(req.resolve('docs')?.provenance, 'witnessed');
    assert.equal(req.resolve('jira:482'), null, 'jira:482 asks for item 482, not for the source at line 482');
    assert.equal(acc.resolve('jira:482')?.itemRef, '482');
  } finally {
    req.cleanup();
    acc.cleanup();
  }
});
