#!/usr/bin/env node
/**
 * lib/worker/entrypoint.mjs — long-running worker loop for team / enterprise mode.
 *
 * Claims pending intake items from the Postgres-backed queue and runs them
 * through `runJob`, attaching evidence to the originating task graph node.
 * Exits when the queue stays empty for `--idle-timeout-seconds` (default
 * 300s) so a Kubernetes / nomad scheduler can scale workers to zero.
 *
 * The container's path policy is the workspace mount: `runJob` enforces
 * `allowedPaths: [workspace]` so the worker can only touch the
 * bind-mounted project tree even if a malicious command tries `..`.
 *
 * Invocation (inside the image):
 *   node lib/worker/entrypoint.mjs \
 *     --project=<project-name> \
 *     --workspace=/work \
 *     --idle-timeout-seconds=300 \
 *     --poll-interval-ms=2000
 *
 * Env: DATABASE_URL must be set. The container reads it from the platform
 * (compose / k8s secret); the entrypoint does not source ~/.construct/config.env.
 */

import path from 'node:path';

import { createSqlClient, closeSqlClient } from '../storage/backend.mjs';
import { PostgresIntakeQueue } from '../intake/postgres-queue.mjs';
import { FilesystemTaskGraphStore } from '../task-graph/store.mjs';
import { runJob } from './run.mjs';
import { evidenceFromJobResult, recordEvidence, blockedPacket } from './evidence.mjs';
import { emitTraceEvent, newTraceId } from './trace.mjs';

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_IDLE_TIMEOUT_SECONDS = 300;
const DEFAULT_TIMEOUT_SECONDS = 300;

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m) continue;
    out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

function readWorkerName() {
  return process.env.HOSTNAME || `worker-${process.pid}`;
}

