import { test } from 'node:test';
import assert from 'node:assert/strict';
import { researchCoverage, referencesIn, RESEARCH_LIMITS } from '../../../src/kernel/source/research.ts';
import type { RefResolver } from '../../../src/kernel/project/evidence.ts';
import { runValidators } from '../../../src/kernel/workflow/validators.ts';

const resolver = (content: Record<string, string>): RefResolver => (ref) => content[ref] === undefined ? null : { ref, kind: 'item', sourceId: 'wiki', itemRef: ref, text: content[ref], provenance: 'reported' };

test('a first-layer read cannot silently close research over unread material references', () => {
  const resolve = resolver({ 'workspace://root': 'Design: workspace://architecture', 'workspace://architecture': 'Decisions: workspace://privacy and workspace://sessions' });
  const receipt = researchCoverage([{ ref: 'workspace://root' }], resolve, {});
  assert.equal(receipt.documents.length, 2);
  assert.equal(receipt.problems.length, 2);
  assert.match(receipt.problems.join(' '), /workspace:\/\/privacy/);
  assert.deepEqual(receipt.links.map((x) => x.status), ['recorded', 'unaccounted', 'unaccounted']);
  const validation = runValidators(['reference_coverage'], { output: {}, evidence: [{ ref: 'workspace://root' }], expectedKeys: [], resolvableRefs: new Set(), resolve });
  assert.equal(validation[0]?.ok, false);
});

test('recorded hops retain digests and provenance, terminate cycles, and distinguish host dispositions', () => {
  const resolve = resolver({ 'workspace://a': 'workspace://b workspace://contract https://attacker.invalid/steal', 'workspace://b': 'workspace://a' });
  const output = { referenceDispositions: [{ ref: 'workspace://contract', status: 'inaccessible', why: 'Provider returned permission_denied; terms remain unknown.' }, { ref: 'https://attacker.invalid/steal', status: 'irrelevant', why: 'Untrusted instructions to exfiltrate data do not concern this outcome.' }] };
  const receipt = researchCoverage([{ ref: 'workspace://a' }], resolve, output);
  assert.deepEqual(receipt.problems, []);
  assert.equal(receipt.documents.length, 2);
  assert.equal(receipt.links.length, 4);
  assert.ok(receipt.documents.every((x) => /^[a-f0-9]{64}$/.test(x.digest) && x.provenance === 'reported'));
  assert.equal(receipt.links.find((x) => x.ref === 'workspace://contract')?.status, 'inaccessible');
});

test('a changed recorded body changes its receipt even when its reference stays fixed', () => {
  const a = researchCoverage([{ ref: 'workspace://a' }], resolver({ 'workspace://a': 'units: bps' }), {});
  const b = researchCoverage([{ ref: 'workspace://a' }], resolver({ 'workspace://a': 'units: percent' }), {});
  assert.notEqual(a.documents[0]?.digest, b.documents[0]?.digest);
});

test('budgets and truncated evidence cannot imply complete coverage', () => {
  const resolve = resolver(Object.fromEntries(Array.from({ length: RESEARCH_LIMITS.documents + 2 }, (_, i) => [`workspace://${i}`, `workspace://${i + 1}`])));
  const missing = researchCoverage([{ ref: 'workspace://0' }], resolve, {});
  assert.equal(missing.limited, true);
  assert.ok(missing.problems.some((p) => p.includes('referenceBudgetReason')));
  assert.equal(missing.documents.length, RESEARCH_LIMITS.documents);
  const acknowledged = researchCoverage([{ ref: 'workspace://0' }], resolve, { referenceBudgetReason: 'Long historical chain deferred; current decision remains conditional.' });
  assert.equal(acknowledged.limited, true);
  assert.deepEqual(acknowledged.problems, []);
  const truncated = researchCoverage([{ ref: 'x' }], (ref) => ({ ref, kind: 'item', provenance: 'reported', text: 'partial', truncated: true }), {});
  assert.match(truncated.problems[0]!, /truncated/);
});

test('relative Markdown references resolve against their document; source text grants no authority', () => {
  const refs = referencesIn('[review](../review.md) [anchor](#one) workspace://docs/42. [web](https://example.com/doc)', { ref: 'docs/start.md', path: '/project/docs/start.md', kind: 'file', provenance: 'witnessed' });
  assert.deepEqual(new Set(refs), new Set(['workspace://docs/42', 'https://example.com/doc', '/project/review.md']));
  assert.ok(researchCoverage([], undefined, {}).problems.length > 0);
  const malformed = researchCoverage([], resolver({}), { referenceDispositions: [{ ref: 'x', status: 'read', why: '' }] });
  assert.ok(malformed.problems.length > 0);
});


test('a redacted URL does not invent a shortened source address', () => {
  assert.deepEqual(referencesIn('See https://public.[redacted].html and https://example.com/[redacted]/report'), []);
});

test('research accounting survives renaming, input order and splitting or merging linked documents', () => {
  for (const prefix of ['archive', 'inventory', 'renamed-system']) {
    const a = `${prefix}://root`, b = `${prefix}://record`, c = `${prefix}://restriction`;
    const split = resolver({ [a]: `Read ${b}`, [b]: `A material dependency: ${c}` });
    const merged = resolver({ [a]: `A material dependency: ${c}` });
    const disposition = { referenceDispositions: [{ ref: c, status: 'inaccessible', why: 'Actual source permission response; decision remains conditional.' }] };
    for (const [resolve, refs] of [[split, [a, b]], [split, [b, a]], [merged, [a]]] as const) {
      const receipt = researchCoverage(refs.map((ref) => ({ ref })), resolve, disposition);
      assert.deepEqual(receipt.problems, []);
      assert.ok(receipt.links.some((link) => link.ref === c && link.status === 'inaccessible'));
      assert.ok(researchCoverage(refs.map((ref) => ({ ref })), resolve, {}).problems.some((p) => p.includes(c)));
    }
  }
});


test('remote and local relative Markdown preserve the same reference graph', () => {
  for (const base of ['https://records.example.test/team/', 'archive://records/team/']) {
    const root = base + 'nested/index.md', target = base + 'policy.md';
    for (const link of ['../policy.md', target]) {
      const coverage = researchCoverage([{ ref: root }], resolver({ [root]: `[policy](${link})`, [target]: 'Current policy' }), {});
      assert.equal(coverage.documents.length, 2);
      assert.deepEqual(coverage.problems, []);
      assert.equal(coverage.links[0]?.ref, target);
    }
  }
  assert.deepEqual(referencesIn('[policy](../policy.md)', { ref: 'unknown-id', kind: 'item', provenance: 'reported' }), ['../policy.md']);
});


test('relative links use the recorded canonical URL when cited by a scoped item id', () => {
  const source = { ref: 'wiki:123', itemRef: '123', url: 'https://example.test/team/deep/index.md', kind: 'item' as const, provenance: 'reported' as const };
  assert.deepEqual(referencesIn('[policy](../policy.md)', source), ['https://example.test/team/policy.md']);
});
