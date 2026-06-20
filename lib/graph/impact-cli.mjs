/**
 * lib/graph/impact-cli.mjs — `construct impact` command surface.
 *
 * Maps changed files to the tests that should run and the capabilities and
 * workflows they touch, using the living dependency graph. Advisory by default;
 * `--run` executes the selected tests via `node --test`. Files come from
 * positional args, or — when none are given — from `git diff --name-only HEAD`.
 *
 *   construct impact lib/oracle/synthesize.mjs
 *   construct impact --run
 *   git diff --name-only origin/main | construct impact --stdin --json
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { computeImpact } from './impact.mjs';

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

function gitChangedFiles(projectDir) {
  const res = spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd: projectDir, encoding: 'utf8' });
  if (res.status !== 0) return [];
  return res.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * @param {string[]} args
 * @param {{ rootDir: string, projectDir: string }} ctx
 * @returns {Promise<number>} exit code
 */
export async function runImpactCli(args, { projectDir }) {
  const json = args.includes('--json');
  const run = args.includes('--run');
  const useStdin = args.includes('--stdin');
  let files = args.filter((a) => !a.startsWith('--'));

  if (useStdin) files = readStdin().split('\n').map((l) => l.trim()).filter(Boolean);
  if (files.length === 0) files = gitChangedFiles(projectDir);

  if (files.length === 0) {
    process.stderr.write('No changed files given (args, --stdin, or git diff). Nothing to analyze.\n');
    return 1;
  }

  const result = computeImpact({ rootDir: projectDir, changedFiles: files });

  if (!result.graphPresent) {
    process.stderr.write('No dependency graph found. Run `construct matrix build` first.\n');
    return 1;
  }

  if (json && !run) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  }

  if (!json) {
    process.stdout.write(`Changed: ${result.changed.length} file(s)\n`);
    process.stdout.write(`Impacted capabilities (${result.impactedCapabilities.length}): ${result.impactedCapabilities.join(', ') || '(none)'}\n`);
    process.stdout.write(`Impacted workflows (${result.impactedWorkflows.length}): ${result.impactedWorkflows.join(', ') || '(none)'}\n`);
    process.stdout.write(`Affected tests (${result.affectedTests.length}):\n`);
    for (const t of result.affectedTests) process.stdout.write(`  ${t}\n`);
    if (result.coverageGaps.length) {
      process.stdout.write(`\n⚠ Coverage gap — changed files realizing no capability (${result.coverageGaps.length}):\n`);
      for (const f of result.coverageGaps) process.stdout.write(`  ${f}\n`);
    }
    if (result.unknown.length) {
      process.stdout.write(`\nNot in graph (${result.unknown.length}): ${result.unknown.join(', ')}\n`);
    }
  }

  if (run) {
    const runnable = result.affectedTests.filter((t) => existsSync(path.join(projectDir, t)));
    if (runnable.length === 0) {
      process.stdout.write('\nNo runnable affected tests on disk.\n');
      return 0;
    }
    process.stdout.write(`\n▶ Running ${runnable.length} affected test(s)…\n`);
    const res = spawnSync(process.execPath, ['--test', ...runnable], { cwd: projectDir, stdio: 'inherit' });
    return res.status ?? 1;
  }

  return 0;
}