function logEvent(rootDir, eventType, fields = {}) {
  try {
    emitTraceEvent({
      rootDir,
      eventType,
      ...fields,
    });
  } catch { /* observability never breaks the worker loop */ }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Map an intake packet to a worker job. The packet's triage names the
 * recommendedAction; we read the project's verification requirements
 * from the task graph (if one was auto-generated) or fall back to a
 * conservative `node --version` smoke command so the worker always
 * has something to execute against and the queue drains.
 */
function jobFromPacket(packet, { workspace, defaultCommand }) {
  const command = packet?.workerCommand || defaultCommand;
  return {
    jobId: `${packet.id}-${Date.now()}`,
    taskId: packet.id,
    project: packet.intake?.project || null,
    workspaceRef: workspace,
    command,
    args: [],
    timeoutSeconds: packet?.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS,
    envPolicy: 'restricted',
    allowedPaths: [workspace],
  };
}

/**
 * Process one claimed packet end-to-end: run the command, record evidence
 * if a graph node is named in the packet, mark the queue item processed
 * or blocked. Returns true on success, false on failure (which surfaces
 * a blocked packet for human review).
 */
async function processClaim({ packet, queue, store, rootDir, workspace, defaultCommand, workerName }) {
  const traceId = packet?.traceId || newTraceId();
  const job = jobFromPacket(packet, { workspace, defaultCommand });

  let result;
  try {
    result = await runJob({
      rootDir,
      job: { ...job, traceId },
    });
  } catch (err) {
    logEvent(rootDir, 'worker.completed', {
      traceId,
      project: job.project,
      taskId: job.taskId,
      metadata: { status: 'errored', error: err?.message || String(err) },
    });
    await queue.markSkipped(packet.id, {
      skippedBy: workerName,
      reason: `worker exec error: ${err?.message || String(err)}`,
    });
    return false;
  }

  // If the packet carries graphId + nodeId, attach evidence to that node.
  if (packet?.graphId && packet?.nodeId) {
    try {
      const evidence = evidenceFromJobResult(result, {
        evidenceType: packet.evidenceType || 'test-result',
      });
      recordEvidence({
        store,
        graphId: packet.graphId,
        nodeId: packet.nodeId,
        evidence,
        rootDir,
      });
    } catch { /* evidence write best-effort */ }
  }

  if (result.status === 'passed') {
    await queue.markProcessed(packet.id, {
      processedBy: workerName,
      notes: `passed in ${result.durationMs}ms`,
    });
    return true;
  }

  // Failure path: surface as a blocked packet with attempted steps so the
  // main agent can pick it up and decide next.
  const reason = result.status === 'timeout'
    ? `command timed out after ${packet?.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS}s`
    : `command failed with exit code ${result.exitCode}`;
  const attempted = [job.command];
  const blocked = blockedPacket({ taskId: packet.id, reason, attempted });
  await queue.markSkipped(packet.id, {
    skippedBy: workerName,
    reason: `${reason}; stdout=${result.stdoutPath}; stderr=${result.stderrPath}`,
  });
  logEvent(rootDir, 'worker.completed', {
    traceId,
    project: job.project,
    taskId: job.taskId,
    metadata: { status: result.status, exitCode: result.exitCode, blocked, durationMs: result.durationMs },
  });
  return false;
}

/**
 * Long-running worker loop. Resolves with the run statistics when the
 * idle timeout elapses or when `stopAfter` jobs have completed (test mode).
 */
export async function runWorkerLoop({
  rootDir,
  workspace,
  project,
  sql,
  queue: injectedQueue = null,
  store: injectedStore = null,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  idleTimeoutSeconds = DEFAULT_IDLE_TIMEOUT_SECONDS,
  defaultCommand = 'node --version',
  stopAfter = null,
  now = Date.now,
} = {}) {
  if (!project) throw new Error('runWorkerLoop: project is required');
  if (!workspace) throw new Error('runWorkerLoop: workspace is required');
  if (!injectedQueue && !sql) throw new Error('runWorkerLoop: sql client (or injected queue) is required');

  const workerName = readWorkerName();
  const queue = injectedQueue || new PostgresIntakeQueue({ sql, project });
  const store = injectedStore || new FilesystemTaskGraphStore(rootDir);

  let processed = 0;
  let skipped = 0;
  let idleSince = now();

  while (true) {
    const claimed = await queue.claim({ claimedBy: workerName });
    if (claimed) {
      const ok = await processClaim({
        packet: claimed,
        queue,
        store,
        rootDir,
        workspace,
        defaultCommand,
        workerName,
      });
      if (ok) processed += 1; else skipped += 1;
      idleSince = now();
      if (stopAfter && (processed + skipped) >= stopAfter) break;
      continue;
    }

    if ((now() - idleSince) >= idleTimeoutSeconds * 1000) break;
    await sleep(pollIntervalMs);
  }

  return { processed, skipped, workerName };
}

// CLI entrypoint when invoked directly (the Dockerfile.worker CMD).
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  const args = parseArgs(process.argv);
  const workspace = args.workspace || process.env.CONSTRUCT_WORKSPACE || process.cwd();
  const rootDir = args['root-dir'] || workspace;
  const project = args.project || process.env.CONSTRUCT_PROJECT_NAME || path.basename(path.resolve(workspace));
  const pollIntervalMs = Number(args['poll-interval-ms'] || DEFAULT_POLL_INTERVAL_MS);
  const idleTimeoutSeconds = Number(args['idle-timeout-seconds'] || DEFAULT_IDLE_TIMEOUT_SECONDS);

  const sql = createSqlClient(process.env);
  if (!sql) {
    process.stderr.write('[worker] DATABASE_URL is required for the worker entrypoint.\n');
    process.exit(78); // EX_CONFIG
  }

  try {
    const summary = await runWorkerLoop({
      rootDir, workspace, project, sql, pollIntervalMs, idleTimeoutSeconds,
    });
    process.stdout.write(`[worker] exiting after idle timeout — processed=${summary.processed} skipped=${summary.skipped} worker=${summary.workerName}\n`);
    process.exit(0);
  } finally {
    await closeSqlClient(sql);
  }
}
