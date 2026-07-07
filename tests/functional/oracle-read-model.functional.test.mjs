/**
 * tests/functional/oracle-read-model.functional.test.mjs —
 *
 * Oracle read model collects project-scoped signals from an isolated tmpdir
 * without touching the developer's home log or real project state.
 */

import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { collectReadModel } from '../../lib/oracle/read-model.mjs';
import { doctorRoot } from '../../lib/config/xdg.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

function freshEnv() {
  const projectDir = mkdtempSync(join(tmpdir(), 'construct-oracle-proj-'));
  const homeDir = mkdtempSync(join(tmpdir(), 'construct-oracle-home-'));
  const rootDir = mkdtempSync(join(tmpdir(), 'construct-oracle-root-'));
  mkdirSync(join(projectDir, '.cx', 'observations'), { recursive: true });
  mkdirSync(join(projectDir, '.cx', 'outcomes'), { recursive: true });
  mkdirSync(join(rootDir, 'audit-artifacts'), { recursive: true });
  mkdirSync(doctorRoot(homeDir), { recursive: true });
  mkdirSync(join(rootDir, 'specialists'), { recursive: true });
  cpSync(join(process.cwd(), 'specialists', 'org'), join(rootDir, 'specialists', 'org'), { recursive: true });
  return {
    projectDir,
    homeDir,
    rootDir,
    cleanup() {
      for (const d of [projectDir, homeDir, rootDir]) {
        try { rmTmpDir(d); } catch { /* ignore */ }
      }
    },
  };
}

test('collectReadModel returns empty sections for a minimal project', () => {
  const env = freshEnv();
  try {
    const model = collectReadModel(env);
    assert.ok(model.collectedAt);
    assert.equal(model.observations.present, true);
    assert.equal(model.observations.count, 0);
    assert.equal(model.outcomes.present, false);
    assert.equal(model.contractViolations.recentCount, 0);
    assert.equal(model.alignmentCensus.present, false);
    assert.equal(model.parity.skipped, false);
    assert.equal(model.teamGovernance.present, true);
    assert.ok(Number.isFinite(model.teamGovernance.teamCount));
  } finally {
    env.cleanup();
  }
});

test('collectReadModel ingests outcomes, violations, doctor log, and census', () => {
  const env = freshEnv();
  try {
    writeFileSync(join(env.projectDir, '.cx', 'outcomes', '_summary.json'), JSON.stringify({
      generatedAt: new Date().toISOString(),
      roles: { engineer: { count: 10, success: 8, successRate: 0.8, last30: { count: 5, successRate: 0.8 } } },
    }));

    const violation = {
      ts: new Date().toISOString(),
      contractId: 'engineer-to-reviewer',
      agent: 'cx-engineer',
      verdict: 'CONTRACT_VIOLATION',
      direction: 'output',
    };
    writeFileSync(join(env.projectDir, '.cx', 'contract-violations.jsonl'), JSON.stringify(violation) + '\n');

    writeFileSync(join(doctorRoot(env.homeDir), 'doctor-log.jsonl'), JSON.stringify({
      ts: Date.now(),
      kind: 'escalate',
      watcher: 'service-health',
      result: 'recorded',
      summary: 'dashboard unreachable after 2 restarts',
    }) + '\n');

    writeFileSync(join(env.projectDir, '.cx', 'observations', 'index.json'), JSON.stringify([
      { id: 'obs-1', role: 'cx-engineer', category: 'insight', summary: 'test observation', timestamp: new Date().toISOString() },
    ]));

    writeFileSync(join(env.rootDir, 'audit-artifacts', 'alignment-census.json'), JSON.stringify({
      generatedAt: new Date().toISOString(),
      summary: { skills: 100 },
      rootLayout: { legacyDirs: ['providers'], findingCount: 1, clean: false },
    }));

    const model = collectReadModel(env);
    assert.equal(model.outcomes.present, true);
    assert.equal(model.contractViolations.recentCount, 1);
    assert.equal(model.doctorLog.recentCount, 1);
    assert.equal(model.observations.indexCount, 1);
    assert.equal(model.alignmentCensus.present, true);
    assert.equal(model.alignmentCensus.rootLayout?.clean, false);
    assert.deepEqual(model.alignmentCensus.rootLayout?.legacyDirs, ['providers']);
  } finally {
    env.cleanup();
  }
});

test('collectReadModel collects team governance data from unified-registry', () => {
  const env = freshEnv();
  try {
    const model = collectReadModel(env);
    assert.equal(model.teamGovernance.present, true);
    assert.ok(Number.isFinite(model.teamGovernance.teamCount));
    assert.ok(model.teamGovernance.teamCount > 0);

    // Verify team structure
    const teams = model.teamGovernance.teams;
    assert.ok(teams);
    for (const [teamId, team] of Object.entries(teams)) {
      assert.equal(team.id, teamId);
      assert.ok(team.name);
      assert.ok(team.owner);
      assert.ok(Number.isFinite(team.roleCount));
      assert.ok(Number.isFinite(team.specialistCount));
      assert.ok(Number.isFinite(team.decisionRightsCount));
      assert.ok(Number.isFinite(team.forbiddenDecisionsCount));
      assert.equal(typeof team.escalationPathBroken, 'boolean');
      assert.equal(typeof team.ownerExists, 'boolean');
      assert.equal(typeof team.understaffed, 'boolean');
    }
  } finally {
    env.cleanup();
  }
});
