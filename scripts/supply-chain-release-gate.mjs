#!/usr/bin/env node
/**
 * scripts/supply-chain-release-gate.mjs — composed supply-chain release go/no-go
 * (construct-tsyfe.10.7).
 *
 * Conjunctive gate over the six construct-tsyfe.10 sub-checks. Mirrors
 * construct-4uxq0.14.4: a process being alive is not sufficient — each sub-check
 * must report real evidence. Wired onto release.yml's tag path per construct-9tg43
 * gate-scope lesson (existence alone is not enough; the release path must run it).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { evaluateSupplyChainExceptions } from './check-supply-chain-exceptions.mjs';
import { BINARY_RELEASE_PATHS } from '../lib/certification/binary-release-paths.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const SUPPLY_CHAIN_SUBCHECKS = Object.freeze([
  'osv-license-dependency-review',
  'sbom-release-wiring',
  'provider-card-provenance',
  'packed-artifact-certification',
  'compiled-binary-certification',
  'compat-surface-expiration',
]);

function readRepoText(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8');
}

function runNodeScript(relPath, { execFile = execFileSync } = {}) {
  execFile(process.execPath, [resolve(ROOT, relPath)], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function checkOsvLicenseDependencyReview({
  read = readRepoText,
  evaluateExceptions = evaluateSupplyChainExceptions,
} = {}) {
  const errors = [];
  const evidence = {};

  const exc = evaluateExceptions();
  evidence.exceptionsActive = exc.active.length;
  if (!exc.ok) errors.push(...exc.errors);

  if (!existsSync(resolve(ROOT, '.github/workflows/supply-chain.yml'))) {
    errors.push('missing .github/workflows/supply-chain.yml');
  } else {
    const yaml = read('.github/workflows/supply-chain.yml');
    if (!/osv-scanner-reusable/.test(yaml)) errors.push('supply-chain.yml missing osv-scanner job');
    if (!/dependency-review-action/.test(yaml)) errors.push('supply-chain.yml missing dependency-review-action');
    if (!/license-allowlist\.json/.test(yaml)) errors.push('supply-chain.yml missing license-allowlist reference');
    evidence.workflow = '.github/workflows/supply-chain.yml';
  }

  if (!existsSync(resolve(ROOT, '.github/license-allowlist.json'))) {
    errors.push('missing .github/license-allowlist.json');
  }

  const ci = read('.github/workflows/ci.yml');
  if (!/check-supply-chain-exceptions/.test(ci)) {
    errors.push('ci.yml missing check-supply-chain-exceptions wiring');
  }

  return { id: 'osv-license-dependency-review', ok: errors.length === 0, errors, evidence };
}

export function checkSbomReleaseWiring({ read = readRepoText } = {}) {
  const errors = [];
  const release = read('.github/workflows/release.yml');
  if (!/@cyclonedx\/cyclonedx-npm/.test(release)) errors.push('release.yml missing CycloneDX SBOM step');
  if (!/sbom\.cyclonedx\.json/.test(release)) errors.push('release.yml missing sbom.cyclonedx.json release asset');
  return {
    id: 'sbom-release-wiring',
    ok: errors.length === 0,
    errors,
    evidence: { workflow: '.github/workflows/release.yml' },
  };
}

export function checkProviderCardProvenance({ execFile = execFileSync } = {}) {
  const errors = [];
  try {
    runNodeScript('scripts/validate-provider-cards.mjs', { execFile });
  } catch (err) {
    errors.push(`validate-provider-cards failed: ${String(err.stderr ?? err.message)}`.trim());
  }
  return {
    id: 'provider-card-provenance',
    ok: errors.length === 0,
    errors,
    evidence: { script: 'scripts/validate-provider-cards.mjs' },
  };
}

export function checkPackedArtifactCertification({ read = readRepoText } = {}) {
  const errors = [];
  const release = read('.github/workflows/release.yml');
  if (!/packed-install\.test\.mjs/.test(release)) {
    errors.push('release.yml missing packed-install acceptance test');
  }
  if (!existsSync(resolve(ROOT, 'tests/acceptance/packed-install-removed-surfaces.mjs'))) {
    errors.push('missing tests/acceptance/packed-install-removed-surfaces.mjs');
  }
  return {
    id: 'packed-artifact-certification',
    ok: errors.length === 0,
    errors,
    evidence: { test: 'tests/acceptance/packed-install.test.mjs' },
  };
}

export function checkCompiledBinaryCertification() {
  const errors = [];
  const sea = BINARY_RELEASE_PATHS.NODE_SEA;
  const bun = BINARY_RELEASE_PATHS.BUN_COMPILE;
  if (!sea.gatesRelease) errors.push('Node SEA path must gatesRelease:true');
  if (bun.gatesRelease) errors.push('Bun path must gatesRelease:false');
  if (!/never gate/.test(bun.notes)) errors.push('Bun certification must disclose non-gating posture');
  return {
    id: 'compiled-binary-certification',
    ok: errors.length === 0,
    errors,
    evidence: {
      nodeSeaWorkflow: sea.workflow,
      bunWorkflow: bun.workflow,
      parityImplied: false,
    },
  };
}

export function checkCompatSurfaceExpiration({ execFile = execFileSync } = {}) {
  const errors = [];
  if (!existsSync(resolve(ROOT, 'scripts/validate-compat-surfaces.mjs'))) {
    errors.push('missing scripts/validate-compat-surfaces.mjs');
  } else {
    try {
      runNodeScript('scripts/validate-compat-surfaces.mjs', { execFile });
    } catch (err) {
      errors.push(`validate-compat-surfaces failed: ${String(err.stderr ?? err.message)}`.trim());
    }
  }
  return {
    id: 'compat-surface-expiration',
    ok: errors.length === 0,
    errors,
    evidence: { registry: 'compat/surfaces.json' },
  };
}

const DEFAULT_CHECKS = Object.freeze([
  checkOsvLicenseDependencyReview,
  checkSbomReleaseWiring,
  checkProviderCardProvenance,
  checkPackedArtifactCertification,
  checkCompiledBinaryCertification,
  checkCompatSurfaceExpiration,
]);

/**
 * @param {{ checks?: Array<(opts?: object) => { id: string, ok: boolean, errors: string[], evidence?: object }>, json?: boolean }} [opts]
 */
export function runSupplyChainReleaseGate({ checks = DEFAULT_CHECKS, json = false } = {}) {
  const results = checks.map((check) => check());
  const errors = results.flatMap((r) => r.errors.map((e) => `${r.id}: ${e}`));
  const report = { ok: results.every((r) => r.ok), results, errors };

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const result of results) {
      const status = result.ok ? 'pass' : 'FAIL';
      process.stdout.write(`[${status}] ${result.id}\n`);
      for (const err of result.errors) process.stderr.write(`  - ${err}\n`);
    }
    process.stdout.write(`\nsupply-chain release gate: ${report.ok ? 'PASS' : 'FAIL'}\n`);
  }

  return report;
}

function main() {
  const json = process.argv.includes('--json');
  const report = runSupplyChainReleaseGate({ json });
  process.exit(report.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
