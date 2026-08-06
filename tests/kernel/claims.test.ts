import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findUntaggedClaims, findScaffoldingCitations } from '../../src/kernel/verify/claims.ts';

test('flags a dollar figure with no citation or unverified tag', () => {
  const findings = findUntaggedClaims('Revenue grew to $4.2M last quarter.');
  assert.equal(findings.length, 1);
});

test('accepts a claim with a citation marker', () => {
  const findings = findUntaggedClaims('Revenue grew to $4.2M last quarter. [cite:q3-report.pdf]');
  assert.equal(findings.length, 0);
});

test('accepts a claim explicitly tagged unverified', () => {
  const findings = findUntaggedClaims('Adoption is roughly 40% of the target market. [unverified]');
  assert.equal(findings.length, 0);
});

test('ignores prose with no load-bearing claim shape', () => {
  const findings = findUntaggedClaims('The team met on Tuesday to discuss scope.');
  assert.equal(findings.length, 0);
});

// The statute and duration fixtures below are the recorded first-run
// simulation deliverable's own phrasing, not text written to fit the matcher.

test('flags an uncited statute reference in the recorded art.-plus-section form', () => {
  const findings = findUntaggedClaims(
    'Employee status follows from Polish Labour Code art. 22 §1(1).',
  );
  assert.equal(findings.length, 1);
});

test('flags an uncited plural arts. reference', () => {
  const findings = findUntaggedClaims('Moral rights are governed by Copyright Act arts. 41/43.');
  assert.equal(findings.length, 1);
});

test('flags an uncited directive number', () => {
  const findings = findUntaggedClaims('Late-payment interest accrues under Directive 2011/7.');
  assert.equal(findings.length, 1);
});

test('flags an uncited numeric duration', () => {
  const findings = findUntaggedClaims('The breach must be reported within 72 hours of awareness.');
  assert.equal(findings.length, 1);
});

test('accepts a statute reference with a citation marker', () => {
  const findings = findUntaggedClaims(
    'Processing obligations flow down under GDPR art. 28. [cite:gdpr-art-28]',
  );
  assert.equal(findings.length, 0);
});

test('does not flag bare spelled-out quantities — those belong to the substantive pass', () => {
  const findings = findUntaggedClaims(
    'The licence covers three of the five fields of exploitation.',
  );
  assert.equal(findings.length, 0);
});

test('a citation naming the domain catalog is refused: scaffolding is not evidence', () => {
  // Exact lines from a recorded live run (opencode, ollama/qwen3.5:4b,
  // employment role): the catalog contains none of the cited content.
  const observed = [
    "- Poland's labor code (Kodeks Pracy) governs contractor classification and employment terms [domain catalog]",
    '- GDPR non-compliance creates fines up to 20 million EUR or 4% of global turnover [domain catalog]',
    'CITE: domain catalog; employment law jurisdictional requirements',
  ].join('\n');
  const findings = findScaffoldingCitations(observed);
  assert.equal(findings.length, 3);
});

test('the source-prefixed form observed on another live run is refused too', () => {
  const line =
    'Voice recordings are personal data. [source: domain catalog — GDPR Art. 4(1), CCPA/CPRA definitions]';
  assert.equal(findScaffoldingCitations(line).length, 1);
});

test('the other scaffolding artifacts a dispatch names are refused by name', () => {
  assert.equal(findScaffoldingCitations('Retention is 30 days. [cite: playbook]').length, 1);
  assert.equal(findScaffoldingCitations('Access widened. [cite: role lens]').length, 1);
  assert.equal(findScaffoldingCitations('Seen before. [cite: work log]').length, 1);
  assert.equal(findScaffoldingCitations('Contractor signals. [cite: keyword map]').length, 1);
});

test('legitimate citations and prose mentions of the catalog are not refused', () => {
  const fine = [
    'Fines reach 20 million EUR or 4% of turnover. [cite: GDPR Art. 83(5)]',
    'The retention period is unstated. [unverified]',
    'See agreement.pdf for the indemnity clause. [cite: agreement.pdf]',
    'The domain catalog is how Construct decides which roles engage.',
    'Their product catalog lists 40 SKUs. [cite: catalog-2026.pdf]',
  ].join('\n');
  assert.equal(findScaffoldingCitations(fine).length, 0);
});
