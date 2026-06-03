/**
 * lib/orchestration/runtime.mjs — Construct-owned local orchestration runtime (Mode-A).
 *
 * The product goal: hosts are front doors, Construct is the system. A
 * host that lacks native multi-agent execution should still reach equivalent
 * Construct outcomes through a Construct-owned runtime rather than depending on
 * whichever editor exposes the strongest teammate mechanics. This module is the
 * Mode-A (zero-dependency, single-process, filesystem-backed) slice of that
 * runtime: it intakes a request, plans/decomposes it into a sequenced specialist
 * chain (reusing the orchestration-policy planner), resolves the execution-
 * capability contract (reusing resolveExecution), persists a durable run + task
 * lifecycle (run-store), and emits lifecycle traces.
 *
 * Honesty boundary (ADR-0020, extending ADR-0019): the Mode-A worker backend is
 * `inline` — it OWNS planning, sequencing, handoff state, persistence, and
 * observability, and PREPARES each specialist task (role, reason, handoff
 * contract) for a downstream executor. It does NOT itself perform specialist LLM
 * reasoning; a provider-backed worker backend is a separate, later backend. The
 * run reports `workerBackend` and per-task `executor` so a host can never mistake
 * a prepared task for executed specialist output. When the execution contract
 * resolves to prompt-only or host-direct, Construct owns no specialist task
 * sequence and the run records that explicitly rather than implying orchestration.
 */

import { randomBytes } from 'node:crypto';

import { routeRequest } from '../orchestration-policy.mjs';
import { resolveExecution } from '../embedded-contract/execution.mjs';
import { detectHostCapabilities } from '../host-capabilities.mjs';
import { newTraceId, newSpanId, emitTraceEvent } from '../worker/trace.mjs';
import { saveRun, loadRun, listRuns } from './run-store.mjs';

export const WORKER_BACKENDS = ['inline'];
export const DEFAULT_WORKER_BACKEND = 'inline';

const RUNTIME_SEMANTICS = 'Mode-A inline backend owns planning, sequencing, handoff state, persistence, and observability, and prepares each specialist task for a downstream executor. It does not perform specialist LLM reasoning itself; tasks reaching status "prepared" are ready for a worker backend or host to execute.';

function newRunId() {
  return `run-${randomBytes(6).toString('hex')}`;
}

function truncate(text, max) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// hostRole reports how the calling host orchestrates, so an adapter can decide
// whether to delegate to Construct's runtime (its reason for being). A direct
// CLI call has no host; an unrecognized host name is reported as unknown rather
// than guessed.

function resolveHostRole(hostName) {
  if (!hostName) return 'cli-direct';
  const match = detectHostCapabilities().find((h) => h.host.toLowerCase() === String(hostName).toLowerCase());
  return match ? match.orchestration : 'unknown';
}

function pickExecution(data) {
  return {
    executionMode: data.executionMode,
    effectiveStrategy: data.effectiveStrategy,
    requestedStrategy: data.requestedStrategy,
    constructCapabilitiesActive: data.constructCapabilitiesActive,
    degraded: data.degraded,
    degradationReason: data.degradationReason,
    selectedProvider: data.selectedProvider,
    selectedModel: data.selectedModel,
    resolutionSource: data.resolutionSource,
    orchestrationPlanned: data.orchestrationPlanned,
    orchestrationAvailable: data.orchestrationAvailable,
    deploymentMode: data.deploymentMode,
  };
}

function buildTasks(route) {
  const reasons = route.dispatchReasons || {};
  const handoffByProducer = new Map();
  for (const edge of route.contractChain || []) {
    const producer = edge.contract?.producer;
    if (producer && !handoffByProducer.has(producer)) handoffByProducer.set(producer, edge.contract.id);
  }
  return (route.specialists || []).map((role, i) => ({
    id: `t${i + 1}`,
    seq: i,
    role,
    reason: reasons[role] || null,
    handoffContract: handoffByProducer.get(role.replace(/^cx-/, '')) || null,
    status: 'queued',
    executor: null,
    startedAt: null,
    finishedAt: null,
  }));
}

/**
 * Plan a run: resolve the execution contract, decompose into a specialist chain,
 * and persist a durable run record (status `planned`). Pure of model calls.
 *
 * @param {object} request
 * @param {object} [opts]   { env, cwd }
 * @returns {object} the persisted run
 */
