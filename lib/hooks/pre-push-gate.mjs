#!/usr/bin/env node
/**
 * pre-push-gate.mjs — PreToolUse / Bash
 *
 * Intercepts three command shapes:
 *   git push                refuses claude/* branches, refuses on red remote CI,
 *                           runs project test/build/evals/docs in parallel
 *   gh pr create            lints the --body / --body-file against the PR
 *                           template policy before the PR is opened
 *   gh pr edit              same body lint when --body / --body-file is changed
 *
 * Template-policy severity is conditional: a hard block (exit 2) when a
 * specialist sub-agent is active (CONSTRUCT_AGENT_ID set, or the cx-tracker
 * shows a fresh dispatch in the last 10 minutes); a warning otherwise so a
 * human driving the session can override editorial nits without ceremony.
 * CI still enforces the same rules on the resulting PR.
 *
 * Silent and instant when there's nothing to run.
 *
 * Bypasses (env vars):
 *   CONSTRUCT_SKIP_PREPUSH=1        skip the entire push gate
 *   CONSTRUCT_ALLOW_CLAUDE_PUSH=1   allow pushing a claude/* branch
 *   CONSTRUCT_SKIP_PR_LINT=1        skip the gh pr body lint
 *
 * @p95ms 30000
 * @maxBlockingScope PreToolUse
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { execSync, spawn, spawnSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { tmpdir } from 'os';
import { logHookFailure } from './_lib/log.mjs';
import { isSpecialistAgentActive } from './_lib/specialist-agent.mjs';
import { emitRoleEvent } from '../roles/hook-emit.mjs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); }
catch (err) { logHookFailure({ hook: 'pre-push-gate', err, phase: 'parse' }); }

const echo = () => { process.stdout.write(JSON.stringify(input) + '\n'); process.exit(0); };

const command = input?.tool_input?.command || input?.command || '';
const isGitPush = /\bgit\s+push\b/.test(command);
const isGhPrCreate = /\bgh\s+pr\s+create\b/.test(command);
const isGhPrEdit = /\bgh\s+pr\s+edit\b/.test(command);

if (!isGitPush && !isGhPrCreate && !isGhPrEdit) { echo(); }

const cwd = input?.cwd || process.cwd();

if ((isGhPrCreate || isGhPrEdit) && process.env.CONSTRUCT_SKIP_PR_LINT !== '1') {
  const { body, bodyFile } = extractGhPrBody(command);
  const hasArgs = body != null || bodyFile != null;

  if (!hasArgs) {
    process.stderr.write(
      `[pre-push-gate] ${isGhPrCreate ? 'gh pr create' : 'gh pr edit'} without --body/--body-file/-F — cannot lint PR body locally.\n` +
      `  CI will still enforce the template policy. To lint manually:\n` +
      `    construct lint:templates --body-file=<path>\n`,
    );
  } else {
    const scriptPath = findRepoFile(cwd, 'scripts/lint-commits-pr.mjs');
    if (!scriptPath) {
      process.stderr.write(`[pre-push-gate] could not locate scripts/lint-commits-pr.mjs from ${cwd}; skipping PR body lint\n`);
    } else {
      const env = { ...process.env };
      let tmpFile = null;
      try {
        if (bodyFile) {
          env.PR_BODY_FILE = resolve(cwd, bodyFile);
        } else if (body != null) {
          const dir = mkdtempSync(join(tmpdir(), 'construct-pr-lint-'));
          tmpFile = join(dir, 'body.md');
          writeFileSync(tmpFile, body);
          env.PR_BODY_FILE = tmpFile;
        }
        const result = spawnSync(process.execPath, [scriptPath], {
          cwd, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000,
        });
        const out = (result.stdout?.toString() || '') + (result.stderr?.toString() || '');
        if (result.status !== 0) {
          const agentActive = isSpecialistAgentActive();
          const severity = agentActive ? 'fail' : 'warn';
          const banner = agentActive
            ? '[pre-push-gate] PR body fails template policy (specialist agent active — blocking):'
            : '[pre-push-gate] PR body fails template policy (no specialist agent active — warning only):';
          process.stderr.write(`${banner}\n${out}\n`);
          process.stderr.write(`Override: CONSTRUCT_SKIP_PR_LINT=1 <command>\n`);
          emitRoleEvent({
            type: agentActive ? 'push_gate.fail' : 'push_gate.warn',
            summary: `PR body fails template policy (${severity})`,
            hookInput: input,
            context: { command: isGhPrCreate ? 'gh pr create' : 'gh pr edit', detail: out.slice(0, 800), agentActive },
          });
          if (tmpFile) try { rmSync(dirname(tmpFile), { recursive: true, force: true }); } catch {}
          if (agentActive) process.exit(2);
        }
      } finally {
        if (tmpFile) try { rmSync(dirname(tmpFile), { recursive: true, force: true }); } catch {}
      }
    }
  }
  echo();
}

if (process.env.CONSTRUCT_SKIP_PREPUSH === '1') { echo(); }

function extractGhPrBody(cmd) {
  let m = cmd.match(/--body-file[\s=]+(["']?)(\S+?)\1(?=\s|$)/);
  if (m) return { bodyFile: m[2] };
  m = cmd.match(/(?:^|\s)-F[\s=]+(["']?)(\S+?)\1(?=\s|$)/);
  if (m) return { bodyFile: m[2] };
  m = cmd.match(/--body[\s=]+"((?:\\.|[^"\\])*)"/s);
  if (m) return { body: m[1].replace(/\\(["\\])/g, '$1') };
  m = cmd.match(/--body[\s=]+'([^']*)'/s);
  if (m) return { body: m[1] };
  return {};
}

function findRepoFile(startDir, relPath) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, relPath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

if (/\bclaude\//.test(command) && process.env.CONSTRUCT_ALLOW_CLAUDE_PUSH !== '1') {
  process.stderr.write(
    `[pre-push-gate] Refusing to push a claude/* branch to remote (user policy).\n` +
    `  Use a non-agent branch name, or override with CONSTRUCT_ALLOW_CLAUDE_PUSH=1 git push ...\n`,
  );
  emitRoleEvent({
    type: 'push_gate.fail',
    summary: 'claude/* branch push refused',
    hookInput: input,
    context: { command },
  });
  process.exit(2);
}

// Prior remote CI red-check: block only when HEAD == the SHA that failed
// (i.e. the developer is about to re-push the exact broken commit). If
// HEAD has moved past the failed SHA, those new commits may well BE the
// fix — blocking them creates a doom loop where the fix can't land
// without an env-var override, which trains everyone to ignore the gate.
// Print a non-blocking notice instead so the author still sees prior red.

try {
  const branch = execSync('git branch --show-current', { cwd, timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().trim();
  if (branch && branch !== 'main' && branch !== 'dev' && branch !== 'master') {
    const json = execSync(
      `gh run list --branch=${JSON.stringify(branch)} --limit=1 --json conclusion,databaseId,url,headSha`,
      { cwd, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
    ).toString().trim();
    if (json) {
      const [run] = JSON.parse(json);
      if (run?.conclusion === 'failure') {
        const headSha = execSync('git rev-parse HEAD', { cwd, timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] })
          .toString().trim();
        const runSha = run.headSha || '';
        const runUrl = run.url || `gh run view ${run.databaseId}`;
        if (runSha && headSha === runSha) {
          process.stderr.write(
            `[pre-push-gate] HEAD (${headSha.slice(0, 7)}) is the commit that failed CI on '${branch}'.\n` +
            `  Re-pushing the same SHA will fail again. Add a fix commit before pushing.\n` +
            `  Failed run: ${runUrl}\n` +
            `  Override (if you really mean it): CONSTRUCT_SKIP_PREPUSH=1 git push ...\n`,
          );
          emitRoleEvent({
            type: 'push_gate.fail',
            summary: 'remote CI red on current HEAD — push blocked',
            hookInput: input,
            context: { branch, runId: run.databaseId, runUrl: run.url, headSha, runSha },
          });
          process.exit(2);
        }
        process.stderr.write(
          `[pre-push-gate] Note: last CI run on '${branch}' (${runSha.slice(0, 7) || 'unknown SHA'}) failed; HEAD (${headSha.slice(0, 7)}) is past it. Allowing push — CI will re-evaluate.\n` +
          `  Prior failure: ${runUrl}\n`,
        );
      }
    }
  }
} catch {}

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
  if (hasTest || hasCi) jobs.push({ label: 'tests', cmd: runner, args: ['run', testScript],                  timeout: 90_000 });
  if (hasBuild)         jobs.push({ label: 'build', cmd: runner, args: ['run', 'build'],                     timeout: 120_000 });
  // Use the project's package manager for audit so the lockfile format matches.
  // Skip workspace deps — workspace packages here (apps/docs, apps/dashboard,
  // packages/cx-ui) are build-time tooling for the docs site and dashboard,
  // not runtime deps of the published CLI. Their advisories are tracked
  // separately in CHANGELOG and CI; the gate guards the published surface.

  const auditArgs = runner === 'pnpm'
    ? ['audit', '--prod', '--audit-level=high']
    : runner === 'yarn'
      ? ['npm-audit', '--groups', 'dependencies', '--level', 'high']
      : ['audit', '--omit=dev', '--audit-level=high', '--workspaces=false'];
  jobs.push({                       label: 'audit', cmd: runner, args: auditArgs, timeout: 30_000 });

  if (existsSync(join(projectDir, 'bin/construct'))) {
    jobs.push({ label: 'evals',             cmd: 'node', args: ['bin/construct', 'evals', 'retrieval'],          timeout: 60_000 });
    jobs.push({ label: 'docs',              cmd: 'node', args: ['bin/construct', 'docs:verify'],                 timeout: 15_000 });
    jobs.push({ label: 'docs drift',        cmd: 'node', args: ['bin/construct', 'docs:update', '--check'],      timeout: 15_000 });
    // No dedicated dashboard-drift job: `npm test` (above) already runs
    // tests/functional/dashboard-build.functional.test.mjs, which builds
    // apps/dashboard/ end-to-end and asserts on the static export. Running
    // a second `next build` here races the first on apps/dashboard/.next/.
    // CI runs `dashboard:sync --build` standalone (no shared test runner),
    // so the build still gates on fresh checkouts. See tests/ci-parity.test.mjs # noparity
    // for the asymmetry contract.
    jobs.push({ label: 'comment policy',    cmd: 'node', args: ['bin/construct', 'lint:comments'],               timeout: 30_000 });
    jobs.push({ label: 'agents registry',   cmd: 'node', args: ['bin/construct', 'lint:agents'],                 timeout: 15_000 });
    jobs.push({ label: 'contracts schema',  cmd: 'node', args: ['bin/construct', 'lint:contracts'],              timeout: 15_000 });
  }

  if (existsSync(join(projectDir, 'scripts/lint-prose.mjs'))) {
    jobs.push({ label: 'prose',    cmd: 'node', args: ['scripts/lint-prose.mjs'],         timeout: 15_000 });
  }
  if (existsSync(join(projectDir, 'scripts/lint-profiles.mjs'))) {
    jobs.push({ label: 'profiles', cmd: 'node', args: ['scripts/lint-profiles.mjs', '--quiet'], timeout: 15_000 });
  }

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

// Auto-fix docs drift: if docs:update --check fails, run docs:update to regenerate
const docsDriftResult = results.find((r) => r.label === 'docs drift');
if (docsDriftResult && docsDriftResult.status !== 0) {
  process.stderr.write('[pre-push-gate] Docs drift detected — auto-running docs:update...\n');
  try {
    const fix = spawnSync('node', ['bin/construct', 'docs:update'], {
      cwd: gate.projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    if (fix.status === 0) {
      process.stderr.write('[pre-push-gate] docs:update succeeded — re-checking...\n');
      const recheck = spawnSync('node', ['bin/construct', 'docs:update', '--check'], {
        cwd: gate.projectDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15_000,
      });
      if (recheck.status === 0) {
        process.stderr.write('[pre-push-gate] Docs are now clean after auto-fix.\n');
        results.splice(results.indexOf(docsDriftResult), 1); // remove from failure candidates
      } else {
        process.stderr.write(`[pre-push-gate] Auto-fix attempted but docs still drift — manual intervention needed.\n`);
        docsDriftResult.stdout = (docsDriftResult.stdout || '') + '\n[auto-fix attempted but still dirty]';
      }
    } else {
      process.stderr.write(`[pre-push-gate] docs:update auto-fix failed (exit ${fix.status}): ${fix.stderr.slice(0, 300)}\n`);
    }
  } catch (e) {
    process.stderr.write(`[pre-push-gate] docs:update auto-fix threw: ${e.message}\n`);
  }
}

for (const result of results) {
  if (result.status === 0) continue;
  const detail = (result.stderr || result.stdout || '').trim();
  failures.push({ label: result.label, detail: detail || `exited ${result.status}` });
}

if (failures.length === 0) { echo(); }

const summary = failures
  .map((f) => `${f.label} failed — ${f.detail}`)
  .join('\n');

process.stderr.write(
  `[pre-push-gate] Push blocked — fix these before pushing:\n${summary}\n\nRun the failing checks locally, then push again.\n`
);

emitRoleEvent({
  type: 'push_gate.fail',
  summary,
  hookInput: input,
  context: { failures },
});

process.exit(2);
