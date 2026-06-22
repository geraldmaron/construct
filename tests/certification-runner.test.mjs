/**
 * tests/certification-runner.test.mjs — certification scenario runner and CLI wiring.
 *
 * @capability test-system.certification-runner
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runCertificationCli } from '../lib/certification/cli.mjs';
import { LIVE_OPT_IN_ENV, runCertificationScenario } from '../lib/certification/runner.mjs';
import { listCertificationRunIds } from '../lib/certification/store.mjs';

test('hermetic ledger scenario passes and persists a run record', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-run-hermetic-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const repoRoot = process.cwd();
  const result = await runCertificationScenario('ledger.traceability', { projectDir: rootDir, repoRoot });
  assert.equal(result.run.verdict.status, 'pass');
  assert.equal(listCertificationRunIds({ rootDir }).length, 1);
});

test('live scenario without opt-in records inconclusive and exits 2', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-run-live-skip-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const env = { ...process.env };
  delete env[LIVE_OPT_IN_ENV];
  const result = await runCertificationScenario('specialist.prompt.normal', { projectDir: rootDir, repoRoot: process.cwd(), env });
  assert.equal(result.exitCode, 2);
  assert.equal(result.run.verdict.status, 'inconclusive');
  assert.equal(result.run.verdict.source, 'skipped-provider');
});

test('construct certify run supports dry-run without writing artifacts', async () => {
  const code = await runCertificationCli(['run', 'ledger.traceability', '--dry-run', '--json'], {
    projectDir: process.cwd(),
    repoRoot: process.cwd(),
  });
  assert.equal(code, 0);
});
