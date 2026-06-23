/**
 * tests/certification-run.test.mjs — certification run schema, verdict rules, and store.
 *
 * @capability test-system.certification-run
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  deriveVerdictFromExecution,
  validateCertificationRun,
} from '../lib/certification/run.mjs';
import {
  listCertificationRunIds,
  readCertificationRun,
  writeCertificationRun,
} from '../lib/certification/store.mjs';

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'certification');

test('fixture runs validate against the certification schema', () => {
  for (const name of ['minimal-pass-run.json', 'skipped-provider-run.json']) {
    const run = JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
    const result = validateCertificationRun(run);
    assert.equal(result.valid, true, `${name}: ${result.errors.join('; ')}`);
  }
});

test('skipped provider calls derive inconclusive verdicts and cannot pass', () => {
  const verdict = deriveVerdictFromExecution({ providerSkipped: true });
  assert.equal(verdict.status, 'inconclusive');
  assert.equal(verdict.source, 'skipped-provider');
  const invalid = {
    ...JSON.parse(fs.readFileSync(path.join(FIXTURES, 'skipped-provider-run.json'), 'utf8')),
    verdict: { status: 'pass', source: 'skipped-provider', reason: 'invalid' },
  };
  const result = validateCertificationRun(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('skipped-provider verdict cannot be pass')));
});

test('writeCertificationRun persists run.json and optional redacted outputs', (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-run-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const run = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'minimal-pass-run.json'), 'utf8'));
  const { path: filePath } = writeCertificationRun(run, {
    rootDir,
    outputs: { markdown: '# redacted output\n' },
  });
  assert.ok(fs.existsSync(filePath));
  const loaded = readCertificationRun(run.id, { rootDir });
  assert.equal(loaded.run.verdict.status, 'pass');
  assert.equal(listCertificationRunIds({ rootDir }).length, 1);
});
