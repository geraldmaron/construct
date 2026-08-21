/**
 * tests/kernel/run/repoaudit.test.ts — the enablement audit's pure judgment:
 * facts in, gate findings and write proposals out, with no filesystem in
 * sight.
 *
 * The properties held here are the ones a person deciding on a filed
 * proposal depends on: every finding cites a real file (or its declared
 * absence) rather than a guessed score, a gate already enabled produces no
 * proposal, a missing gate produces exactly one, the tier is a fixed property
 * of the gate rather than of how the finding happens to be phrased, and the
 * rendered deliverable fills every slot the template declares.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIT_TEMPLATE,
  GATE_IDS,
  auditProposals,
  evaluateGates,
  renderAuditDeliverable,
} from '../../../src/kernel/run/repoaudit.ts';
import type { RepoFacts } from '../../../src/kernel/run/repoaudit.ts';

const NOTHING_ENABLED: RepoFacts = {
  root: '/repo',
  packageJson: { path: '/repo/package.json', scripts: {} },
  ciWorkflowFiles: [],
  eslintConfigPath: null,
  isTypeScriptProject: true,
};

const EVERYTHING_ENABLED: RepoFacts = {
  root: '/repo',
  packageJson: {
    path: '/repo/package.json',
    scripts: {
      'test:a11y': 'jest --config a11y.jest.config.js',
      'test:security': 'audit-ci --moderate',
      lint: 'eslint . --max-warnings=0',
      typecheck: 'tsc --noEmit',
    },
  },
  ciWorkflowFiles: ['.github/workflows/ci.yml'],
  eslintConfigPath: '.eslintrc.json',
  isTypeScriptProject: true,
};

const NO_PACKAGE_JSON: RepoFacts = {
  root: '/repo',
  packageJson: null,
  ciWorkflowFiles: [],
  eslintConfigPath: null,
  isTypeScriptProject: false,
};

test('every gate is checked, in a fixed order', () => {
  const findings = evaluateGates(NOTHING_ENABLED);
  assert.deepEqual(
    findings.map((f) => f.gate),
    [...GATE_IDS],
  );
});

test('a repo carrying nothing gets a missing finding for every gate, citing the file read', () => {
  const findings = evaluateGates(NOTHING_ENABLED);
  for (const finding of findings) {
    assert.equal(finding.status, 'missing');
    // CI is read from .github/workflows regardless of package.json; every
    // other gate is read from package.json's own script list.
    assert.equal(finding.citation, finding.gate === 'ci' ? '/repo/.github/workflows' : '/repo/package.json');
    assert.match(finding.detail, /no .* script|no "lint" script|no CI configuration found/);
  }
});

test('a repo already carrying every gate produces no proposal for any of them', () => {
  const findings = evaluateGates(EVERYTHING_ENABLED);
  for (const finding of findings) {
    assert.equal(finding.status, 'enabled', `${finding.gate} expected enabled`);
    assert.equal(finding.proposedChange, null);
    // The citation still names the real file and quotes what was actually
    // read there, so an "enabled" verdict is checkable too, not asserted.
    assert.ok(finding.detail.length > 0);
  }
  const proposals = auditProposals({ findings, source: 'src-1', locator: '/repo' });
  assert.deepEqual(proposals, []);
});

test('typecheck is not-applicable, not missing, for a repo that is not TypeScript', () => {
  const findings = evaluateGates({ ...NOTHING_ENABLED, isTypeScriptProject: false });
  const typecheck = findings.find((f) => f.gate === 'typecheck');
  assert.equal(typecheck?.status, 'not-applicable');
  assert.equal(typecheck?.proposedChange, null);
  // Not-applicable never becomes a proposal: claiming a non-TypeScript repo
  // is missing a typecheck script would be exactly the guessed benchmark
  // this audit exists to refuse.
  const proposals = auditProposals({ findings, source: 'src-1', locator: '/repo' });
  assert.ok(!proposals.some((p) => p.gate === 'typecheck'));
});

test('a repo with no package.json reports the honest absence and proposes nothing automatically', () => {
  const findings = evaluateGates(NO_PACKAGE_JSON);
  // typecheck is not-applicable here (not a TypeScript project) and CI is
  // read independently of package.json — both covered by their own tests.
  const packageDependent = findings.filter((f) => f.gate !== 'typecheck' && f.gate !== 'ci');
  assert.equal(packageDependent.length, 3);
  for (const finding of packageDependent) {
    assert.equal(finding.status, 'missing');
    assert.equal(finding.detail, 'no package.json found');
    // Missing is not the same as proposable: adding a script to a file that
    // does not exist would be authoring a new file, a different act than the
    // small additive edit the low tier is reasoned about.
    assert.equal(finding.proposedChange, null);
    assert.equal(finding.risk, null);
  }
  const proposals = auditProposals({ findings, source: 'src-1', locator: '/repo' });
  // CI is still independently missing and still proposable — its evidence
  // does not depend on package.json existing at all.
  assert.deepEqual(
    proposals.map((p) => p.gate),
    ['ci'],
  );
});

test('the tier is a fixed property of the gate: CI is high, every script addition is low', () => {
  const findings = evaluateGates(NOTHING_ENABLED);
  const byGate = Object.fromEntries(findings.map((f) => [f.gate, f]));
  assert.equal(byGate['ci']?.risk, 'high');
  assert.equal(byGate['a11y-tests']?.risk, 'low');
  assert.equal(byGate['security-tests']?.risk, 'low');
  assert.equal(byGate['lint-strictness']?.risk, 'low');
  assert.equal(byGate['typecheck']?.risk, 'low');
  for (const finding of findings) {
    assert.ok(finding.riskReason && finding.riskReason.length > 0, `${finding.gate} carries no stated reason`);
  }
});

test('a missing gate produces exactly one proposal, citing the file it came from', () => {
  const findings = evaluateGates(NOTHING_ENABLED);
  const proposals = auditProposals({ findings, source: 'src-1', locator: '/repo' });
  assert.equal(proposals.length, 5);
  for (const proposal of proposals) {
    assert.equal(proposal.source, 'src-1');
    // The justification cites the real file and what was read there — never
    // the external standard, which is framing, not evidence of this repo.
    assert.match(proposal.justification, /^\/repo\/(package\.json|\.github\/workflows): /);
    assert.doesNotMatch(proposal.justification, /WCAG|OWASP/);
    assert.match(proposal.change, /\/repo$/);
  }
  assert.deepEqual(
    proposals.map((p) => p.risk).sort(),
    ['high', 'low', 'low', 'low', 'low'],
  );
});

test('a11y and security obligations are named to the standard that grounds them', () => {
  const findings = evaluateGates(NOTHING_ENABLED);
  const byGate = Object.fromEntries(findings.map((f) => [f.gate, f]));
  assert.match(String(byGate['a11y-tests']?.standard), /WCAG/);
  assert.match(String(byGate['security-tests']?.standard), /OWASP/);
  // CI, lint strictness, and typecheck are engineering hygiene the audit
  // checks from the repo's own declared configuration, not obligations
  // pinned to an external standard — asserting one would be exactly the
  // decorative citation plan/standards.ts already refuses for other lenses.
  assert.equal(byGate['ci']?.standard, null);
  assert.equal(byGate['lint-strictness']?.standard, null);
  assert.equal(byGate['typecheck']?.standard, null);
});

test('ids are derived from the source and the gate, so auditing twice proposes the same rows', () => {
  const findings = evaluateGates(NOTHING_ENABLED);
  const first = auditProposals({ findings, source: 'src-1', locator: '/repo' });
  const second = auditProposals({ findings, source: 'src-1', locator: '/repo' });
  assert.deepEqual(first.map((p) => p.id), second.map((p) => p.id));
  assert.deepEqual(
    first.map((p) => p.id).sort(),
    ['wp-audit-src-1-a11y-tests', 'wp-audit-src-1-ci', 'wp-audit-src-1-lint-strictness', 'wp-audit-src-1-security-tests', 'wp-audit-src-1-typecheck'],
  );
});

test('a missing CI gate is reported with the honest absence, never a guessed score', () => {
  const findings = evaluateGates(NOTHING_ENABLED);
  const ci = findings.find((f) => f.gate === 'ci');
  assert.match(String(ci?.detail), /no CI configuration found/);
});

test('the rendered deliverable fills every slot the template declares', () => {
  const findings = evaluateGates(NOTHING_ENABLED);
  const proposals = auditProposals({ findings, source: 'src-1', locator: '/repo' });
  const text = renderAuditDeliverable({ locator: '/repo', findings, proposals });
  for (const s of AUDIT_TEMPLATE.slots) {
    const heading = s.name
      .split('-')
      .map((w) => w[0]?.toUpperCase() + w.slice(1))
      .join(' ');
    assert.match(text, new RegExp(`## ${heading}`), `no heading for slot "${s.name}"`);
  }
  assert.match(text, /no CI configuration found/);
  // Every proposal filed is traceable back into the same document a person
  // reads to decide on it.
  for (const proposal of proposals) assert.ok(text.includes(proposal.id));
});

test('a fully-enabled repo renders with no missing issues and no proposals', () => {
  const findings = evaluateGates(EVERYTHING_ENABLED);
  const proposals = auditProposals({ findings, source: 'src-1', locator: '/repo' });
  const text = renderAuditDeliverable({ locator: '/repo', findings, proposals });
  assert.match(text, /5 of 5 checked gate\(s\) enabled, 0 missing/);
  assert.match(text, /none — every applicable gate is already enabled\./);
  assert.match(text, /## Proposals Filed\n\nnone\./);
});
