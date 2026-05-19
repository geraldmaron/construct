/**
 * lib/worker/trace.mjs — append-only trace event log for worker + intake flow.
 *
 * Trace events tie an intake packet → task graph → role dispatch → worker
 * job → evidence record together via traceId + spanId. Events land in two
 * places concurrently:
 *
 *   1. `.cx/traces/<YYYY-MM-DD>.jsonl` — append-only local JSONL. Always on,
 *      no credentials required. Tail live, archive, or replay.
 *   2. Langfuse — fire-and-forget batched ingest when LANGFUSE_PUBLIC_KEY +
 *      LANGFUSE_SECRET_KEY are configured and CONSTRUCT_TRACE_BACKEND is
 *      either unset (default langfuse) or `langfuse`. Each unique traceId
 *      triggers one trace-create plus an event-create per emitted event.
 *      Failures never throw — observability must not break the caller.
 *
 * Event types in current use:
 *   intake.received        — daemon ingested a file
 *   intake.triaged         — classifyRdIntake produced a triage block
 *   task_graph.created     — graph derived from triage
 *   role.dispatched        — context router selected a persona
 *   tool.called            — agent invoked a tool
 *   worker.started         — worker began executing a command
 *   worker.completed       — worker finished (status: passed | failed | timeout)
 *   evidence.recorded      — evidence appended to a task graph node
 *   approval.requested     — high-risk action blocked on approval
 *   approval.resolved      — approval granted or denied
 *   memory.written         — durable memory record persisted
 */

import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { createIngestClient } from '../telemetry/langfuse-ingest.mjs';

const TRACE_SUBDIR = '.cx/traces';

export const TRACE_EVENT_TYPES = [
  'daemon.started',
  'daemon.heartbeat',
  'daemon.stopped',
  'lifecycle.completed',
  'intake.received',
  'intake.triaged',
  'task_graph.created',
  'role.dispatched',
  'tool.called',
  'worker.started',
  'worker.completed',
  'evidence.recorded',
  'approval.requested',
  'approval.resolved',
  'memory.written',
];

export function traceDir(rootDir) {
  return path.join(rootDir, TRACE_SUBDIR);
}

function todayShard() {
  return new Date().toISOString().slice(0, 10);
}

export function newTraceId() {
  return `trace-${randomBytes(8).toString('hex')}`;
}

export function newSpanId() {
  return `span-${randomBytes(6).toString('hex')}`;
}

// Reused per-process. The ingest client batches; recreating it would lose
// the queue. `available` flips false when keys aren't set, which is the
// graceful no-op path for solo-mode users without Langfuse configured.
let langfuseClient = null;
const seenTraces = new Set();

function getLangfuseClient(env = process.env) {
  if (langfuseClient !== null) return langfuseClient;
  const backend = (env.CONSTRUCT_TRACE_BACKEND || 'langfuse').toLowerCase();
  if (backend === 'none' || backend === 'off') {
    langfuseClient = { available: false, trace: () => {}, event: () => {} };
    return langfuseClient;
  }
  langfuseClient = createIngestClient({
    baseUrl: (env.LANGFUSE_BASEURL ?? 'https://cloud.langfuse.com').replace(/\/$/, ''),
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
  });
  return langfuseClient;
}

/**
 * Internal: reset the cached Langfuse client. Test-only.
 */
export function _resetLangfuseClient() {
  langfuseClient = null;
  seenTraces.clear();
}

function exportToLangfuse(event, env) {
  const client = getLangfuseClient(env);
  if (!client.available) return;

  // First time we see a traceId, register the trace so subsequent events
  // attach to a known parent.
  if (event.traceId && !seenTraces.has(event.traceId)) {
    seenTraces.add(event.traceId);
    try {
      client.trace({
        id: event.traceId,
        name: event.eventType,
        metadata: {
          project: event.project || undefined,
          role: event.role || undefined,
          taskId: event.taskId || undefined,
          intakeId: event.intakeId || undefined,
        },
        timestamp: event.createdAt,
      });
    } catch { /* observability must not break the caller */ }
  }

  try {
    client.event({
      id: event.spanId,
      traceId: event.traceId,
      parentObservationId: event.parentSpanId || undefined,
      name: event.eventType,
      metadata: event.metadata,
      input: undefined,
      output: undefined,
      startTime: event.createdAt,
    });
  } catch { /* swallow */ }
}

export function emitTraceEvent({
  rootDir,
  eventType,
  traceId,
  spanId,
  parentSpanId = null,
  project = null,
  role = null,
  taskId = null,
  intakeId = null,
  metadata = {},
  env = process.env,
}) {
  if (!rootDir) throw new Error('emitTraceEvent: rootDir is required');
  if (!eventType) throw new Error('emitTraceEvent: eventType is required');
  if (!TRACE_EVENT_TYPES.includes(eventType)) {
    throw new Error(`emitTraceEvent: unknown eventType ${eventType}`);
  }

  const dir = traceDir(rootDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const event = {
    traceId: traceId || newTraceId(),
    spanId: spanId || newSpanId(),
    parentSpanId,
    eventType,
    project,
    role,
    taskId,
    intakeId,
    metadata,
    createdAt: new Date().toISOString(),
  };
  appendFileSync(path.join(dir, `${todayShard()}.jsonl`), `${JSON.stringify(event)}\n`, 'utf8');

  // Fire-and-forget export to Langfuse. Silent no-op when not configured.
  exportToLangfuse(event, env);
  return event;
}