export function planRun(request = {}, { env = process.env, cwd = process.cwd() } = {}) {
  const {
    request: text = '', workflowType = null, requestedStrategy = 'auto', useConstruct = true,
    host = null, hostModel = null, hostProvider = null, fileCount = 0, moduleCount = 0,
  } = request;

  const execData = resolveExecution(
    { workflowType, requestedStrategy, useConstruct, host, hostModel, hostProvider },
    { env, cwd },
  );
  const route = routeRequest({ request: text, fileCount, moduleCount });

  const traceId = newTraceId();
  const runId = newRunId();
  const now = new Date().toISOString();

  // Construct owns a specialist task sequence only when the contract resolves to
  // orchestrated execution; prompt-only and host-direct own none, and the run
  // records that rather than implying orchestration that did not happen.
  const orchestrates = execData.effectiveStrategy === 'orchestrated';
  const tasks = orchestrates ? buildTasks(route) : [];

  const run = {
    runId,
    traceId,
    createdAt: now,
    updatedAt: now,
    request: { summary: truncate(text, 200), workflowType, requestedStrategy },
    hostRole: resolveHostRole(host),
    workerBackend: DEFAULT_WORKER_BACKEND,
    execution: pickExecution(execData),
    plan: {
      intent: route.intent,
      track: route.track,
      specialists: route.specialists || [],
      dispatchPlan: route.dispatchPlan,
      contractChain: (route.contractChain || []).map((e) => ({ id: e.contract?.id, producer: e.contract?.producer, consumer: e.contract?.consumer, stage: e.stage })),
    },
    tasks,
    status: 'planned',
    warnings: execData.warnings || [],
    semantics: RUNTIME_SEMANTICS,
    executionSemantics: execData.semantics,
  };

  saveRun(cwd, run);
  emitTraceEvent({
    rootDir: cwd, env, traceId, spanId: newSpanId(), eventType: 'task_graph.created',
    metadata: { runId, executionMode: run.execution.executionMode, specialists: run.plan.specialists, workerBackend: run.workerBackend },
  });
  return run;
}

/**
 * Execute a planned run through the inline (Mode-A) worker backend: advance each
 * task queued → running → prepared, persisting after each transition so the run
 * is resumable and observable. The inline backend prepares tasks; it does not
 * perform specialist LLM reasoning.
 *
 * @param {string} cwd
 * @param {string} runId
 * @param {object} [opts]   { env }
 * @returns {object} the completed run
 */
export function executeRun(cwd, runId, { env = process.env } = {}) {
  const run = loadRun(cwd, runId);
  if (!run) {
    const err = new Error(`Orchestration run not found: ${runId}`);
    err.code = 'RUN_NOT_FOUND';
    throw err;
  }

  run.status = 'running';
  run.updatedAt = new Date().toISOString();
  saveRun(cwd, run);

  for (const task of run.tasks) {
    task.status = 'running';
    task.startedAt = new Date().toISOString();
    emitTraceEvent({ rootDir: cwd, env, traceId: run.traceId, spanId: newSpanId(), eventType: 'worker.started', role: task.role, taskId: task.id, metadata: { runId } });

    task.executor = 'inline:prepared';
    task.status = 'prepared';
    task.finishedAt = new Date().toISOString();
    emitTraceEvent({ rootDir: cwd, env, traceId: run.traceId, spanId: newSpanId(), eventType: 'worker.completed', role: task.role, taskId: task.id, metadata: { runId, status: 'prepared' } });

    run.updatedAt = new Date().toISOString();
    saveRun(cwd, run);
  }

  run.status = 'completed';
  run.updatedAt = new Date().toISOString();
  saveRun(cwd, run);
  emitTraceEvent({ rootDir: cwd, env, traceId: run.traceId, spanId: newSpanId(), eventType: 'lifecycle.completed', metadata: { runId, status: run.status, tasks: run.tasks.length } });
  return run;
}

/**
 * Plan and execute in one call (the common `orchestrate run` path).
 */
export function runOrchestration(request = {}, { env = process.env, cwd = process.cwd() } = {}) {
  const planned = planRun(request, { env, cwd });
  return executeRun(cwd, planned.runId, { env });
}

/**
 * The structured metadata a host adapter consumes for runtime-backed integration.
 */
export function hostAdapterMetadata(run) {
  const e = run.execution || {};
  return {
    runId: run.runId,
    traceId: run.traceId,
    status: run.status,
    requestedStrategy: e.requestedStrategy,
    effectiveStrategy: e.effectiveStrategy,
    executionMode: e.executionMode,
    constructCapabilitiesActive: e.constructCapabilitiesActive,
    workerBackend: run.workerBackend,
    hostRole: run.hostRole,
    degraded: e.degraded,
    degradationReason: e.degradationReason,
    selectedProvider: e.selectedProvider,
    selectedModel: e.selectedModel,
    tasks: (run.tasks || []).map((t) => ({ id: t.id, role: t.role, status: t.status, executor: t.executor })),
    warnings: run.warnings || [],
    semantics: run.semantics,
    executionSemantics: run.executionSemantics,
  };
}

export function getRun(cwd, runId) {
  return loadRun(cwd, runId);
}

export function getRuns(cwd, opts) {
  return listRuns(cwd, opts);
}
