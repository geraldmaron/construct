#!/usr/bin/env node
/**
 * pre-push-gate.mjs — PreToolUse / Bash
 *
 * Intercepts `git push` commands. Detects available test and build scripts
 * in the project, runs them in parallel, and blocks the push if either fails.
 * Silent and instant when there's nothing to run.
 */
import { readFileSync, existsSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { dirname, join } from 'path';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { /* no stdin */ }

// Must always echo stdin for PreToolUse chaining
const echo = () => { process.stdout.write(JSON.stringify(input) + '\n'); process.exit(0); };

const command = input?.tool_input?.command || input?.command || '';

// Only act on git push
if (!/\bgit\s+push\b/.test(command)) { echo(); }

// Find nearest package.json / Cargo.toml / pyproject.toml from cwd
const cwd = input?.cwd || process.cwd();

function findUp(filename, from) {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, filename);
    if (existsSync(candidate)) return { path: candidate, dir };
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ── Node/npm project ──────────────────────────────────────────────────────────
function runNpmGate(projectDir) {
  let pkg;
  try { pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')); } catch { return null; }

  const scripts = pkg.scripts || {};
  const hasTest  = !!(scripts.test  && !scripts.test.includes('no test specified'));
  const hasBuild = !!(scripts.build);
  const hasCi    = !!(scripts['test:ci'] || scripts['test:run']);

  const testScript  = scripts['test:ci'] ? 'test:ci' : scripts['test:run'] ? 'test:run' : 'test';
  const runner = existsSync(join(projectDir, 'pnpm-lock.yaml')) ? 'pnpm'
               : existsSync(join(projectDir, 'yarn.lock'))      ? 'yarn'
               : 'npm';

  const jobs = [];
  if (hasTest || hasCi) jobs.push({ label: 'tests',  cmd: runner, args: ['run', testScript], timeout: 90_000 });
  if (hasBuild)         jobs.push({ label: 'build',  cmd: runner, args: ['run', 'build'],    timeout: 120_000 });

  return { projectDir, jobs };
}

// ── Rust/Cargo project ────────────────────────────────────────────────────────
function runCargoGate(projectDir) {
  const jobs = [
    { label: 'tests', cmd: 'cargo', args: ['test', '--quiet'], timeout: 120_000 },
    { label: 'build', cmd: 'cargo', args: ['build', '--quiet'], timeout: 120_000 },
  ];
  return { projectDir, jobs };
}

// ── Python project ────────────────────────────────────────────────────────────
function runPythonGate(projectDir) {
  const hasPytest = (() => { try { execSync('pytest --version', { stdio: 'pipe', timeout: 3000 }); return true; } catch { return false; } })();
  if (!hasPytest) return null;
  const jobs = [{ label: 'tests', cmd: 'pytest', args: ['--tb=short', '-q'], timeout: 90_000 }];
  return { projectDir, jobs };
}

// Detect project type
let gate = null;
const npm     = findUp('package.json', cwd);
const cargo   = findUp('Cargo.toml', cwd);
const pyproj  = findUp('pyproject.toml', cwd) || findUp('setup.py', cwd);

if (npm)    gate = runNpmGate(npm.dir);
else if (cargo)  gate = runCargoGate(cargo.dir);
else if (pyproj) gate = runPythonGate(pyproj.dir);

// Nothing to check
if (!gate || gate.jobs.length === 0) { echo(); }

// Run jobs in parallel via Promise.all simulation (spawnSync is synchronous — run sequentially)
// For true parallel, we use spawnSync with a short timeout and report errors
const failures = [];

for (const job of gate.jobs) {
  const result = spawnSync(job.cmd, job.args, {
    cwd: gate.projectDir,
    encoding: 'utf8',
    timeout: job.timeout,
    stdio: 'pipe',
    env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
  });

  if (result.status !== 0 || result.error) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    const detail = stderr || stdout;
    // Extract first meaningful error line (skip blank, generic lines)
    const firstError = detail.split('\n')
      .map(l => l.trim())
      .filter(l => l && !/^>/.test(l) && !/^\s*at /.test(l))
      .slice(0, 3)
      .join(' · ');

    failures.push({ label: job.label, detail: firstError || `exited ${result.status}` });
  }
}

if (failures.length === 0) { echo(); }

// Block the push
const summary = failures
  .map(f => `${f.label} failed — ${f.detail}`)
  .join('\n');

process.stderr.write(
  `[pre-push-gate] Push blocked — fix these before pushing:\n${summary}\n\nRun the failing checks locally, then push again.\n`
);
process.exit(2);
