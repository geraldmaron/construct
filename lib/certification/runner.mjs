/**
 * lib/certification/runner.mjs — execute certification scenarios and persist run records.
 *
 * Hermetic scenarios run deterministic gates only. Live scenarios require
 * CONSTRUCT_CERTIFY_LIVE=1; without opt-in the runner records inconclusive and
 * never promotes a skipped provider call to pass.
 */

import path from 'node:path';
import { validateCapabilityLedger } from '../capability-ledger.mjs';
import { validateCorpusInventory } from '../test-corpus-inventory.mjs';
import { validateArtifactRelease } from '../artifact-release-gate.mjs';
import { deriveVerdictFromExecution } from './run.mjs';
import { fixtureDigest, getScenario, newRunId } from './scenarios.mjs';
import { writeCertificationRun } from './store.mjs';

export const LIVE_OPT_IN_ENV = 'CONSTRUCT_CERTIFY_LIVE';

function liveOptInEnabled(env = process.env) {
  return env[LIVE_OPT_IN_ENV] === '1';
}

async function runGate(gate, { root, scenario }) {
  if (gate.type === 'capability-ledger-audit') {
    const result = validateCapabilityLedger({ rootDir: root });
    return { id: gate.id, pass: result.pass, detail: result.errors[0] ?? null };
  }
  if (gate.type === 'corpus-inventory-audit') {
    const result = validateCorpusInventory({ rootDir: root });
    return { id: gate.id, pass: result.pass, detail: result.errors[0] ?? null };
  }
  if (gate.type === 'artifact-release-gate') {
    const rel = scenario.fixture.path;
    const result = validateArtifactRelease({
      filePath: path.join(root, rel),
      type: gate.artifactType ?? 'prd',
      rootDir: root,
    });
    return { id: gate.id, pass: result.ok === true, detail: result.errors?.[0] ?? null };
  }
  if (gate.type === 'live-provider-smoke') {
    return { id: gate.id, pass: false, detail: 'live provider gate not executed in hermetic mode' };
  }
  return { id: gate.id, pass: false, detail: `unknown gate type: ${gate.type}` };
}

export async function runCertificationScenario(scenarioId, {
  projectDir = process.cwd(),
  repoRoot = projectDir,
  env = process.env,
  now = () => new Date().toISOString(),
  dryRun = false,
} = {}) {
  const startedAt = now();
  const startMs = Date.now();
  const { root, scenario } = getScenario(scenarioId, { repoRoot });
  const fixturePath = scenario.fixture.path;
  const sha256 = fixtureDigest(root, fixturePath);
  const mode = scenario.mode ?? 'hermetic';
  const requiresLive = mode === 'live' || scenario.requiresEnv === LIVE_OPT_IN_ENV;

  if (requiresLive && !liveOptInEnabled(env)) {
    const verdict = deriveVerdictFromExecution({
      providerSkipped: true,
      gates: [],
    });
    const run = {
      schemaVersion: 1,
      id: newRunId(scenarioId),
      scenarioId,
      capabilityId: scenario.capabilityId,
      model: { ...scenario.model, paidOptIn: false },
      fixture: { path: fixturePath, sha256 },
      verdict: { ...verdict, reason: `${LIVE_OPT_IN_ENV}=1 required for live scenarios` },
      gates: [],
      qualitative: null,
      timing: { latencyMs: Date.now() - startMs, startedAt, finishedAt: now() },
      cost: null,
      artifacts: null,
      evidenceVersion: 'corpus-inventory:1',
      createdAt: startedAt,
    };
    if (dryRun) return { dryRun: true, run, exitCode: 2 };
    writeCertificationRun(run, { rootDir: projectDir });
    return { run, exitCode: 2 };
  }

  const gates = [];
  for (const gate of scenario.gates ?? []) {
    gates.push(await runGate(gate, { root, scenario }));
  }

  const verdict = deriveVerdictFromExecution({ gates });
  const run = {
    schemaVersion: 1,
    id: newRunId(scenarioId),
    scenarioId,
    capabilityId: scenario.capabilityId,
    model: { ...scenario.model, paidOptIn: false },
    fixture: { path: fixturePath, sha256 },
    verdict,
    gates,
    qualitative: null,
    timing: { latencyMs: Date.now() - startMs, startedAt, finishedAt: now() },
    cost: null,
    artifacts: null,
    evidenceVersion: 'corpus-inventory:1',
    createdAt: startedAt,
  };

  if (dryRun) return { dryRun: true, run, exitCode: verdict.status === 'pass' ? 0 : verdict.status === 'fail' ? 1 : 2 };
  const persisted = writeCertificationRun(run, { rootDir: projectDir });
  const exitCode = verdict.status === 'pass' ? 0 : verdict.status === 'fail' ? 1 : 2;
  return { ...persisted, exitCode };
}
