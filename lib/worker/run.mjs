/**
 * lib/worker/run.mjs — bounded command execution for the worker plane.
 *
 * Runs a single shell command with a hard timeout and a path-policy
 * check so workers cannot write outside their allowed workspace. The
 * worker plane stays decoupled from the control plane: this module
 * accepts a job descriptor and returns a job result; it does not pick
 * what to run or interpret the result. Higher layers (intake claim,
 * task graph dispatcher, evidence recorder) glue the pieces together.
 *
 * Job input:
 *   { jobId, taskId, project, workspaceRef, command, args?,
 *     timeoutSeconds, envPolicy, allowedPaths, network }
 *
 * Job output:
 *   { jobId, taskId, status, exitCode, stdoutPath, stderrPath,
 *     durationMs, artifacts, traceId, spanId }
 *
 * `envPolicy: 'restricted'` strips the env down to PATH, HOME, USER,
 * TZ, LANG plus an explicit allowlist. Path policy is enforced by
 * resolving every entry in allowedPaths and refusing to start when
 * the resolved workspaceRef sits outside that allowlist.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { emitTraceEvent, newTraceId, newSpanId } from './trace.mjs';

const DEFAULT_TIMEOUT_SECONDS = 300;
const ARTIFACTS_SUBDIR = '.cx/runtime/worker';

function artifactsDir(rootDir) {
  return path.join(rootDir, ARTIFACTS_SUBDIR);
}

function buildRestrictedEnv(allowedKeys = []) {
  const base = ['PATH', 'HOME', 'USER', 'TZ', 'LANG', 'LC_ALL', 'TMPDIR'];
  const env = {};
  for (const key of [...base, ...allowedKeys]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

function isInsideAllowedPaths(workspaceRef, allowedPaths) {
  if (!allowedPaths || allowedPaths.length === 0) return true;
  const target = path.resolve(workspaceRef);
  return allowedPaths
    .map((p) => path.resolve(p))
    .some((allowed) => target === allowed || target.startsWith(`${allowed}${path.sep}`));
}

/**
 * Run a worker job. Resolves with the result regardless of command outcome;
 * rejects only on programmer errors (invalid job shape, path policy denial).
 */
export async function runJob({
  rootDir,
  job,
  emitEvent = emitTraceEvent,
  spawnFn = spawn,
} = {}) {
  if (!rootDir) throw new Error('runJob: rootDir is required');
  if (!job?.jobId) throw new Error('runJob: job.jobId is required');
  if (!job?.command) throw new Error('runJob: job.command is required');

  const traceId = job.traceId || newTraceId();
  const spanId = newSpanId();
  const timeoutSeconds = Number(job.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS);
  const workspaceRef = path.resolve(job.workspaceRef || rootDir);

  if (!isInsideAllowedPaths(workspaceRef, job.allowedPaths)) {
    throw new Error(`runJob: workspaceRef ${workspaceRef} is outside allowedPaths`);
  }

  const artifactsRoot = artifactsDir(rootDir);
  if (!existsSync(artifactsRoot)) mkdirSync(artifactsRoot, { recursive: true });
  const stdoutPath = path.join(artifactsRoot, `${job.jobId}.stdout.log`);
  const stderrPath = path.join(artifactsRoot, `${job.jobId}.stderr.log`);

  const env = job.envPolicy === 'restricted'
    ? buildRestrictedEnv(job.allowedEnvKeys)
    : { ...process.env };

  emitEvent({
    rootDir,
    eventType: 'worker.started',
    traceId,
    spanId,
    project: job.project,
    taskId: job.taskId,
    metadata: { jobId: job.jobId, command: job.command, timeoutSeconds, workspaceRef },
  });

  const started = Date.now();
  const child = spawnFn(job.command, job.args || [], {
    cwd: workspaceRef,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: typeof job.command === 'string' && (!job.args || job.args.length === 0),
  });

  let stdout = '';
  let stderr = '';
  let timedOut = false;
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 2000).unref();
  }, timeoutSeconds * 1000);

  const exitCode = await new Promise((resolve) => {
    child.once('close', (code) => resolve(code ?? -1));
    child.once('error', () => resolve(-1));
  });
  clearTimeout(timer);

  writeFileSync(stdoutPath, stdout, 'utf8');
  writeFileSync(stderrPath, stderr, 'utf8');

  const durationMs = Date.now() - started;
  const status = timedOut ? 'timeout' : exitCode === 0 ? 'passed' : 'failed';

  const result = {
    jobId: job.jobId,
    taskId: job.taskId || null,
    project: job.project || null,
    status,
    exitCode,
    stdoutPath,
    stderrPath,
    durationMs,
    artifacts: [{ path: stdoutPath, kind: 'stdout' }, { path: stderrPath, kind: 'stderr' }],
    traceId,
    spanId,
  };

  emitEvent({
    rootDir,
    eventType: 'worker.completed',
    traceId,
    spanId,
    project: job.project,
    taskId: job.taskId,
    metadata: { jobId: job.jobId, status, exitCode, durationMs, stdoutPath, stderrPath, timedOut },
  });

  return result;
}
