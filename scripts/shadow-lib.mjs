/**
 * scripts/shadow-lib.mjs — Helpers for shadow-mode test-impact analysis.
 *
 * Encapsulates graph computation, staleness checks, and graph-blind file
 * detection so the fail-open behavior is testable and reusable.
 */

import { execFileSync } from 'node:child_process';
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
