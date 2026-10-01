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
  const resolve = createEvidenceResolver({
    root,
    sources: [
      { id: 'strategy', kind: 'directory', locator: join(root, 'docs', 'strategy'), manifest: [{ ref: 'old.md', kind: 'file', fingerprint: 'a', supersededBy: 'new.md' }, { ref: 'new.md', kind: 'file', fingerprint: 'b' }] },
      { id: 'jira-plat', kind: 'jira', locator: 'PLAT', manifest: [{ ref: 'PLAT-101', kind: 'work_item', fingerprint: 'c', text: '{"key":"PLAT-101","summary":"Events"}' }] },
      { id: 'wiki', kind: 'docs', locator: 'confluence:ENG:1', manifest: null },
    ],
    deliverableIds: new Set(['deliverable-1']),
    knows: (kind, id) => kind === 'decision' && id === 'q-1',
  });
  return { root, outside, resolve, cleanup: () => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); } };
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

test('sources, their items, deliverables, and kernel records resolve; a source Construct cannot read is the host\'s word', () => {
  const p = project();
  try {
    assert.equal(p.resolve('PLAT-101')?.provenance, 'witnessed');
    assert.match(p.resolve('jira-plat:PLAT-101')?.text ?? '', /Events/);
    assert.equal(p.resolve('source:strategy')?.kind, 'source');
    assert.equal(p.resolve('deliverable:deliverable-1')?.kind, 'deliverable');
    assert.equal(p.resolve('decision:q-1')?.kind, 'record');
    assert.equal(p.resolve('wiki:Some Page')?.provenance, 'reported');
    assert.deepEqual(provenanceOf([{ ref: 'PLAT-101' }, { ref: 'wiki:x' }, { ref: 'nope.md' }], p.resolve), { witnessed: 1, reported: 1, unresolved: 1 });
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
