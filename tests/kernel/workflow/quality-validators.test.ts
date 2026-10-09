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
import { runValidators, figuresIn, citedFiguresIn, evaluateExpression, periodCoverage, sourcesCoverage, type ValidationSubject } from '../../../src/kernel/workflow/validators.ts';
import { createEvidenceResolver } from '../../../src/kernel/project/evidence.ts';
import { resolvePeriod, type PeriodSpec } from '../../../src/kernel/registry/slots.ts';

const root = mkdtempSync(join(tmpdir(), 'construct-quality-'));
mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'docs', 'metrics.md'), '429 responses: Jun 1.6M, Sep 2.1M. Three accounts are 18% of Enterprise ARR.\n');
writeFileSync(join(root, 'docs', 'template.md'), '# PRD: <title>\n## 1. Problem\n## 2. Evidence\n## 3. Risks & open questions\n');
writeFileSync(join(root, 'docs', 'prd.md'), '# PRD: Webhooks\n## Problem\n429s rose to 2.1M (PLAT-101, RFC-012, decided 2026-09-02).\n## Evidence\n18% of Enterprise ARR.\n');
writeFileSync(join(root, 'docs', 'fabricated.md'), '# PRD\nNorthwind is worth $2.4M ARR.\n');
writeFileSync(join(root, 'docs', 'old.md'), 'old strategy');
writeFileSync(join(root, 'docs', 'proposal.md'), '# Proposal\n## Decision needed\nSam Ortiz decides by Oct 15 whether to fund webhooks.\n');
writeFileSync(join(root, 'docs', 'proposal-day-first.md'), '# Proposal\n## Decision\nSam Ortiz decides before 16 October.\n');
writeFileSync(join(root, 'docker-compose.yml'), 'services:\n  ledger:\n    image: postgres:16\n    ports:\n      - "5432:5432"\n  checkout:\n    ports:\n      - "8080:8080"\n');
writeFileSync(join(root, 'docs', 'architecture.md'), '# Architecture\n```mermaid\nC4Container\n  ContainerDb(ledger, "ledger", "Postgres 16", "port 5432")\n  Container(checkout, "checkout", "Node", "port 8080")\n```\n');
writeFileSync(join(root, 'docs', 'latency.md'), '# Latency\ncheckout p99 is 420ms.\n');
mkdirSync(join(root, 'src'), { recursive: true });
writeFileSync(join(root, 'src', 'retry.ts'), 'export const TIMEOUT_MS = 45000;\nexport const RETRIES = 7;\n');
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

test('a decisionBy given as a date is found however the decision section writes the day', () => {
  const by = (artifact: string, decisionBy: string) => run(['decision_ask_present'], { output: { artifact }, input: { audience: 'Sam Ortiz', decisionBy } }).decision_ask_present;
  assert.deepEqual(by('docs/proposal.md', '2026-10-15'), [], '"Oct 15" names 2026-10-15');
  assert.deepEqual(by('docs/proposal-day-first.md', '2026-10-16'), [], '"16 October" names 2026-10-16');
  assert.deepEqual(by('docs/proposal.md', '2026-10-01'), ['the decision section does not say by when'], '"Oct 15" does not name October 1');
  assert.deepEqual(by('docs/proposal.md', '2026-11-15'), ['the decision section does not say by when'], 'another month is another day');
  assert.deepEqual(by('docs/proposal.md', 'next sprint'), ['the decision section does not say by when'], 'a free-text deadline is matched as written');
});

