/**
 * tests/kernel/workflow/quality-validators.test.ts — the grounding and
 * quality floors: citations name real things, artifacts exist, figures come
 * from what was cited, templates are followed, conflicts and supersession are
 * said out loud, and a proposal ends in a decision someone owns.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runValidators, figuresIn, evaluateExpression, type ValidationSubject } from '../../../src/kernel/workflow/validators.ts';
import { createEvidenceResolver } from '../../../src/kernel/project/evidence.ts';

const root = mkdtempSync(join(tmpdir(), 'construct-quality-'));
mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'docs', 'metrics.md'), '429 responses: Jun 1.6M, Sep 2.1M. Three accounts are 18% of Enterprise ARR.\n');
writeFileSync(join(root, 'docs', 'template.md'), '# PRD: <title>\n## 1. Problem\n## 2. Evidence\n## 3. Risks & open questions\n');
writeFileSync(join(root, 'docs', 'prd.md'), '# PRD: Webhooks\n## Problem\n429s rose to 2.1M (PLAT-101, RFC-012, decided 2026-09-02).\n## Evidence\n18% of Enterprise ARR.\n');
writeFileSync(join(root, 'docs', 'fabricated.md'), '# PRD\nNorthwind is worth $2.4M ARR.\n');
writeFileSync(join(root, 'docs', 'old.md'), 'old strategy');
writeFileSync(join(root, 'docs', 'proposal.md'), '# Proposal\n## Decision needed\nSam Ortiz decides by Oct 15 whether to fund webhooks.\n');
const resolve = createEvidenceResolver({
  root,
  sources: [
    { id: 'docs', kind: 'directory', locator: join(root, 'docs'), manifest: [{ ref: 'old.md', kind: 'file', fingerprint: 'x', supersededBy: 'new.md' }] },
    { id: 'wiki', kind: 'docs', locator: null, manifest: null },
  ],
});
test.after(() => rmSync(root, { recursive: true, force: true }));

function run(names: string[], partial: Partial<ValidationSubject>) {
  const results = runValidators(names, { output: {}, expectedKeys: [], evidence: [], resolvableRefs: new Set(), resolve, ...partial });
  return Object.fromEntries(results.map((r) => [r.validator, r.problems]));
}

test('the fabricated run from the UAT no longer validates: unknown file, invented figure', () => {
  const r = run(['citations_present', 'evidence_refs_resolve', 'numbers_grounded', 'artifacts_exist'], {
    output: { summary: 'x', findings: ['Northwind is worth $2.4M ARR'], artifact: 'docs/fabricated.md' },
    evidence: [{ ref: 'docs/evidence/q4-forecast-NONEXISTENT.md' }],
  });
  assert.ok(r.citations_present!.length > 0);
  assert.ok(r.evidence_refs_resolve!.length > 0);
  assert.ok(r.numbers_grounded!.some((p) => p.includes('2.4m')));
  assert.deepEqual(r.artifacts_exist, []);
});

test('without a resolver the reference check fails closed instead of passing unchecked', () => {
  const [res] = runValidators(['evidence_refs_resolve'], { output: {}, expectedKeys: [], evidence: [{ ref: 'anything' }], resolvableRefs: new Set() });
  assert.equal(res!.ok, false);
});

test('figures: ticket keys, dates, ids, and list numbers are not figures; amounts and percentages are', () => {
  assert.deepEqual(figuresIn('PLAT-101 RFC-012 2026-09-02 /v2/jobs p95 10:00 UUIDv7 O1 KR2'), []);
  assert.deepEqual(figuresIn('## 3. Goals\n1. first'), []);
  assert.deepEqual(figuresIn('cut 429s by 50% from 1.6M; $2.4M; 1,600 calls'), ['50%', '1.6m', '2.4m', '1600'], 'a plural like 429s names a thing, not an amount');
});

test('grounded figures pass; a derived figure needs arithmetic that holds over cited figures', () => {
  const evidence = [{ ref: 'docs/metrics.md' }];
  assert.deepEqual(run(['numbers_grounded'], { output: { summary: 'ok', artifact: 'docs/prd.md' }, evidence }).numbers_grounded, []);
  const good = run(['numbers_grounded'], { output: { summary: 'target 0.8M', derivations: [{ value: '0.8M', expression: '1.6M * 50%' }] }, evidence: [...evidence, { ref: 'wiki:okrs', excerpt: 'reduce by 50%' }] });
  assert.deepEqual(good.numbers_grounded, []);
  const wrong = run(['numbers_grounded'], { output: { summary: 'target 0.9M', derivations: [{ value: '0.9M', expression: '1.6M * 50 / 100' }] }, evidence });
  assert.ok(wrong.numbers_grounded!.some((p) => p.includes('comes to')));
  const ungrounded = run(['numbers_grounded'], { output: { summary: 'x', derivations: [{ value: '3M', expression: '1.5M * 2' }] }, evidence });
  assert.ok(ungrounded.numbers_grounded!.some((p) => p.includes('1.5m')));
  assert.equal(evaluateExpression('2 + process.exit()'), null);
});

test('artifacts must exist and not be empty; templates must be followed section by section', () => {
  assert.ok(run(['artifacts_exist'], { output: { artifact: 'docs/nope.md' } }).artifacts_exist!.length > 0);
  assert.ok(run(['artifacts_exist'], { output: {} }).artifacts_exist!.length > 0);
  const t = run(['template_conformance'], { output: { artifact: 'docs/prd.md' }, input: { template: 'docs/template.md' } });
  assert.deepEqual(t.template_conformance, ['the artifact has no "risks & open questions" section that the template requires']);
});

test('excerpts must appear in what they cite; at least one citation must be something Construct can open', () => {
  const quoted = run(['excerpts_match'], { evidence: [{ ref: 'docs/metrics.md', excerpt: 'Jun   1.6M,  Sep 2.1M' }, { ref: 'wiki:page', excerpt: 'cannot be checked here' }] });
  assert.deepEqual(quoted.excerpts_match, []);
  const misquoted = run(['excerpts_match'], { evidence: [{ ref: 'docs/metrics.md', excerpt: 'Sep 3.4M' }] });
  assert.equal(misquoted.excerpts_match!.length, 1);
  assert.equal(run(['evidence_witnessed'], { evidence: [{ ref: 'wiki:a' }] }).evidence_witnessed!.length, 1);
  assert.deepEqual(run(['evidence_witnessed'], { evidence: [{ ref: 'wiki:a' }, { ref: 'docs/metrics.md' }] }).evidence_witnessed, []);
});

test('conflicts cite both sides; a superseded document is named as superseded where it is used', () => {
  assert.equal(run(['conflicts_declared'], { output: {} }).conflicts_declared!.length, 1);
  assert.deepEqual(run(['conflicts_declared'], { output: { conflicts: [] } }).conflicts_declared, []);
  assert.equal(run(['conflicts_declared'], { output: { conflicts: [{ text: 'retry policy', citations: ['docs/adr.md'] }] } }).conflicts_declared!.length, 1);
  const silent = run(['superseded_acknowledged'], { output: { summary: 'strategy says no webhooks' }, evidence: [{ ref: 'docs/old.md' }] });
  assert.equal(silent.superseded_acknowledged!.length, 1);
  const said = run(['superseded_acknowledged'], { output: { summary: 'old.md is superseded by new.md' }, evidence: [{ ref: 'docs/old.md' }] });
  assert.deepEqual(said.superseded_acknowledged, []);
});

test('a proposal ends in a decision that names who decides and by when', () => {
  const ok = run(['decision_ask_present'], { output: { artifact: 'docs/proposal.md' }, input: { audience: 'Sam Ortiz', decisionBy: 'Oct 15' } });
  assert.deepEqual(ok.decision_ask_present, []);
  const wrong = run(['decision_ask_present'], { output: { artifact: 'docs/proposal.md' }, input: { audience: 'Dana Okafor' } });
  assert.equal(wrong.decision_ask_present!.length, 1);
});
