/**
 * tests/kernel/workflow/quality-validators.test.ts — the grounding and
 * quality floors: citations name real things, artifacts exist, figures come
 * from what was cited, templates are followed, conflicts and supersession are
 * said out loud, and a proposal ends in a decision someone owns.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
    { id: 'wiki', kind: 'docs', locator: null, provenance: 'reported', manifest: [{ ref: 'okrs', kind: 'item', fingerprint: 'k', text: 'reduce 429s by 50% vs June', url: 'https://wiki.example/okrs' }] },
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

test('excerpts must appear in what they cite; at least one citation must hold content Construct can check', () => {
  assert.equal(resolve('wiki:page'), null, 'an item no recorded read holds does not resolve');
  const quoted = run(['excerpts_match'], { evidence: [{ ref: 'docs/metrics.md', excerpt: 'Jun   1.6M,  Sep 2.1M' }, { ref: 'wiki:page', excerpt: 'cannot be checked here' }] });
  assert.deepEqual(quoted.excerpts_match, []);
  const misquoted = run(['excerpts_match'], { evidence: [{ ref: 'docs/metrics.md', excerpt: 'Sep 3.4M' }] });
  assert.equal(misquoted.excerpts_match!.length, 1);
  assert.deepEqual(run(['evidence_recorded'], { evidence: [{ ref: 'wiki:okrs' }] }).evidence_recorded, [], 'a recorded read with its text holds content');
  assert.equal(run(['evidence_recorded'], { evidence: [{ ref: 'project_context' }] }).evidence_recorded!.length, 1, 'a surface holds no text to check');
  assert.equal(run(['evidence_recorded'], { evidence: [{ ref: 'wiki:a' }] }).evidence_recorded!.length, 1);
  assert.deepEqual(run(['evidence_recorded'], { evidence: [{ ref: 'wiki:a' }, { ref: 'docs/metrics.md' }] }).evidence_recorded, []);
  const blank = createEvidenceResolver({ root, sources: [{ id: 'wiki', kind: 'docs', locator: null, provenance: 'reported', manifest: [{ ref: 'blank', kind: 'item', fingerprint: 'b', text: '  ' }] }] });
  const [recorded] = runValidators(['evidence_recorded'], { output: {}, expectedKeys: [], evidence: [{ ref: 'wiki:blank' }], resolvableRefs: new Set(), resolve: blank });
  assert.equal(recorded!.ok, false, 'an item recorded with empty text holds nothing to check');
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

test('dates and times are not figures, but a figure after a month name still is', () => {
  assert.deepEqual(figuresIn('Decision by Oct 15, 2026; launch 15 December; standup 10:30am; due 9/30'), []);
  assert.deepEqual(figuresIn('June 1.6M, September 2.1M, May 40%'), ['1.6m', '2.1m', '40%']);
});

test('a figure written in another notation or rounded the way people write is still grounded; a different value is not', () => {
  const r = run(['numbers_grounded'], { output: { summary: 'about 2M requests (2,100,000 exactly is in the snapshot as 2.1M)' }, evidence: [{ ref: 'docs/metrics.md' }] });
  assert.deepEqual(r.numbers_grounded, []);
  const off = run(['numbers_grounded'], { output: { summary: '3M requests' }, evidence: [{ ref: 'docs/metrics.md' }] });
  assert.equal(off.numbers_grounded!.length, 1);
  const asked = run(['numbers_grounded'], { output: { summary: 'budget of 250k as requested' }, evidence: [{ ref: 'docs/metrics.md' }], input: { request: 'plan within a 250k budget' } });
  assert.deepEqual(asked.numbers_grounded, [], 'a figure the person gave is not invented');
});

test('a symlink out of the project does not resolve; an unrecorded web page is not taken on the host\'s word', () => {
  const outside = mkdtempSync(join(tmpdir(), 'construct-outside-'));
  try {
    writeFileSync(join(outside, 'secret.env'), 'API_KEY=x');
    symlinkSync(join(outside, 'secret.env'), join(root, 'docs', 'link.md'));
    assert.equal(resolve('docs/link.md'), null);
    assert.equal(resolve('https://example.com/report#p2'), null, 'under require an unrecorded page does not resolve');
    const accept = createEvidenceResolver({ root, hostReads: 'accept', sources: [] });
    assert.equal(accept('https://example.com/report')?.kind, 'web');
    assert.equal(accept('https://example.com/report')?.provenance, 'unverified');
    const recorded = resolve('https://wiki.example/okrs#q3');
    assert.equal(recorded?.sourceId, 'wiki');
    assert.equal(recorded?.itemRef, 'okrs');
    assert.match(recorded?.text ?? '', /50%/);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test('an excerpt grounds a figure only when it was checked against text Construct holds', () => {
  const bare = run(['numbers_grounded', 'excerpts_match'], { output: { summary: 'revenue grew 40%' }, evidence: [{ ref: 'project_context', excerpt: 'revenue grew 40%' }] });
  assert.ok(bare.numbers_grounded!.some((p) => p.includes('40%')), 'a surface excerpt carrying the figure grounds nothing');
  assert.deepEqual(bare.excerpts_match, [], 'an excerpt with no held text is not checked');
  const held = createEvidenceResolver({ root, sources: [{ id: 'web', kind: 'other', locator: null, provenance: 'reported', manifest: [{ ref: 'https://news.example.com/q3', kind: 'item', fingerprint: 'n', text: 'Revenue grew 40% in Q3.' }] }] });
  const grounded = runValidators(['numbers_grounded'], { output: { summary: 'revenue grew 40%' }, expectedKeys: [], evidence: [{ ref: 'https://news.example.com/q3' }], resolvableRefs: new Set(), resolve: held });
  assert.deepEqual(grounded[0]!.problems, []);
});

test('text cut at the cap: a quote past the cut is unchecked, and a figure past it is told to report the part it relies on', () => {
  const held = createEvidenceResolver({ root, sources: [{ id: 'wiki', kind: 'docs', locator: null, provenance: 'reported', manifest: [{ ref: 'long', kind: 'item', fingerprint: 'l', text: 'Intro only. 12% of calls', truncated: true }] }] });
  const r = runValidators(['excerpts_match', 'numbers_grounded'], { output: { summary: 'retries cost 9.9M a year' }, expectedKeys: [], evidence: [{ ref: 'wiki:long', excerpt: 'past the cut' }], resolvableRefs: new Set(), resolve: held });
  const by = Object.fromEntries(r.map((x) => [x.validator, x.problems]));
  assert.deepEqual(by.excerpts_match, []);
  assert.equal(by.numbers_grounded!.length, 1);
  assert.match(by.numbers_grounded![0]!, /the recorded text of wiki:long was cut at 16 KiB; report the part you rely on as its own item/);
});

test('sources_diverse counts only places that hold content: not unverified refs, surfaces, or whole sources, and two pages of one site once', () => {
  const held = createEvidenceResolver({
    root,
    hostReads: 'accept',
    sources: [
      { id: 'web', kind: 'other', locator: null, provenance: 'reported', manifest: [
        { ref: 'https://www.example.com/a', kind: 'item', fingerprint: 'a', text: 'page a' },
        { ref: 'https://example.com/b', kind: 'item', fingerprint: 'b', text: 'page b' },
      ] },
      { id: 'wiki', kind: 'docs', locator: null, provenance: 'reported', manifest: [{ ref: 'okrs', kind: 'item', fingerprint: 'k', text: 'okrs' }] },
    ],
  });
  const check = (evidence: { ref: string }[]) => runValidators(['sources_diverse'], { output: {}, expectedKeys: [], evidence, resolvableRefs: new Set(), resolve: held })[0]!.problems;
  assert.equal(check([{ ref: 'https://www.example.com/a' }, { ref: 'https://example.com/b' }]).length, 1, 'two pages of one website are one place');
  assert.equal(check([{ ref: 'https://www.example.com/a' }, { ref: 'wiki:invented' }, { ref: 'https://other.example.org/x' }, { ref: 'project_context' }, { ref: 'wiki' }]).length, 1, 'unverified refs, surfaces and whole sources do not count');
  assert.deepEqual(check([{ ref: 'https://www.example.com/a' }, { ref: 'wiki:okrs' }]), []);
  assert.deepEqual(check([{ ref: 'https://www.example.com/a' }, { ref: 'docs/metrics.md' }]), []);
});

test('review findings: a derivation that only says where a figure came from is not a check of it, and a large artifact is not empty', () => {
  const described = run(['numbers_grounded'], { output: { summary: 'Northwind is worth $2.4M', derivations: [{ value: '$2.4M', from: 'the finance team' }] }, evidence: [{ ref: 'docs/metrics.md' }] });
  assert.ok(described.numbers_grounded!.some((p) => p.includes('gives no expression')));
  writeFileSync(join(root, 'docs', 'big.md'), `# Big\n${'x'.repeat(1024 * 1024 + 10)}\n`);
  assert.deepEqual(run(['artifacts_exist'], { output: { artifact: 'docs/big.md' } }).artifacts_exist, []);
  writeFileSync(join(root, 'docs', 'blank.md'), '   \n');
  assert.equal(run(['artifacts_exist'], { output: { artifact: 'docs/blank.md' } }).artifacts_exist!.length, 1);
});

test('an excerpt and the recorded text it quotes still match when both carry the same secret, whichever side was cleaned', () => {
  const BODY = 'a1B2c3D4e5F6g7H8i9J0';
  const secret = `ghp_${BODY}${BODY.slice(0, 4)}`;
  const said = `rotate ${secret} before launch`;
  const held = createEvidenceResolver({
    root,
    sources: [
      { id: 'wiki', kind: 'docs', locator: null, provenance: 'reported', manifest: [
        { ref: 'cleaned', kind: 'item', fingerprint: 'a', text: 'Runbook: rotate [redacted] before launch.' },
        { ref: 'older', kind: 'item', fingerprint: 'b', text: `Runbook: ${said}.` },
        { ref: 'cut', kind: 'item', fingerprint: 'c', text: 'Runbook: the first part only', truncated: true },
      ] },
    ],
  });
  const check = (evidence: { ref: string; excerpt: string }[]) => runValidators(['excerpts_match'], { output: {}, expectedKeys: [], evidence, resolvableRefs: new Set(), resolve: held })[0]!.problems;
  assert.deepEqual(check([{ ref: 'wiki:cleaned', excerpt: said }]), [], 'a quote with the secret matches text kept without it');
  assert.deepEqual(check([{ ref: 'wiki:older', excerpt: 'rotate [redacted] before launch' }]), [], 'a cleaned quote matches text recorded before cleaning');
  assert.equal(check([{ ref: 'wiki:cleaned', excerpt: 'rotate nothing before launch' }]).length, 1, 'a different quote is still a misquote');
  assert.deepEqual(check([{ ref: 'wiki:cut', excerpt: 'the second part' }]), [], 'text cut at the cap may hold the quote past the cut: unchecked, not a misquote');
});