test('a step that declares the files it changed may honestly change none; one that names none otherwise still fails', () => {
  assert.deepEqual(run(['artifacts_exist'], { output: { summary: 'analysis only', changes: [], artifact: null }, expectedKeys: ['summary', 'findings', 'changes', 'artifact'] }).artifacts_exist, []);
  assert.equal(run(['artifacts_exist'], { output: {}, expectedKeys: ['summary', 'findings', 'changes', 'artifact'] }).artifacts_exist!.length, 1, 'no changes list at all is not an honest none');
  assert.equal(run(['artifacts_exist'], { output: { changes: [] }, expectedKeys: ['summary', 'artifact'] }).artifacts_exist!.length, 1, 'a step that must write its artifact cannot list no changes instead');
  assert.deepEqual(run(['artifacts_exist'], { output: { changes: [{ path: 'docs/gone.md', removed: true }, 'docs/metrics.md'] }, expectedKeys: ['changes'] }).artifacts_exist, [], 'a removed file is not looked for');
  assert.deepEqual(run(['artifacts_exist'], { output: { changes: [{ path: 'docs/gone.md', removed: true }] }, expectedKeys: ['changes'] }).artifacts_exist, [], 'a step that only removed files wrote nothing to check');
});

test('figures in a document a step wrote are grounded only by something else it cited; code it changed or named is not read for figures', () => {
  const diagram = { summary: 'the payments containers', findings: ['the ledger is Postgres 16 on port 5432'], changes: ['docs/architecture.md'], artifact: 'docs/architecture.md' };
  const compose = 'image: postgres:16\n- "8080:8080"';
  assert.deepEqual(figuresIn(compose), [], 'stated this way they are not figures a claim makes');
  assert.ok(['16', '8080'].every((f) => citedFiguresIn(compose).includes(f)), 'but cited configuration gives the figures it sets');
  assert.deepEqual(run(['numbers_grounded'], { output: diagram, evidence: [{ ref: 'docker-compose.yml' }] }).numbers_grounded, [], '"postgres:16" and "8080:8080" in the cited compose file ground "Postgres 16" and "port 8080"');
  const self = run(['numbers_grounded'], { output: diagram, evidence: [{ ref: 'docs/architecture.md' }, { ref: './docs/architecture.md' }] }).numbers_grounded!;
  assert.ok(self.some((p) => p.startsWith('the figure "16" appears in no cited source')), self.join('\n'));
  assert.ok(self.every((p) => p.includes('(citing docs/architecture.md, ./docs/architecture.md, which this step wrote, grounds nothing in it)')), 'the problem says why the citation did not count');

  const invented = run(['numbers_grounded'], { output: { summary: 'checkout is slow', findings: ['checkout p99 is 420ms'], changes: [], artifact: null }, evidence: [{ ref: 'docker-compose.yml' }] }).numbers_grounded!;
  assert.deepEqual(invented, ['the figure "420ms" appears in no cited source; cite where it comes from, or list it under derivations with the expression that computes it']);
  const inArtifact = run(['numbers_grounded'], { output: { summary: 'latency', findings: ['see the note'], changes: [], artifact: 'docs/latency.md' }, evidence: [{ ref: 'docker-compose.yml' }] }).numbers_grounded!;
  assert.equal(inArtifact.length, 1, 'a document named as the artifact is read for figures');
  symlinkSync('latency.md', join(root, 'docs', 'latency-link.md'));
  const viaLink = run(['numbers_grounded'], { output: { summary: 'latency', findings: ['see the note'], changes: [], artifact: 'docs/latency.md' }, evidence: [{ ref: 'docs/latency-link.md' }] }).numbers_grounded!;
  assert.deepEqual(viaLink, ['the figure "420ms" appears in no cited source; cite where it comes from, or list it under derivations with the expression that computes it (citing docs/latency-link.md, which this step wrote, grounds nothing in it)'], 'a link to the artifact is the artifact');
  const otherCase = run(['numbers_grounded'], { output: { summary: 'latency', findings: ['see the note'], changes: [], artifact: 'docs/latency.md' }, evidence: [{ ref: 'docs/LATENCY.md' }] }).numbers_grounded!;
  assert.ok(otherCase.length === 1 && otherCase[0]!.includes('"420ms"'), 'the artifact in another letter case grounds nothing, whether or not the disk folds case');

  const code = { summary: 'retry timeout raised', findings: ['the retry timeout is now longer'], changes: ['src/retry.ts'], artifact: null };
  assert.deepEqual(run(['numbers_grounded'], { output: code, evidence: [{ ref: 'docs/metrics.md' }] }).numbers_grounded, [], 'figures in changed code are the change itself, not claims');
  assert.equal(run(['numbers_grounded'], { output: { ...code, changes: ['src/retry.ts', 'docs/latency.md'] }, evidence: [{ ref: 'docs/metrics.md' }] }).numbers_grounded!.length, 1, 'a changed document is read');
  assert.deepEqual(run(['numbers_grounded'], { output: { ...code, artifact: 'src/retry.ts' }, evidence: [{ ref: 'docs/metrics.md' }] }).numbers_grounded, [], 'code named as the artifact is not read for figures either');
  const stated = { ...code, findings: ['TIMEOUT_MS is now 45000'] };
  assert.deepEqual(run(['numbers_grounded'], { output: stated, evidence: [{ ref: 'src/retry.ts' }] }).numbers_grounded, [], 'citing the changed code grounds what the output says it now holds');
  assert.deepEqual(run(['numbers_grounded'], { output: { ...stated, artifact: 'src/retry.ts' }, evidence: [{ ref: 'src/retry.ts' }] }).numbers_grounded, [], 'and so does citing the code named as the artifact');
  assert.equal(run(['numbers_grounded'], { output: stated, evidence: [{ ref: 'docs/metrics.md' }] }).numbers_grounded!.length, 1, 'a value stated without citing where it is set is still a claim');
});

