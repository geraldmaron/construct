/**
 * scripts/run-graph-verify.mjs — required CI/local guardrail for the living graph.
 *
 * Runs `construct graph verify`, which composes strict validate, schema checks,
 * partial-graph detection, and an optional change-intent impact diff when
 * changed files are supplied. Importable for tests; runnable as
 * `node scripts/run-graph-verify.mjs [--changed <files...>] [--json]`.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const BIN = resolve(REPO_ROOT, 'bin', 'construct');

function normalizeChangedFiles(input) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : String(input).split(/\s+/);
  return list.map((f) => f.trim()).filter(Boolean);
}

function runVerify(args, { cwd, allowFailure = false } = {}) {
  try {
    return execFileSync(process.execPath, [BIN, 'graph', 'verify', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (allowFailure) return [err.stdout, err.stderr].filter(Boolean).join('\n');
    const detail = [err.stdout, err.stderr].filter(Boolean).join('\n');
    throw new Error(`construct graph verify failed:\n${detail}`);
  }
}

function parseJsonTail(out) {
  const start = out.indexOf('{');
  if (start === -1) throw new Error(`no JSON in output:\n${out}`);
  return JSON.parse(out.slice(start));
}

/**
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @param {string[]|string} [opts.changedFiles]
 * @returns {{ ok: boolean, violations: object[], intentId?: string|null }}
 */
export function runGraphVerify({ cwd = REPO_ROOT, changedFiles = [] } = {}) {
  const files = normalizeChangedFiles(changedFiles);
  const args = ['--json', ...(files.length ? ['--changed', ...files] : [])];
  const out = runVerify(args, { cwd, allowFailure: true });
  const result = parseJsonTail(out);
  return {
    ok: result.ok === true,
    violations: result.violations || [],
    intentId: result.intentId ?? null,
  };
}

function main(argv) {
  const json = argv.includes('--json');
  const changedFlag = argv.indexOf('--changed');
  const changedFiles = changedFlag === -1
    ? process.env.CHANGED_FILES ?? []
    : argv.slice(changedFlag + 1).filter((a) => !a.startsWith('--'));

  const verdict = runGraphVerify({ changedFiles });

  if (json) {
    process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
  } else if (verdict.ok) {
    process.stdout.write('✓ graph verify passed\n');
  } else {
    for (const v of verdict.violations) process.stderr.write(`  ${v.message}\n`);
    process.stderr.write(`\n✖ graph verify failed: ${verdict.violations.length} violation(s)\n`);
    process.stderr.write('  Run `construct graph verify` locally to reproduce.\n');
  }

  return verdict.ok ? 0 : 1;
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  process.exit(main(process.argv.slice(2)));
}
