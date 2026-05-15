/**
 * lib/worker/evidence.mjs — record verified evidence onto task graph nodes.
 *
 * Evidence is the contract that lets a node move from in-progress → done.
 * The worker plane emits one evidence record per executed job; the
 * higher-level dispatcher refuses to mark a node done without at least
 * one evidence entry. BLOCKED and NEEDS_MAIN_INPUT statuses carry their
 * own dedicated schemas: BLOCKED requires `attempted` steps; NEEDS_MAIN_INPUT
 * requires `question`, `safeDefault`, and `context` fields.
 *
 * Evidence record shape:
 *   {
 *     taskId, evidenceType, command?, status, summary,
 *     artifacts?, traceId?, createdAt
 *   }
 */

import { emitTraceEvent } from './trace.mjs';

export const EVIDENCE_TYPES = [
  'test-result',
  'lint-result',
  'build-result',
  'retrieval-eval',
  'manual-verification',
  'source-citation',
  'trace-link',
  'sample-output',
];

function buildSummary(jobResult) {
  if (!jobResult) return '';
  const head = `${jobResult.status} · exit ${jobResult.exitCode} · ${jobResult.durationMs}ms`;
  return head;
}

export function evidenceFromJobResult(jobResult, { evidenceType = 'test-result', summary } = {}) {
  if (!jobResult?.taskId) throw new Error('evidenceFromJobResult: jobResult.taskId is required');
  return {
    taskId: jobResult.taskId,
    evidenceType,
    command: jobResult.command || null,
    status: jobResult.status,
    summary: summary || buildSummary(jobResult),
    artifacts: jobResult.artifacts || [],
    traceId: jobResult.traceId || null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Append an evidence record to a task graph node and emit the matching
 * trace event. Returns the updated node.
 */
export function recordEvidence({ store, graphId, nodeId, evidence, rootDir, emitEvent = emitTraceEvent }) {
  if (!store) throw new Error('recordEvidence: store is required');
  if (!graphId || !nodeId) throw new Error('recordEvidence: graphId and nodeId are required');
  if (!evidence) throw new Error('recordEvidence: evidence is required');

  const node = store.updateNodeStatus(graphId, nodeId, undefined, { addEvidence: evidence });

  if (rootDir) {
    emitEvent({
      rootDir,
      eventType: 'evidence.recorded',
      traceId: evidence.traceId || undefined,
      project: node.project,
      taskId: nodeId,
      metadata: {
        evidenceType: evidence.evidenceType,
        status: evidence.status,
        summary: evidence.summary,
      },
    });
  }
  return node;
}

export function blockedPacket({ taskId, attempted = [], reason }) {
  if (!taskId) throw new Error('blockedPacket: taskId is required');
  if (!reason) throw new Error('blockedPacket: reason is required');
  if (!Array.isArray(attempted) || attempted.length === 0) {
    throw new Error('blockedPacket: at least one attempted step is required');
  }
  return {
    taskId,
    status: 'blocked',
    reason,
    attempted,
    createdAt: new Date().toISOString(),
  };
}

export function needsInputPacket({ taskId, question, safeDefault, context }) {
  if (!taskId) throw new Error('needsInputPacket: taskId is required');
  if (!question) throw new Error('needsInputPacket: question is required');
  if (safeDefault === undefined) throw new Error('needsInputPacket: safeDefault is required (use null if none)');
  if (!context) throw new Error('needsInputPacket: context is required');
  return {
    taskId,
    status: 'needs-input',
    question,
    safeDefault,
    context,
    createdAt: new Date().toISOString(),
  };
}
