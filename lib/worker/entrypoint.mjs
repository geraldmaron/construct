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
 * Per ADR-0089: while a claimed job's runJob() call is in flight,
 * processClaim() periodically renews the queue's execution lease via
 * `queue.heartbeat()`, and on an exec-time exception releases the claim via
 * `queue.fail()` for retry/dead-letter instead of a permanent skip. Both are
 * guarded on the queue backend actually implementing them (Postgres);
 * FilesystemIntakeQueue (solo mode) has neither and is unaffected.
 *
 * Invocation (inside the image):
 *   node lib/worker/entrypoint.mjs \
 *     --project=<project-name> \
 *     --workspace=/work \
 *     --idle-timeout-seconds=300 \
 *     --poll-interval-ms=2000 \
 *     --heartbeat-interval-ms=60000
 *
 * Env: DATABASE_URL must be set. The container reads it from the platform
 * (compose / k8s secret); the entrypoint does not source ~/.construct/config.env.
 */

import path from 'node:path';

import { createIntakeQueue } from '../intake/queue.mjs';
import { FilesystemTaskGraphStore } from '../task-graph/store.mjs';
import { runJob } from './run.mjs';
import { evidenceFromJobResult, recordEvidence, blockedPacket } from './evidence.mjs';
import { emitTraceEvent, newTraceId } from './trace.mjs';
import { isMainModule } from '../roots.mjs';

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_IDLE_TIMEOUT_SECONDS = 300;

// DEFAULT_TIMEOUT_SECONDS (job-level, lib/worker/run.mjs enforces its own
// copy) and a lease-backed queue's own default lease window are, per
// ADR-0089 point 4, only a floor a claim must survive before the heartbeat
// loop below fires its first renewal — not the operative execution limit.
// A heartbeating job's lease is renewed on a fixed cadence and stops
// expiring purely from running longer than either static default; expiry
// then only follows a worker legitimately failing to renew (crash, kill,
// DB partition).
const DEFAULT_TIMEOUT_SECONDS = 300;

// Mirrors PG_QUEUE_DEFAULT_LEASE_SECONDS (lib/queue/pg-queue.mjs) — used
// only as a fallback when a heartbeat-capable queue does not expose its own
// leaseSeconds. Heartbeats fire at half the lease window so at least one
// renewal lands before the lease could expire under normal jitter.
const FALLBACK_LEASE_SECONDS = 120;
const HEARTBEAT_FRACTION = 0.5;

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

// Thrown when runWorkerLoop's queue has no claim(). The loop (and its
// heartbeat/fail wiring above) is built against PostgresIntakeQueue's lease
// contract (lib/queue/pg-queue.mjs) for team/enterprise mode; solo mode's
// FilesystemIntakeQueue (lib/intake/filesystem-queue.mjs) implements only
// enqueue/listPending/read/markProcessed/markSkipped/reopen/count by design —
// solo mode is single-process, so it never needs concurrent-claim leasing.
// createIntakeQueue(rootDir, env) resolves filesystem in solo mode (see
// lib/intake/queue.mjs#resolveBackend), so a solo-mode project pointed at
// this entrypoint (or CONSTRUCT_INTAKE_QUEUE_BACKEND=filesystem forced under
// team mode) reaches this loop with a queue that cannot claim. Fail with an
// actionable message instead of the raw "queue.claim is not a function"
// TypeError a few lines below.

