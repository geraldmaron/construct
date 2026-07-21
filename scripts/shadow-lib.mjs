/**
 * scripts/shadow-lib.mjs — Helpers for shadow-mode test-impact analysis.
 *
 * Encapsulates graph computation, staleness checks, graph-blind file detection,
 * promotion metrics, and historical artifact loading for shadow-to-gating
 * graduation.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const BIN = path.resolve(REPO_ROOT, 'bin', 'construct');

const GRAPH_BLIND_FILES = [
  '.github/workflows/',
  'package-lock.json',
  'scripts/ci/',
];

export function normalizeChangedFiles(files) {
  return files
    .filter(f => f != null)
    .map(f => String(f).split('\\').join('/').replace(/^\.\//, ''))
    .map(f => f.trim())
    .filter(Boolean);
}

function isGraphBlindFile(rel) {
  return GRAPH_BLIND_FILES.some(blind => rel.startsWith(blind));
}

function containsGraphBlindFile(changedFiles) {
  return changedFiles.some(isGraphBlindFile);
}

function runGraphCommand(args, { cwd, allowFailure = false } = {}) {
  try {
    return execFileSync(process.execPath, [BIN, 'graph', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (allowFailure) return err.stdout ?? '';
    throw new Error(`construct graph ${args.join(' ')} failed: ${err.message}`);
  }
}

function parseJsonTail(str) {
  const start = str.indexOf('{');
  if (start === -1) throw new Error('no JSON in output');
  return JSON.parse(str.slice(start));
}

/**
 * Compute the impacted test set for a set of changed files. Returns an object
 * with cannotCompute flag and reason if the graph is stale, missing, or the
 * changes touch graph-blind files.
 *
 * @param {string} projectDir - project root
 * @param {string[]} changedFiles - repo-relative paths
 * @returns {{
 *   cannotCompute?: boolean,
 *   reason?: string,
 *   impacted_tests?: string[],
 *   unknown?: string[],
 * }}
 */
export function readGraphImpacted(projectDir, changedFiles) {
  const normalized = normalizeChangedFiles(changedFiles);

  if (containsGraphBlindFile(normalized)) {
    return {
      cannotCompute: true,
      reason: 'changed files include graph-blind paths (.github/workflows, package-lock.json, scripts/ci)',
    };
  }

  try {
    const staleOutput = runGraphCommand(['stale', '--json'], { cwd: projectDir });
    const stale = parseJsonTail(staleOutput);
    if (stale.stale === true) {
      return {
        cannotCompute: true,
        reason: `graph is stale (sources: ${(stale.staleSources ?? []).join(', ')})`,
      };
    }
  } catch (err) {
    return {
      cannotCompute: true,
      reason: `staleness check failed: ${err.message}`,
    };
  }

  try {
    const impactedOutput = runGraphCommand(
      ['impacted', '--changed', ...normalized, '--json'],
      { cwd: projectDir }
    );
    const result = parseJsonTail(impactedOutput);
    if (!result.graphPresent) {
      return {
        cannotCompute: true,
        reason: 'graph not present; run `construct graph build` first',
      };
    }
    return {
      impacted_tests: result.impactedTests ?? [],
      unknown: result.unknown ?? [],
    };
  } catch (err) {
    return {
      cannotCompute: true,
      reason: `graph impacted computation failed: ${err.message}`,
    };
  }
}

export const PROMOTION_CRITERIA = {
  minEligibleRuns: 30,
  maxOutlierRuns: 0,
  windowDays: 90,
};

/**
 * Derive recall and precision for one shadow artifact. Recall is the fraction
 * of failed test files that were in the impacted set. Precision is the fraction
 * of impacted test files that actually failed.
 *
 * @param {{
 *   failed_tests?: string[],
 *   impacted_tests?: string[],
 *   outlier_failures?: string[],
 *   result?: string,
 *   timestamp?: string,
 * }} artifact
 */
