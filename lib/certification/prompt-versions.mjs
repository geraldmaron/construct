/**
 * lib/certification/prompt-versions.mjs — certified prompt fragment hashes for release gating.
 *
 * Computes a deterministic content hash over the static prompt-composer fragment set
 * (core, role-flavor, model-profile) for each registry Worker Profile and operating
 * profile tier. The release candidate gate compares live hashes to durable records in
 * .construct/certification/prompt-versions.json. First run bootstraps a baseline;
 * later runs block when a hash drifts until a fresh passing worker-profile certification
 * run is recorded after the prior certification timestamp.
 */

import crypto from 'node:crypto';

import { loadRegistry } from '../registry/loader.mjs';
import { MODEL_OPERATING_PROFILES } from '../model-router.mjs';
import { composePrompt } from '../prompt-composer.mjs';
import { bindingsForWorkerProfileId } from '../roles/flavor-bindings.mjs';
import { VERDICT_STATUSES } from './run.mjs';
import {
  listCertificationRunIds,
  readCertificationRun,
  readCertifiedPromptVersions,
  writeCertifiedPromptVersions,
} from './store.mjs';

const CERTIFIED_FRAGMENT_TYPES = new Set(['core', 'role-flavor', 'model-profile']);

export const CERTIFIED_OPERATING_PROFILES = Object.freeze(
  Object.keys(MODEL_OPERATING_PROFILES).sort(),
);

const SMALL_MODEL_STUB = 'ollama/llama3.1:8b';
const BALANCED_MODEL_STUB = 'anthropic/claude-sonnet-4';

export function promptVersionPairKey(workerProfileId, operatingProfileId) {
  return `${workerProfileId}:${operatingProfileId}`;
}

export function canonicalRoleFlavorsForWorkerProfile(workerProfileId) {
  const bindings = bindingsForWorkerProfileId(workerProfileId);
  if (!bindings.length) return null;
  const roleFlavors = {};
  for (const binding of bindings) {
    roleFlavors[binding.classifierKey] = 'core';
  }
  return roleFlavors;
}

export function executionContractModelForOperatingProfile(operatingProfileId) {
  const small = operatingProfileId === 'small';
  return {
    profile: { id: operatingProfileId },
    selectedModel: small ? SMALL_MODEL_STUB : BALANCED_MODEL_STUB,
  };
}

export function composeCertifiedFragments(workerProfileId, operatingProfileId, { rootDir, registry } = {}) {
  const composed = composePrompt(workerProfileId, {
    rootDir,
    registry,
    injectLearnedPatterns: false,
    roleFlavors: canonicalRoleFlavorsForWorkerProfile(workerProfileId),
    executionContractModel: executionContractModelForOperatingProfile(operatingProfileId),
  });
  return composed.fragments.filter((fragment) => CERTIFIED_FRAGMENT_TYPES.has(fragment.type));
}

