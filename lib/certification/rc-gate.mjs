/**
 * lib/certification/rc-gate.mjs — release candidate gate for certification freshness.
 *
 * Blocks release when release-critical capabilities are stale, hermetic scenarios
 * regress, or only skipped live runs exist. Hermetic scenarios run inline during
 * the gate so CI does not depend on local .cx/certification run history.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadCapabilityLedger } from '../capability-ledger.mjs';
import { loadCertificationStatus } from './stale-impact.mjs';
import { listScenarios } from './scenarios.mjs';
import { listCertificationRunIds, readCertificationRun } from './store.mjs';
import { LIVE_OPT_IN_ENV, runCertificationScenario } from './runner.mjs';
import { VERDICT_STATUSES } from './run.mjs';

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json')) && fs.existsSync(path.join(current, 'tests'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

export function releaseCriticalCapabilities({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const { ledger } = loadCapabilityLedger({ rootDir: root });
  return (ledger.capabilities ?? []).filter((cap) => cap.criticality === 'release');
}

export function hermeticScenariosForCapability(capabilityId, { repoRoot } = {}) {
  return listScenarios({ repoRoot }).filter((scenario) => {
    if (scenario.capabilityId !== capabilityId) return false;
    const mode = scenario.mode ?? 'hermetic';
    return mode === 'hermetic';
  });
}

export function liveScenariosForCapability(capabilityId, { repoRoot } = {}) {
  return listScenarios({ repoRoot }).filter((scenario) => {
    if (scenario.capabilityId !== capabilityId) return false;
    return (scenario.mode ?? 'hermetic') === 'live';
  });
}

function staleReleaseCapabilityIds({ rootDir } = {}) {
  const { status } = loadCertificationStatus({ rootDir });
  if (!status?.capabilities) return new Set();
  return new Set(
    Object.values(status.capabilities)
      .filter((entry) => entry.status === 'stale')
      .map((entry) => entry.capabilityId),
  );
}

function latestRunsByCapability({ rootDir } = {}) {
  const byCapability = new Map();
  for (const runId of listCertificationRunIds({ rootDir })) {
    try {
      const { run } = readCertificationRun(runId, { rootDir });
      const prev = byCapability.get(run.capabilityId);
      if (!prev || run.createdAt > prev.createdAt) byCapability.set(run.capabilityId, run);
    } catch { /* skip corrupt */ }
  }
  return byCapability;
}

function evidenceSatisfiesCertification(run) {
  if (!run?.verdict) return false;
  if (run.verdict.status !== 'pass') return false;
  if (run.verdict.source === 'skipped-provider') return false;
  return VERDICT_STATUSES.includes(run.verdict.status);
}

export { evidenceSatisfiesCertification };

function remediationForCapability(capabilityId, { repoRoot } = {}) {
  const hermetic = hermeticScenariosForCapability(capabilityId, { repoRoot });
  if (hermetic.length) {
    return `run: construct certify run ${hermetic[0].id} (and refresh stale evidence via construct certify gate)`;
  }
  return `add hermetic certification scenarios for ${capabilityId}, then construct certify gate`;
}

/**
 * @param {object} [opts]
 * @param {string} [opts.rootDir]
 * @param {string} [opts.projectDir] — durable run store (defaults to temp dir)
 * @param {boolean} [opts.runHermetic=true]
 */
export async function runReleaseCandidateGate({
  rootDir = process.cwd(),
  projectDir = null,
  env = process.env,
  runHermetic = true,
} = {}) {
  const root = findConstructRoot(rootDir);
  const repoRoot = root;
  const tmpProject = projectDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'cert-rc-gate-'));
  const ownsTmp = projectDir == null;
  const errors = [];
  const checks = [];

  const releaseCaps = releaseCriticalCapabilities({ rootDir: root });
  const staleIds = staleReleaseCapabilityIds({ rootDir: root });
  const latestRuns = latestRunsByCapability({ rootDir: tmpProject });

  for (const cap of releaseCaps) {
    if (staleIds.has(cap.id)) {
      errors.push(`stale capability ${cap.id}: ${remediationForCapability(cap.id, { repoRoot })}`);
      checks.push({ capabilityId: cap.id, kind: 'stale', pass: false });
      continue;
    }
    checks.push({ capabilityId: cap.id, kind: 'stale', pass: true });

    const hermetic = hermeticScenariosForCapability(cap.id, { repoRoot });
    const live = liveScenariosForCapability(cap.id, { repoRoot });

    if (!hermetic.length && !live.length) {
      checks.push({ capabilityId: cap.id, kind: 'coverage', pass: true, note: 'no certification scenarios yet' });
      continue;
    }

    if (hermetic.length && runHermetic) {
      for (const scenario of hermetic) {
        const result = await runCertificationScenario(scenario.id, {
          projectDir: tmpProject,
          repoRoot,
          env,
        });
        const pass = result.run?.verdict?.status === 'pass';
        checks.push({
          capabilityId: cap.id,
          scenarioId: scenario.id,
          kind: 'hermetic-run',
          pass,
          verdict: result.run?.verdict?.status ?? null,
        });
        if (!pass) {
          errors.push(
            `hermetic scenario ${scenario.id} for ${cap.id} did not pass (${result.run?.verdict?.status ?? 'unknown'}): construct certify run ${scenario.id}`,
          );
        }
      }
      continue;
    }

    const latest = latestRuns.get(cap.id);
    if (live.length && !hermetic.length) {
      const pass = evidenceSatisfiesCertification(latest);
      checks.push({
        capabilityId: cap.id,
        kind: 'live-evidence',
        pass,
        verdict: latest?.verdict?.status ?? 'never-run',
      });
      if (!pass) {
        errors.push(
          `capability ${cap.id} has only live scenarios; skipped or inconclusive runs do not satisfy certification (${latest?.verdict?.status ?? 'never-run'}). Set ${LIVE_OPT_IN_ENV}=1 and run a passing live scenario.`,
        );
      }
      continue;
    }

    if (hermetic.length && !runHermetic) {
      const pass = evidenceSatisfiesCertification(latest);
      checks.push({
        capabilityId: cap.id,
        kind: 'persisted-evidence',
        pass,
        verdict: latest?.verdict?.status ?? 'never-run',
      });
      if (!pass) {
        errors.push(`missing pass evidence for ${cap.id}: ${remediationForCapability(cap.id, { repoRoot })}`);
      }
    }
  }

  if (ownsTmp) fs.rmSync(tmpProject, { recursive: true, force: true });

  return {
    pass: errors.length === 0,
    errors,
    checks,
    releaseCapabilityCount: releaseCaps.length,
    staleCount: [...staleIds].filter((id) => releaseCaps.some((cap) => cap.id === id)).length,
  };
}

export function formatReleaseCandidateGate(result) {
  const lines = [];
  lines.push(`Release candidate certification gate: ${result.pass ? 'PASS' : 'FAIL'}`);
  lines.push(`Release-critical capabilities: ${result.releaseCapabilityCount}`);
  if (result.staleCount) lines.push(`Stale: ${result.staleCount}`);
  if (result.errors.length) {
    lines.push('');
    lines.push('Remediation:');
    for (const err of result.errors) lines.push(`  - ${err}`);
  }
  return `${lines.join('\n')}\n`;
}
