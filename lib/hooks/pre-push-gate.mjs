#!/usr/bin/env node
/**
 * pre-push-gate.mjs — PreToolUse / Bash
 *
 * Intercepts `git push` commands. Detects available test and build scripts
 * in the project, runs them in parallel, and blocks the push if either fails.
 * Silent and instant when there's nothing to run.
 *
 * @p95ms 30000
 * @maxBlockingScope PreToolUse
 */
import { readFileSync, existsSync } from 'fs';
import { execSync, spawn } from 'child_process';
import { dirname, join } from 'path';
import { logHookFailure } from './_lib/log.mjs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); }
catch (err) { logHookFailure({ hook: 'pre-push-gate', err, phase: 'parse' }); }

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

// Jobs run concurrently. Wall-clock = max(test, build) instead of sum, so the
// gate fits inside the harness's 180s timeout even when both jobs near their
// individual limits.
function runJob(job) {
  return new Promise((resolve) => {
    let stdoutBuf = '';
    let stderrBuf = '';
    const child = spawn(job.cmd, job.args, {
      cwd: gate.projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
    });

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }, job.timeout);

    child.stdout?.on('data', (chunk) => { stdoutBuf += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderrBuf += chunk.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ label: job.label, status: -1, stdout: stdoutBuf, stderr: stderrBuf || err.message, error: err });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ label: job.label, status: code ?? -1, stdout: stdoutBuf, stderr: stderrBuf });
    });
  });
}

const results = await Promise.all(gate.jobs.map(runJob));
const failures = [];
for (const result of results) {
  if (result.status === 0) continue;
  const detail = (result.stderr || result.stdout || '').trim();
  const firstError = detail.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^>/.test(l) && !/^\s*at /.test(l))
    .slice(0, 3)
    .join(' · ');
  failures.push({ label: result.label, detail: firstError || `exited ${result.status}` });
}

if (failures.length === 0) { echo(); }

const summary = failures
  .map((f) => `${f.label} failed — ${f.detail}`)
  .join('\n');

process.stderr.write(
  `[pre-push-gate] Push blocked — fix these before pushing:\n${summary}\n\nRun the failing checks locally, then push again.\n`
);
process.exit(2);