export function computeArtifactMetrics(artifact) {
  const failed = artifact.failed_tests ?? [];
  const impacted = artifact.impacted_tests ?? [];
  const outliers = artifact.outlier_failures ?? [];
  const impactedSet = new Set(impacted);
  const failedSet = new Set(failed);
  const truePositives = failed.filter((f) => impactedSet.has(f));
  const falsePositives = impacted.filter((f) => !failedSet.has(f));

  const recall = failed.length === 0 ? null : truePositives.length / failed.length;
  const precision = impacted.length === 0 ? null : truePositives.length / impacted.length;

  return {
    timestamp: artifact.timestamp ?? null,
    result: artifact.result ?? null,
    eligible: artifact.result === 'ok' || artifact.result === 'outliers',
    failed_count: failed.length,
    impacted_count: impacted.length,
    outlier_count: outliers.length,
    recall,
    precision,
    true_positives: truePositives.length,
    false_negatives: outliers.length,
    false_positives: falsePositives.length,
  };
}

/**
 * Read shadow-impact JSON files from a directory (one file per CI run).
 *
 * @param {string} dir
 * @returns {object[]}
 */
export function loadShadowArtifacts(dir) {
  if (!existsSync(dir)) return [];
  const artifacts = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      artifacts.push(JSON.parse(readFileSync(path.join(dir, name), 'utf8')));
    } catch {
      /* skip unreadable entries */
    }
  }
  return artifacts;
}

/**
 * Aggregate historical shadow runs and decide whether gating may activate.
 *
 * @param {object[]} artifacts
 * @param {typeof PROMOTION_CRITERIA} [criteria]
 * @param {Date} [now]
 */
export function aggregatePromotionReport(artifacts, criteria = PROMOTION_CRITERIA, now = new Date()) {
  const windowMs = criteria.windowDays * 24 * 60 * 60 * 1000;
  const cutoff = new Date(now.getTime() - windowMs);

  const inWindow = artifacts.filter((a) => {
    if (!a.timestamp) return false;
    const ts = new Date(a.timestamp);
    return !Number.isNaN(ts.getTime()) && ts >= cutoff;
  });

  const runs = inWindow
    .map((artifact) => ({ artifact, metrics: computeArtifactMetrics(artifact) }))
    .sort((a, b) => new Date(a.artifact.timestamp).getTime() - new Date(b.artifact.timestamp).getTime());

  const eligible = runs.filter((r) => r.metrics.eligible);
  const outlierRuns = eligible.filter((r) => r.metrics.outlier_count > 0);

  let pooledFailed = 0;
  let pooledOutliers = 0;
  let pooledTruePositives = 0;
  let pooledImpacted = 0;
  for (const { metrics } of eligible) {
    pooledFailed += metrics.failed_count;
    pooledOutliers += metrics.outlier_count;
    pooledTruePositives += metrics.true_positives;
    pooledImpacted += metrics.impacted_count;
  }

  const aggregateRecall = pooledFailed === 0 ? null : (pooledFailed - pooledOutliers) / pooledFailed;
  const aggregatePrecision = pooledImpacted === 0 ? null : pooledTruePositives / pooledImpacted;

  const reasons = [];
  if (eligible.length < criteria.minEligibleRuns) {
    reasons.push(`insufficient eligible runs: ${eligible.length}/${criteria.minEligibleRuns}`);
  }
  if (outlierRuns.length > criteria.maxOutlierRuns) {
    reasons.push(`outlier runs in window: ${outlierRuns.length} (max ${criteria.maxOutlierRuns})`);
  }

  const promoted = reasons.length === 0;

  return {
    criteria,
    verdict: promoted ? 'promoted' : 'not-promoted',
    promoted,
    reasons,
    eligible_run_count: eligible.length,
    outlier_run_count: outlierRuns.length,
    aggregate_recall: aggregateRecall,
    aggregate_precision: aggregatePrecision,
    runs: runs.map(({ artifact, metrics }) => ({
      timestamp: artifact.timestamp,
      result: artifact.result,
      ...metrics,
    })),
  };
}

/**
 * Fail when a shadow artifact records failures outside the impacted set.
 *
 * @param {{ outlier_failures?: string[], result?: string }} artifact
 * @returns {{ ok: true } | { ok: false, outlier_failures: string[] }}
 */
export function enforceNoOutlierFailures(artifact) {
  const outliers = artifact.outlier_failures ?? [];
  if (outliers.length > 0 || artifact.result === 'outliers') {
    return { ok: false, outlier_failures: outliers };
  }
  return { ok: true };
}

/**
 * Build the JSON object consumed by scripts/run-tests.mjs --files-from.
 *
 * @param {string[]} testFiles
 * @returns {Record<string, true>}
 */
export function impactedTestsToFilesFrom(testFiles) {
  const out = {};
  for (const file of testFiles) out[file] = true;
  return out;
}
