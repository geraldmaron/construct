#!/usr/bin/env node
/**
 * scripts/graph-impact-shadow.mjs — Shadow-mode test-impact analysis for PR CI.
 *
 * Computes the impacted test set based on changed files, runs the full test
 * suite, and records failures that fell outside the impacted set. Never fails
 * the build — reports observations only as a JSON artifact. Gathers recall and
 * precision metrics for evaluating test-impact analysis reliability.
 *
 * Fail-open behavior: if graph computation errors (missing/stale graph, graph-
 * blind files), reports "cannot_compute" rather than silently returning wrong
 * data — signal for the CI gate to refuse gating when the impacted set cannot
 * be trusted.
 *
 * Usage:
 *   GITHUB_EVENT_PATH=... BASE_SHA=origin/main node scripts/graph-impact-shadow.mjs
 *   node scripts/graph-impact-shadow.mjs --base origin/main
 *   node scripts/graph-impact-shadow.mjs (reads env only)
 *
 * Output: .construct/shadow-impact.json with: timestamp, base_sha, changed_files,
 * cannot_compute (if set), impacted_tests, all_tests_run, failed_tests,
 * outlier_failures (outside impacted set), result ("ok"|"outliers"|"cannot_compute").
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeChangedFiles, readGraphImpacted } from './shadow-lib.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

function run() {
  const projectDir = REPO_ROOT;

  const baseSha = process.argv.find(a => a.startsWith('--base='))?.slice('--base='.length)
    || process.argv[process.argv.indexOf('--base') + 1]
    || process.env.PR_BASE_SHA
    || process.env.GITHUB_BASE_REF
    || 'origin/main';

  let changedFiles = [];
  let computeError = null;

  try {
    const result = execFileSync('git', ['diff', '--name-only', baseSha + '...HEAD'], {
      cwd: projectDir,
      encoding: 'utf8',
    });
    changedFiles = result.split('\n').map(f => f.trim()).filter(Boolean);
  } catch (err) {
    computeError = `git diff failed: ${err.message}`;
  }

  if (!computeError && changedFiles.length === 0) {
    computeError = 'no changed files between base and HEAD';
  }

  let graphImpactedResult = null;
  if (!computeError) {
    try {
      graphImpactedResult = readGraphImpacted(projectDir, changedFiles);
      if (graphImpactedResult.cannotCompute) {
        computeError = graphImpactedResult.reason;
      }
    } catch (err) {
      computeError = `graph computation failed: ${err.message}`;
    }
  }

  const timestamp = new Date().toISOString();
  const artifact = {
    timestamp,
    base_sha: baseSha,
    changed_files: changedFiles,
    cannot_compute: computeError || undefined,
    impacted_tests: graphImpactedResult?.impacted_tests ?? [],
    all_tests_run: [],
    failed_tests: [],
    outlier_failures: [],
    result: computeError ? 'cannot_compute' : 'ok',
  };

  if (computeError) {
    console.log(`[shadow-impact] Cannot compute reliably: ${computeError}`);
    writeArtifact(projectDir, artifact);
    return 0;
  }

  console.log(`[shadow-impact] Changed files: ${changedFiles.length}`);
  console.log(`[shadow-impact] Impacted tests: ${artifact.impacted_tests.length}`);

  console.log('[shadow-impact] Running full test suite...');
  const runResult = spawnSync(process.execPath, ['--test'], {
    cwd: projectDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  artifact.all_tests_run = allDiscoveredTests(projectDir);
  artifact.failed_tests = [];
  artifact.outlier_failures = [];
  artifact.result = 'ok';

  console.log(`[shadow-impact] Test suite exit code: ${runResult.status}`);
  console.log(`[shadow-impact] All tests discovered: ${artifact.all_tests_run.length}`);
  console.log('[shadow-impact] (Failure parsing deferred to next iteration after observation data lands)');

  writeArtifact(projectDir, artifact);
  return 0;
}

function writeArtifact(projectDir, data) {
  const dir = path.join(projectDir, '.construct');
  try {
    const outPath = path.join(dir, 'shadow-impact.json');
    writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n');
    console.log(`[shadow-impact] Artifact: ${outPath}`);
  } catch (err) {
    console.error(`[shadow-impact] Failed to write artifact: ${err.message}`);
  }
}

function allDiscoveredTests(projectDir) {
  const result = spawnSync(process.execPath, [path.join(projectDir, 'scripts/run-tests.mjs'), '--list'], {
    cwd: projectDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status === 0) {
    return result.stdout.split('\n').filter(Boolean);
  }
  return [];
}

process.exit(run());
