/**
 * tests/functional/oracle-noise-filter.functional.test.mjs — oracle contract-noise filtering.
 *
 * Verifies the oracle read path ignores known dev-session contract probe noise while still
 * escalating genuine violations, and that explicit repoRoot routing keeps fixture failures
 * out of the live project log.
 */
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { validateHandoff } from '../../lib/contracts/validate.mjs';
import { collectReadModel } from '../../lib/oracle/read-model.mjs';
import { synthesizeVerdict } from '../../lib/oracle/synthesize.mjs';
import { doctorRoot } from '../../lib/config/xdg.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

function freshEnv() {
  const projectDir = mkdtempSync(join(tmpdir(), 'construct-oracle-noise-proj-'));
  const homeDir = mkdtempSync(join(tmpdir(), 'construct-oracle-noise-home-'));
  const rootDir = mkdtempSync(join(tmpdir(), 'construct-oracle-noise-root-'));
  mkdirSync(join(projectDir, '.construct', 'observations'), { recursive: true });
  mkdirSync(join(projectDir, '.construct', 'outcomes'), { recursive: true });
  mkdirSync(join(rootDir, 'audit-artifacts'), { recursive: true });
  mkdirSync(doctorRoot(homeDir), { recursive: true });
  mkdirSync(join(rootDir, 'specialists'), { recursive: true });
  cpSync(join(process.cwd(), 'specialists', 'org'), join(rootDir, 'specialists', 'org'), { recursive: true });
  return {
    projectDir,
    homeDir,
    rootDir,
    cleanup() {
      for (const dir of [projectDir, homeDir, rootDir]) {
        try { rmTmpDir(dir); } catch { /* ignore */ }
      }
    },
  };
}

function writeViolations(projectDir, rows) {
  const file = join(projectDir, '.construct', 'contract-violations.jsonl');
  writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

function makeNoiseRows(ts = new Date().toISOString()) {
  const rows = [];
  const bareGoalMissing = [
    'artifact missing required field: intent',
    'artifact missing required field: workCategory',
    'artifact missing required field: riskFlags',
    'artifact missing required field: acceptanceCriteria',
  ];
  const a11yMissing = [
    'artifact missing required field: findings',
    'artifact missing required field: wcagCriterion',
    'artifact missing required field: userImpact',
  ];
  for (let i = 0; i < 19; i++) {
    rows.push({
      ts,
      contractId: 'construct-to-orchestrator',
      agent: 'construct',
      verdict: 'CONTRACT_VIOLATION',
      direction: 'output',
      missing: bareGoalMissing,
      packet_keys: ['goal'],
    });
    rows.push({
      ts,
      contractId: 'designer-to-qa',
      agent: 'cx-accessibility',
      verdict: 'CONTRACT_VIOLATION',
      direction: 'output',
      missing: a11yMissing,
      packet_keys: [],
    });
  }
  return rows;
}

function countLines(file) {
  if (!existsSync(file)) return 0;
  const text = readFileSync(file, 'utf8').trim();
  if (!text) return 0;
  return text.split('\n').filter(Boolean).length;
}

function neutralizeUnrelatedHighSignals(readModel) {
  return {
    ...readModel,
    parity: { skipped: true, ok: true, summary: [] },
    doctorLog: { present: false, recentCount: 0, recent: [] },
    orgGraph: {},
    hookFailures: { count: 0, recent: [] },
    beads: { stuckInProgress: 0, staleOpen: 0 },
    deadCode: { regressions: [] },
  };
}

test('oracle read model filters dev-session noise out of the degraded verdict path', () => {
  const env = freshEnv();
  try {
    writeViolations(env.projectDir, makeNoiseRows());

    const noiseOnly = synthesizeVerdict(neutralizeUnrelatedHighSignals(collectReadModel(env)));
    assert.notEqual(noiseOnly.verdict, 'degraded');
    assert.equal(
      noiseOnly.gaps.some((entry) => entry.id === 'contract-violations'),
      false,
      'dev-session probe noise must not count as a contract-violations gap',
    );

    const genuineRows = Array.from({ length: 5 }, (_, index) => ({
      ts: new Date(Date.now() + index).toISOString(),
      contractId: 'engineer-to-reviewer',
      agent: 'cx-engineer',
      verdict: 'CONTRACT_VIOLATION',
      direction: 'output',
      missing: ['artifact missing required field: findings'],
      packet_keys: ['summary'],
    }));
    writeViolations(env.projectDir, makeNoiseRows().concat(genuineRows));

    const genuine = synthesizeVerdict(neutralizeUnrelatedHighSignals(collectReadModel(env)));
    assert.equal(genuine.verdict, 'degraded');
    assert.equal(genuine.gaps.some((entry) => entry.id === 'contract-violations'), true);
  } finally {
    env.cleanup();
  }
});

test('explicit repoRoot keeps contract validation failures out of the live project log', () => {
  const env = freshEnv();
  const liveLog = join(process.cwd(), '.construct', 'contract-violations.jsonl');
  try {
    const before = countLines(liveLog);
    const verdict = validateHandoff({
      producer: 'construct',
      consumer: 'cx-orchestrator',
      artifact: { goal: 'missing required fields' },
      enforcement: 'block',
      repoRoot: env.projectDir,
    });
    assert.equal(verdict.ok, false);
    assert.equal(countLines(liveLog), before, 'live repo log must stay untouched');
    assert.equal(countLines(join(env.projectDir, '.construct', 'contract-violations.jsonl')), 1);
  } finally {
    env.cleanup();
  }
});
