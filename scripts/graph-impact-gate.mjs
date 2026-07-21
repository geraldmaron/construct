#!/usr/bin/env node
/**
 * scripts/graph-impact-gate.mjs — Required graph-derived test-impact gate.
 *
 * When shadow history satisfies the promotion threshold, runs impacted-only
 * tests for the PR diff and fails loud on compute errors, test failures, or
 * outlier failures recorded in a companion shadow artifact. Until promotion,
 * exits 0 without running tests so CI keeps collecting shadow data.
 *
 * Reversible via CONSTRUCT_GRAPH_IMPACT_GATING=0 or when promotion criteria
 * are not met.
 *
 * Usage:
 *   PR_BASE_SHA=origin/main node scripts/graph-impact-gate.mjs
 *   node scripts/graph-impact-gate.mjs --base origin/main
 *   CONSTRUCT_GRAPH_IMPACT_FORCE_GATING=1 node scripts/graph-impact-gate.mjs
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPromotionReport } from './graph-impact-promotion-report.mjs';
import {
  enforceNoOutlierFailures,
  impactedTestsToFilesFrom,
  readGraphImpacted,
} from './shadow-lib.mjs';
import { isMainModule } from '../lib/roots.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

function parseBaseSha(argv) {
  const fromFlag = argv.find((a) => a.startsWith('--base='))?.slice('--base='.length)
    || argv[argv.indexOf('--base') + 1];
  return fromFlag
    || process.env.PR_BASE_SHA
    || process.env.GITHUB_BASE_REF
    || 'origin/main';
}

function gatingEnabled(report) {
  if (process.env.CONSTRUCT_GRAPH_IMPACT_GATING === '0') return false;
  if (process.env.CONSTRUCT_GRAPH_IMPACT_FORCE_GATING === '1') return true;
  return report.promoted === true;
}

function gitChangedFiles(projectDir, baseSha) {
  const result = execFileSync('git', ['diff', '--name-only', `${baseSha}...HEAD`], {
    cwd: projectDir,
    encoding: 'utf8',
  });
  return result.split('\n').map((f) => f.trim()).filter(Boolean);
}

function runImpactedTests(projectDir, impactedTests) {
  if (impactedTests.length === 0) {
    console.log('[graph-impact-gate] No impacted tests; skipping test run.');
    return 0;
  }

  const constructDir = path.join(projectDir, '.construct');
  mkdirSync(constructDir, { recursive: true });
  const filesFromPath = path.join(constructDir, 'impacted-tests.json');
  writeFileSync(filesFromPath, JSON.stringify(impactedTestsToFilesFrom(impactedTests), null, 2) + '\n');

  console.log(`[graph-impact-gate] Running ${impactedTests.length} impacted test file(s)...`);
  const result = spawnSync(
    process.execPath,
    [
      path.join(projectDir, 'scripts', 'run-tests.mjs'),
      `--files-from=${filesFromPath}`,
    ],
    { cwd: projectDir, stdio: 'inherit' }
  );
  return result.status ?? 1;
}

/**
 * @param {{
 *   projectDir?: string,
 *   baseSha?: string,
 *   historyDir?: string,
 *   shadowArtifactPath?: string,
 *   forceGating?: boolean,
 * }} [options]
 */
export function runGraphImpactGate(options = {}) {
  const projectDir = options.projectDir ?? REPO_ROOT;
  const baseSha = options.baseSha ?? parseBaseSha([]);
  const historyDir = options.historyDir ?? path.join(projectDir, '.construct', 'shadow-history');
  const shadowArtifactPath = options.shadowArtifactPath ?? path.join(projectDir, '.construct', 'shadow-impact.json');

  const priorEnv = {
    force: process.env.CONSTRUCT_GRAPH_IMPACT_FORCE_GATING,
    gating: process.env.CONSTRUCT_GRAPH_IMPACT_GATING,
  };
  if (options.forceGating === true) process.env.CONSTRUCT_GRAPH_IMPACT_FORCE_GATING = '1';
  if (options.forceGating === false) process.env.CONSTRUCT_GRAPH_IMPACT_GATING = '0';

  try {
    const report = buildPromotionReport({ dir: historyDir });
    if (!gatingEnabled(report)) {
      console.log('[graph-impact-gate] Gating inactive (promotion threshold not met).');
      console.log(`[graph-impact-gate] Verdict: ${report.verdict}; eligible runs: ${report.eligible_run_count}/${report.criteria.minEligibleRuns}`);
      for (const reason of report.reasons) console.log(`[graph-impact-gate]   ${reason}`);
      return { status: 0, mode: 'skipped', report };
    }

    console.log('[graph-impact-gate] Gating active; running impacted-only tests.');

    let changedFiles;
    try {
      changedFiles = gitChangedFiles(projectDir, baseSha);
    } catch (err) {
      console.error(`[graph-impact-gate] git diff failed: ${err.message}`);
      return { status: 1, mode: 'error', reason: 'git diff failed' };
    }

    if (changedFiles.length === 0) {
      console.error('[graph-impact-gate] No changed files between base and HEAD.');
      return { status: 1, mode: 'error', reason: 'no changed files' };
    }

    const graphResult = readGraphImpacted(projectDir, changedFiles);
    if (graphResult.cannotCompute) {
      console.error(`[graph-impact-gate] Cannot compute impacted set: ${graphResult.reason}`);
      return { status: 1, mode: 'error', reason: graphResult.reason };
    }

    const impactedTests = graphResult.impacted_tests ?? [];
    const testStatus = runImpactedTests(projectDir, impactedTests);
    if (testStatus !== 0) {
      return { status: testStatus, mode: 'impacted-tests-failed', impacted_tests: impactedTests };
    }

    if (existsSync(shadowArtifactPath)) {
      const shadowArtifact = JSON.parse(readFileSync(shadowArtifactPath, 'utf8'));
      const outlierCheck = enforceNoOutlierFailures(shadowArtifact);
      if (!outlierCheck.ok) {
        console.error('[graph-impact-gate] Outlier failures detected outside impacted set:');
        for (const file of outlierCheck.outlier_failures) {
          console.error(`  - ${file}`);
        }
        return { status: 1, mode: 'outliers', outlier_failures: outlierCheck.outlier_failures };
      }
    }

    return { status: 0, mode: 'passed', impacted_tests: impactedTests, report };
  } finally {
    if (options.forceGating === true) {
      if (priorEnv.force === undefined) delete process.env.CONSTRUCT_GRAPH_IMPACT_FORCE_GATING;
      else process.env.CONSTRUCT_GRAPH_IMPACT_FORCE_GATING = priorEnv.force;
    }
    if (options.forceGating === false) {
      if (priorEnv.gating === undefined) delete process.env.CONSTRUCT_GRAPH_IMPACT_GATING;
      else process.env.CONSTRUCT_GRAPH_IMPACT_GATING = priorEnv.gating;
    }
  }
}

function run(argv = process.argv.slice(2)) {
  const baseSha = parseBaseSha(argv);
  const result = runGraphImpactGate({ baseSha });
  return result.status;
}

if (isMainModule(import.meta.url)) process.exit(run());