test('cited text gives the figures configuration sets, never a date, a year, or digits inside an identifier', () => {
  const gives: [string, string[]][] = [['image: postgres:16', ['16']], ['- "8080:8080"', ['8080']], ['- "80:80"', ['80']], ['- "443:443"', ['443']], ['PORT=8443', ['8443']], ['timeout: 15000', ['15000']], ['FROM node:22-alpine', ['22']], ['image: redis:7.2', ['7.2']], ['ports: 10, 20, 30', ['10', '20', '30']], ['1,600 users', ['1600']], ['q3,1200,3400', ['12003400', '1200', '3400']]];
  for (const [text, figures] of gives) assert.deepEqual([...new Set(citedFiguresIn(text))], figures, text);
  for (const text of ['PAY-420', 'see pull/311', 'acme/checkout#311', 'commit 7d4987f4', 'commit 81c3e2a', 'id 550e8400-e29b-41d4', 'Target date 2026-09-18', 'standup at 10:30', 'deployed at 9:05am', 'Updated 2026-09-30T14:22:05.000+0000', 'In 2026', 'v1.25.3']) assert.deepEqual(citedFiguresIn(text), [], text);

  const items = createEvidenceResolver({
    root,
    sources: [{ id: 'jira', kind: 'jira', locator: null, provenance: 'reported', manifest: [
      { ref: 'PAY-420', kind: 'item', fingerprint: 'p', text: 'Split cart out of checkout (PAY-420).' },
      { ref: 'PAY-7', kind: 'item', fingerprint: 'd', text: 'Target date 2026-09-18' },
    ] }],
  });
  const dated = run(['numbers_grounded'], { output: { summary: 'launch plan', findings: ['about 2k users get it first', 'we run 18 replicas'] }, evidence: [{ ref: 'jira:PAY-7' }], resolve: items }).numbers_grounded!;
  assert.deepEqual(dated.map((p) => /"([^"]+)"/.exec(p)?.[1]), ['2k', '18'], 'a cited date grounds neither a figure near its year nor its day');
  const keyed = run(['numbers_grounded'], { output: { summary: 'checkout', findings: ['checkout p99 is 420ms'] }, evidence: [{ ref: 'jira:PAY-420' }], resolve: items }).numbers_grounded!;
  assert.deepEqual(keyed, ['the figure "420ms" appears in no cited source; cite where it comes from, or list it under derivations with the expression that computes it'], 'a ticket key grounds no latency');
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

const dated = createEvidenceResolver({
  root,
  sources: [
    { id: 'docs', kind: 'directory', locator: join(root, 'docs'), manifest: [] },
    { id: 'jira', kind: 'jira', locator: null, provenance: 'reported', manifest: [
      { ref: 'PAY-410', kind: 'item', fingerprint: 'a', text: 'inside', updatedAt: '2026-08-14T10:00:00Z' },
      { ref: 'PAY-430', kind: 'item', fingerprint: 'b', text: 'after', updatedAt: '2026-10-05T08:00:00.000+0000' },
      { ref: 'PAY-100', kind: 'item', fingerprint: 'c', text: 'before', updatedAt: '2026-05-02' },
      { ref: 'PAY-200', kind: 'item', fingerprint: 'd', text: 'no date' },
    ] },
    { id: 'wiki', kind: 'docs', locator: null, provenance: 'reported', manifest: [{ ref: 'arch', kind: 'item', fingerprint: 'e', text: 'architecture' }] },
  ],
});
const AT = '2026-10-08T12:00:00.000Z';
const q3 = (semantics: PeriodSpec['semantics']) => resolvePeriod(semantics === 'as_of' ? { semantics, to: '2026-09-30' } : { semantics, quarter: 3, year: 2026 }, AT);
const ALL = [{ ref: 'jira:PAY-410' }, { ref: 'jira:PAY-430' }, { ref: 'jira:PAY-100' }, { ref: 'jira:PAY-200' }, { ref: 'docs/metrics.md' }];
const periodCheck = (semantics: PeriodSpec['semantics'], output: Record<string, unknown> = {}, evidence = ALL) =>
  runValidators(['within_period'], { output, expectedKeys: [], evidence, resolvableRefs: new Set(), resolve: dated, period: q3(semantics) })[0]!.problems;

test('within_period refuses only an item updated after the period ends, under every reading of the period', () => {
  for (const semantics of ['as_of', 'changed_during', 'evidence_window'] as const) {
    assert.deepEqual(periodCheck(semantics), ['"jira:PAY-430" was updated 2026-10-05, after the period ends (2026-09-30); cite a version from inside the period, or list it under "outsidePeriod" with why it belongs'], semantics);
  }
  assert.deepEqual(periodCheck('evidence_window', {}, [{ ref: 'jira:PAY-100' }, { ref: 'jira:PAY-200' }, { ref: 'docs/metrics.md' }, { ref: 'docs' }]), [], 'older items, undated items, files and folders are never refused');
  assert.deepEqual(runValidators(['within_period'], { output: {}, expectedKeys: [], evidence: ALL, resolvableRefs: new Set(), resolve: dated })[0]!.problems, [], 'with no period there is nothing to check against');
  assert.deepEqual(runValidators(['within_period'], { output: {}, expectedKeys: [], evidence: ALL, resolvableRefs: new Set(), period: q3('as_of') })[0]!.problems, [], 'with no resolver nothing can be dated');
});

test('within_period: an item after the period passes once the output says why it belongs, and an acknowledgment must name something cited', () => {
  assert.deepEqual(periodCheck('changed_during', { outsidePeriod: [{ ref: 'PAY-430', why: 'the incident review closed after the quarter' }] }), [], 'listed by its item ref while cited as jira:PAY-430');
  assert.deepEqual(periodCheck('changed_during', { outsidePeriod: [{ ref: 'jira:PAY-430', why: '  ' }] }), ['"outsidePeriod" lists "jira:PAY-430" without saying why it belongs']);
  assert.deepEqual(periodCheck('changed_during', { outsidePeriod: [{ ref: 'jira:PAY-430', why: 'late fix' }, { ref: 'jira:PAY-999', why: 'also relevant' }] }), ['"outsidePeriod" lists "jira:PAY-999", which this step does not cite; list only what you cite']);
  assert.deepEqual(periodCheck('changed_during', { outsidePeriod: [{ why: 'no ref' }, 'PAY-430'] }).slice(0, 2), ['an "outsidePeriod" entry names no ref; give {ref, why}', 'an "outsidePeriod" entry names no ref; give {ref, why}']);
  assert.ok(periodCheck('changed_during', { outsidePeriod: { ref: 'jira:PAY-430', why: 'x' } }).includes('"outsidePeriod" must be a list of {ref, why}'));
});

test('period coverage places every cited item, file, and folder, and keeps only acknowledgments of items after the period', () => {
  const cited = [...ALL, { ref: 'jira:PAY-410' }, { ref: 'jira' }, { ref: 'project_context' }, { ref: 'wiki:missing' }];
  const window = periodCoverage(cited, dated, q3('evidence_window'), [{ ref: 'PAY-430', why: 'late fix' }, { ref: 'jira:PAY-410', why: 'not needed' }, { ref: 'jira:PAY-430', why: 'said twice' }]);
  assert.deepEqual(window, {
    inside: ['jira:PAY-410'],
    before: ['jira:PAY-100'],
    after: ['jira:PAY-430'],
    undated: ['jira:PAY-200', 'docs/metrics.md'],
    acknowledged: [{ ref: 'PAY-430', why: 'late fix' }],
  }, 'a whole source, a surface and an unresolved ref are not counted');
  const asOf = periodCoverage(cited, dated, q3('as_of'), []);
  assert.deepEqual([asOf.inside, asOf.before], [['jira:PAY-410', 'jira:PAY-100'], []], 'as of a day, everything updated by then is inside');
});

test('named_sources_read needs something cited from each named source, or the source listed as unread with why', () => {
  const named = (evidence: { ref: string }[], output: Record<string, unknown> = {}, sources = ['jira', 'wiki', 'docs']) =>
    runValidators(['named_sources_read'], { output, expectedKeys: [], evidence, resolvableRefs: new Set(), resolve: dated, sources })[0]!.problems;
  assert.deepEqual(named([{ ref: 'jira:PAY-410' }, { ref: 'wiki:arch' }, { ref: 'docs/metrics.md' }]), [], 'an item, a page, and a file inside a folder source each count');
  assert.deepEqual(named([{ ref: 'source:jira' }, { ref: 'wiki' }, { ref: 'docs' }], {}, ['jira', 'wiki']), [
    'this run names jira, and this step cites nothing read from it; cite what you read (as jira:<item>), or list it under "unread" with why',
    'this run names wiki, and this step cites nothing read from it; cite what you read (as wiki:<item>), or list it under "unread" with why',
  ], 'naming a whole source reads nothing from it');
  assert.deepEqual(named([{ ref: 'jira:PAY-410' }], { unread: [{ source: 'wiki', why: 'the connector was not signed in' }] }, ['jira', 'wiki']), []);
  assert.deepEqual(named([{ ref: 'jira:PAY-410' }], { unread: [{ source: 'wiki', why: '' }] }, ['jira', 'wiki']), ['"unread" lists wiki without saying why it could not be read']);
  assert.deepEqual(named([{ ref: 'jira:PAY-410' }], {}, []), [], 'a run that names no source has nothing to check');
  assert.deepEqual(runValidators(['named_sources_read'], { output: {}, expectedKeys: [], evidence: [{ ref: 'jira:PAY-410' }], resolvableRefs: new Set(), sources: ['jira'] })[0]!.problems, ['nothing was supplied to check what was read from jira'], 'with no resolver it fails closed');
  assert.deepEqual(sourcesCoverage([{ ref: 'jira:PAY-410' }, { ref: 'wiki' }], dated, ['jira', 'wiki', 'docs'], [{ source: 'wiki', why: 'not signed in' }, { source: 'jira', why: 'moot' }, { source: 'other', why: 'not named' }]), {
    named: ['jira', 'wiki', 'docs'], read: ['jira'], unread: [{ source: 'wiki', why: 'not signed in' }],
  });
});