export class QueueClaimUnsupportedError extends Error {
  constructor(queue) {
    const backend = queue?.backend || queue?.constructor?.name || 'unknown';
    super(
      `runWorkerLoop: queue backend '${backend}' does not implement claim() — the worker loop ` +
      `requires a lease-capable queue (Postgres, team/enterprise mode). Solo mode's filesystem-backed ` +
      `intake queue has no concurrent-claim semantics by design; do not point the worker entrypoint at ` +
      `a solo-mode project. Set CONSTRUCT_INTAKE_QUEUE_BACKEND=postgres (or run in team/enterprise mode) ` +
      `and configure DATABASE_URL / CONSTRUCT_DATABASE_URL instead.`,
    );
    this.name = 'QueueClaimUnsupportedError';
    this.backend = backend;
  }
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
 * Start a periodic queue.heartbeat() renewal for a claimed packet, active
 * only while the caller's runJob() is in flight. Guarded on
 * `typeof queue.heartbeat === 'function'` (ADR-0089 scope) so backends that
 * do not implement the lease/heartbeat contract — FilesystemIntakeQueue in
 * solo mode — are untouched; those queues need no dummy method. Returns a
 * stop function; a heartbeat failure is logged, never thrown, so a
 * transient renewal miss cannot itself abort the in-flight job.
 */
function startHeartbeatLoop({ queue, packetId, workerName, rootDir, traceId, taskId, heartbeatIntervalMs }) {
  if (typeof queue.heartbeat !== 'function') return () => {};

  const leaseSeconds = Number(queue.leaseSeconds) || FALLBACK_LEASE_SECONDS;
  const intervalMs = heartbeatIntervalMs ?? Math.max(1000, Math.floor(leaseSeconds * 1000 * HEARTBEAT_FRACTION));
  const timer = setInterval(() => {
    queue.heartbeat(packetId, { workerId: workerName }).catch((err) => {
      logEvent(rootDir, 'worker.heartbeat_failed', {
        traceId,
        taskId,
        metadata: { error: err?.message || String(err) },
      });
    });
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}

/**
 * Process one claimed packet end-to-end: run the command, record evidence
 * if a graph node is named in the packet, mark the queue item processed
 * or blocked. Returns true on success, false on failure (which surfaces
 * a blocked packet for human review).
 */
async function processClaim({ packet, queue, store, rootDir, workspace, defaultCommand, workerName, heartbeatIntervalMs }) {
  const traceId = packet?.traceId || newTraceId();
  const job = jobFromPacket(packet, { workspace, defaultCommand });

  const stopHeartbeat = startHeartbeatLoop({
    queue, packetId: packet.id, workerName, rootDir, traceId, taskId: job.taskId, heartbeatIntervalMs,
  });

  let result;
  try {
    result = await runJob({
      rootDir,
      job: { ...job, traceId },
    });
  } catch (err) {
    stopHeartbeat();
    logEvent(rootDir, 'worker.completed', {
      traceId,
      project: job.project,
      taskId: job.taskId,
      metadata: { status: 'errored', error: err?.message || String(err) },
    });
    const reason = `worker exec error: ${err?.message || String(err)}`;
    // fail() releases the claim for retry (or dead-letters past
    // max_attempts) instead of markSkipped()'s permanent skip — an exec-time
    // exception is the "worker legitimately cannot proceed" case ADR-0089
    // models as retryable, not terminal. markSkipped stays the fallback for
    // queues without fail() (FilesystemIntakeQueue, solo mode).
    if (typeof queue.fail === 'function') {
      await queue.fail(packet.id, { workerId: workerName, reason });
    } else {
      await queue.markSkipped(packet.id, { skippedBy: workerName, reason });
    }
    return false;
  }
  stopHeartbeat();

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
  queue: injectedQueue = null,
  store: injectedStore = null,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  idleTimeoutSeconds = DEFAULT_IDLE_TIMEOUT_SECONDS,
  defaultCommand = 'node --version',
  stopAfter = null,
  now = Date.now,
  heartbeatIntervalMs = null,
} = {}) {
  if (!project) throw new Error('runWorkerLoop: project is required');
  if (!workspace) throw new Error('runWorkerLoop: workspace is required');

  const workerName = readWorkerName();
  const queue = injectedQueue || createIntakeQueue(rootDir, process.env, { project });
  const store = injectedStore || new FilesystemTaskGraphStore(rootDir);

  if (typeof queue.claim !== 'function') throw new QueueClaimUnsupportedError(queue);

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
        heartbeatIntervalMs,
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
const invokedDirectly = isMainModule(import.meta.url);
if (invokedDirectly) {
  const args = parseArgs(process.argv);
  const workspace = args.workspace || process.env.CONSTRUCT_WORKSPACE || process.cwd();
  const rootDir = args['root-dir'] || workspace;
  const project = args.project || process.env.CONSTRUCT_PROJECT_NAME || path.basename(path.resolve(workspace));
  const pollIntervalMs = Number(args['poll-interval-ms'] || DEFAULT_POLL_INTERVAL_MS);
  const idleTimeoutSeconds = Number(args['idle-timeout-seconds'] || DEFAULT_IDLE_TIMEOUT_SECONDS);
  const heartbeatIntervalMs = args['heartbeat-interval-ms'] ? Number(args['heartbeat-interval-ms']) : null;

  try {
    const summary = await runWorkerLoop({
      rootDir, workspace, project, pollIntervalMs, idleTimeoutSeconds, heartbeatIntervalMs,
    });
    process.stdout.write(`[worker] exiting after idle timeout — processed=${summary.processed} skipped=${summary.skipped} worker=${summary.workerName}\n`);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[worker] failed: ${err.stack}\n`);
    process.exit(1);
  }
}