export function hashCertifiedFragmentSet(fragments) {
  const canonical = fragments.map((fragment) => ({
    type: fragment.type,
    label: fragment.label,
    content: crypto.createHash('sha256').update(fragment.content || '').digest('hex'),
    ...(fragment.sourceContentHash ? { sourceContentHash: fragment.sourceContentHash } : {}),
  }));
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function computePromptVersionPair(workerProfileId, operatingProfileId, { rootDir, registry } = {}) {
  const fragments = composeCertifiedFragments(workerProfileId, operatingProfileId, { rootDir, registry });
  return {
    workerProfileId,
    operatingProfileId,
    pairKey: promptVersionPairKey(workerProfileId, operatingProfileId),
    fragmentHash: hashCertifiedFragmentSet(fragments),
    fragmentCount: fragments.length,
  };
}

export function computePromptVersionPairs({ rootDir, registry } = {}) {
  const reg = registry ?? loadRegistry({ rootDir });
  const pairs = [];
  for (const profile of Object.values(reg.workerProfiles ?? {})) {
    for (const operatingProfileId of CERTIFIED_OPERATING_PROFILES) {
      pairs.push(computePromptVersionPair(profile.id, operatingProfileId, { rootDir, registry: reg }));
    }
  }
  return pairs.sort((a, b) => a.pairKey.localeCompare(b.pairKey));
}

function pairRecordFromCurrent(pair, { certifiedAt, certificationRunId = null } = {}) {
  return {
    workerProfileId: pair.workerProfileId,
    operatingProfileId: pair.operatingProfileId,
    fragmentHash: pair.fragmentHash,
    fragmentCount: pair.fragmentCount,
    certifiedAt: certifiedAt ?? new Date().toISOString(),
    ...(certificationRunId ? { certificationRunId } : {}),
  };
}

export function buildPromptVersionBaseline(currentPairs, { certifiedAt } = {}) {
  const pairs = {};
  for (const pair of currentPairs) {
    pairs[pair.pairKey] = pairRecordFromCurrent(pair, { certifiedAt });
  }
  return {
    version: 1,
    updatedAt: certifiedAt ?? new Date().toISOString(),
    pairs,
  };
}

function workerProfileScenarioMatches(scenarioId, workerProfileId) {
  const id = String(scenarioId || '');
  return id.includes(`.${workerProfileId}.`)
    || id.endsWith(`.${workerProfileId}`)
    || id.includes(`.${workerProfileId}-`);
}

export function findRecertificationRun(workerProfileId, sinceIso, { rootDir } = {}) {
  let best = null;
  for (const runId of listCertificationRunIds({ rootDir })) {
    try {
      const { run } = readCertificationRun(runId, { rootDir });
      if (!run?.verdict || run.verdict.status !== 'pass') continue;
      if (run.verdict.source === 'skipped-provider') continue;
      if (!VERDICT_STATUSES.includes(run.verdict.status)) continue;
      if (!workerProfileScenarioMatches(run.scenarioId, workerProfileId)) continue;
      if (sinceIso && run.createdAt <= sinceIso) continue;
      if (!best || run.createdAt > best.createdAt) best = run;
    } catch { /* skip corrupt */ }
  }
  return best;
}

/**
 * @param {object} [opts]
 * @param {string} [opts.rootDir] — repo root for prompt composition
 * @param {string} [opts.projectDir] — durable certification store root
 * @param {boolean} [opts.bootstrap=true] — write baseline when no history exists
 */
export function evaluatePromptVersionGate({
  rootDir = process.cwd(),
  projectDir = rootDir,
  bootstrap = true,
  now = () => new Date().toISOString(),
} = {}) {
  const currentPairs = computePromptVersionPairs({ rootDir });
  const { record, exists } = readCertifiedPromptVersions({ rootDir: projectDir });
  const errors = [];
  const checks = [];
  const stalePairs = [];
  let bootstrapped = false;
  let updatedRecord = record;

  if (!exists || !record?.pairs || !Object.keys(record.pairs).length) {
    if (!bootstrap) {
      return {
        pass: false,
        bootstrapped: false,
        errors: ['missing certified prompt-version baseline; run construct certify gate once to bootstrap'],
        checks,
        stalePairs,
        pairCount: currentPairs.length,
      };
    }
    updatedRecord = buildPromptVersionBaseline(currentPairs, { certifiedAt: now() });
    writeCertifiedPromptVersions(updatedRecord, { rootDir: projectDir });
    return {
      pass: true,
      bootstrapped: true,
      errors,
      checks: currentPairs.map((pair) => ({
        ...pair,
        kind: 'prompt-version-bootstrap',
        pass: true,
      })),
      stalePairs,
      pairCount: currentPairs.length,
    };
  }

  const nextPairs = { ...record.pairs };
  let recordChanged = false;

  for (const pair of currentPairs) {
    const stored = record.pairs[pair.pairKey];
    if (!stored) {
      nextPairs[pair.pairKey] = pairRecordFromCurrent(pair, { certifiedAt: now() });
      recordChanged = true;
      checks.push({ ...pair, kind: 'prompt-version-new-pair', pass: true });
      continue;
    }

    if (stored.fragmentHash === pair.fragmentHash) {
      checks.push({ ...pair, kind: 'prompt-version', pass: true });
      continue;
    }

    const recertRun = findRecertificationRun(pair.workerProfileId, stored.certifiedAt, { rootDir: projectDir });
    if (recertRun) {
      nextPairs[pair.pairKey] = pairRecordFromCurrent(pair, {
        certifiedAt: recertRun.createdAt,
        certificationRunId: recertRun.id,
      });
      recordChanged = true;
      checks.push({
        ...pair,
        kind: 'prompt-version-recertified',
        pass: true,
        priorHash: stored.fragmentHash,
        certificationRunId: recertRun.id,
      });
      continue;
    }

    stalePairs.push(pair);
    checks.push({
      ...pair,
      kind: 'prompt-version-stale',
      pass: false,
      priorHash: stored.fragmentHash,
    });
    errors.push(
      `prompt fragments changed for ${pair.pairKey}; re-certify worker-profile scenarios then rerun construct certify gate (example: construct certify run worker-profile.happy-path-representative.${pair.workerProfileId})`,
    );
  }

  if (recordChanged) {
    updatedRecord = {
      ...record,
      updatedAt: now(),
      pairs: nextPairs,
    };
    writeCertifiedPromptVersions(updatedRecord, { rootDir: projectDir });
  }

  return {
    pass: errors.length === 0,
    bootstrapped: false,
    errors,
    checks,
    stalePairs,
    pairCount: currentPairs.length,
    staleCount: stalePairs.length,
  };
}

export function formatPromptVersionGate(result) {
  const lines = [];
  lines.push(`Certified prompt-version gate: ${result.pass ? 'PASS' : 'FAIL'}`);
  lines.push(`Tracked pairs: ${result.pairCount ?? 0}`);
  if (result.bootstrapped) lines.push('Bootstrapped baseline prompt-version records.');
  if (result.staleCount) lines.push(`Stale prompt pairs: ${result.staleCount}`);
  if (result.errors?.length) {
    lines.push('');
    lines.push('Remediation:');
    for (const err of result.errors) lines.push(`  - ${err}`);
  }
  return `${lines.join('\n')}\n`;
}
