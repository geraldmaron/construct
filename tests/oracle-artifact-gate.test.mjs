/**
 * tests/oracle-artifact-gate.test.mjs — Oracle read-model artifact gate signals.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectArtifactGateSignals } from '../lib/oracle/artifact-gate.mjs';
import { synthesizeVerdict } from '../lib/oracle/synthesize.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('collectArtifactGateSignals finds bypass frontmatter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ora-gate-'));
  try {
    mkdirSync(join(dir, 'docs', 'prd'), { recursive: true });
    writeFileSync(
      join(dir, 'docs', 'prd', '001.md'),
      '---\ncx_release_gate: bypass\ncx_release_gate_reason: draft only\n---\n\n# PRD\n',
    );
    const signals = collectArtifactGateSignals({ rootDir: REPO_ROOT, projectDir: dir });
    assert.equal(signals.bypassCount, 1);
    assert.equal(signals.bypassed[0].path, 'docs/prd/001.md');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('synthesizeVerdict surfaces artifact-gate-bypass gap', () => {
  const readModel = {
    projectDir: '/tmp/x',
    parity: { ok: true, skipped: false },
    contractViolations: { recentCount: 0 },
    doctorLog: { recent: [] },
    outcomes: { present: true, workerProfiles: {} },
    alignmentCensus: { present: true, stale: false, audit: { regressions: [] } },
    registryValidate: { needsRun: false, warningCount: 0 },
    hookFailures: { count: 0 },
    beads: { stuckInProgress: 0, staleOpen: 0 },
    deadCode: { regressions: [] },
    structure: { duplicateLanes: [] },
    orgGraph: {},
    artifactGate: {
      bypassCount: 1,
      bypassed: [{ path: 'docs/prd/001.md', reason: 'draft' }],
      reviewerGapCount: 0,
      reviewerGaps: [],
      workerProfileAudit: { present: false, pass: true },
    },
  };
  const { gaps } = synthesizeVerdict(readModel);
  assert.ok(gaps.some((g) => g.id === 'artifact-gate-bypass'));
});
