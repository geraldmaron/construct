/**
 * tests/gates-audit.test.mjs — gates-audit parsing + gap-detection coverage.
 *
 * Builds a small fixture tree representing a stripped-down repo and asserts
 * auditGates returns the expected report shape. Branch protection is forced
 * to a known state by overriding gh; the test's PATH prepends a tmp dir
 * with a fake gh that prints fixture JSON.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before, after } from 'node:test';

let tmpRoot;
let fakeBinDir;
let savedPath;
let auditGates;
let formatReport;

const CI_YML = `name: ci
on:
  push:
jobs:
  test:
    name: test (\${{ matrix.os }} / node \${{ matrix.node }})
    runs-on: ubuntu-latest
    steps:
      - run: npm test
  evals:
    name: retrieval evals
    runs-on: ubuntu-latest
    steps:
      - run: node bin/construct evals retrieval
  audit:
    name: dependency CVE audit
    runs-on: ubuntu-latest
    steps:
      - run: npm audit --omit=dev --audit-level=high
  comment-lint:
    name: comment policy
    runs-on: ubuntu-latest
    steps:
      - run: node bin/construct lint:comments
`;

const PRE_PUSH = `
const jobs = [];
jobs.push({ label: 'tests', cmd: 'npm', args: ['test'], timeout: 90_000 });
jobs.push({ label: 'audit', cmd: 'npm', args: ['audit'], timeout: 30_000 });
jobs.push({ label: 'evals', cmd: 'node', args: ['bin/construct', 'evals', 'retrieval'], timeout: 60_000 });
jobs.push({ label: 'docs',  cmd: 'node', args: ['bin/construct', 'docs:verify'],        timeout: 15_000 });
`;

const PRE_COMMIT = `#!/usr/bin/env bash
# fake pre-commit
scan_added_lines() { :; }
node ./bin/construct lint:comments
node ./bin/construct docs:verify
# --- BEGIN BEADS INTEGRATION v1.0.0 ---
exit 0
`;

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-audit-fixture-'));
  fs.mkdirSync(path.join(tmpRoot, '.github', 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'lib', 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, '.beads', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, '.github', 'workflows', 'ci.yml'), CI_YML);
  fs.writeFileSync(path.join(tmpRoot, 'lib', 'hooks', 'pre-push-gate.mjs'), PRE_PUSH);
  fs.writeFileSync(path.join(tmpRoot, '.beads', 'hooks', 'pre-commit'), PRE_COMMIT);

  fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-audit-bin-'));
  const fakeGh = `#!/usr/bin/env bash
echo '{"contexts":["dependency CVE audit","retrieval evals","comment policy"]}'
`;
  fs.writeFileSync(path.join(fakeBinDir, 'gh'), fakeGh, { mode: 0o755 });
  savedPath = process.env.PATH;
  process.env.PATH = `${fakeBinDir}:${process.env.PATH}`;

  ({ auditGates, formatReport } = await import('../lib/gates-audit.mjs'));
});

after(() => {
  if (savedPath) process.env.PATH = savedPath;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(fakeBinDir, { recursive: true, force: true });
});

describe('auditGates', () => {
  it('parses CI jobs from ci.yml', () => {
    const report = auditGates({ rootDir: tmpRoot, branch: 'main' });
    assert.ok(report.ciJobs.includes('retrieval evals'));
    assert.ok(report.ciJobs.includes('dependency CVE audit'));
    assert.ok(report.ciJobs.includes('comment policy'));
  });

  it('parses pre-push gate labels', () => {
    const report = auditGates({ rootDir: tmpRoot, branch: 'main' });
    assert.deepEqual(report.prePushJobs.sort(), ['audit', 'docs', 'evals', 'tests']);
  });

  it('parses pre-commit checks', () => {
    const report = auditGates({ rootDir: tmpRoot, branch: 'main' });
    assert.ok(report.preCommitChecks.includes('ECC secret scan'));
    assert.ok(report.preCommitChecks.includes('Construct comment-lint'));
    assert.ok(report.preCommitChecks.includes('Construct docs:verify'));
    assert.ok(report.preCommitChecks.includes('BEADS dispatcher'));
  });

  it('reads branch protection via gh (fake stub returns 3 contexts)', () => {
    const report = auditGates({ rootDir: tmpRoot, branch: 'main' });
    assert.equal(report.branchProtection.protected, true);
    assert.deepEqual(report.branchProtection.requiredContexts.sort(),
      ['comment policy', 'dependency CVE audit', 'retrieval evals']);
  });

  it('flags critical CI jobs missing from required-to-merge', () => {
    const report = auditGates({ rootDir: tmpRoot, branch: 'main' });
    const labels = report.gaps.map((g) => `${g.kind}:${g.gate}`);
    assert.ok(
      labels.some((l) => l.startsWith('not-required-to-merge:') && l.includes('test')),
      `expected a 'not-required-to-merge' gap for a test job; got ${JSON.stringify(labels)}`,
    );
  });

  it('formatReport produces a deterministic text block', () => {
    const report = auditGates({ rootDir: tmpRoot, branch: 'main' });
    const out = formatReport(report);
    assert.match(out, /^Construct Gates Audit/);
    assert.match(out, /CI jobs \(/);
    assert.match(out, /Branch protection \(main\)/);
    assert.match(out, /Summary:/);
  });
});

describe('artifact gate config drift', () => {
  let auditArtifactGateConfig;
  const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

  before(async () => {
    ({ auditArtifactGateConfig } = await import('../lib/gates-audit.mjs'));
  });

  it('validates the real manifest gate config without drift', () => {
    const result = auditArtifactGateConfig(REPO);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  it('skips a repo with no manifest rather than failing', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-no-manifest-'));
    try {
      const result = auditArtifactGateConfig(empty);
      assert.equal(result.ok, true);
      assert.equal(result.skipped, 'no manifest');
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
