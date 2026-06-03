/**
 * lib/orchestration/runtime.mjs — Construct-owned local orchestration runtime.
 *
 * The product goal: hosts are front doors, Construct is the system. A
 * host that lacks native multi-agent execution should still reach equivalent
 * Construct outcomes through a Construct-owned runtime rather than depending on
 * whichever editor exposes the strongest teammate mechanics. This module intakes
 * a request, plans/decomposes it into a sequenced specialist chain (reusing the
 * orchestration-policy planner), resolves the execution-capability contract
 * (reusing resolveExecution), persists a durable run + task lifecycle through a
 * pluggable run store (filesystem default, sqlite Mode-B, postgres Mode-C), and
 * emits lifecycle traces.
 *
 * Worker backends (ADR-0020, ADR-0021):
 *   - `inline` (default): OWNS planning, sequencing, handoff state, persistence,
 *     and observability, and PREPARES each specialist task for a downstream
 *     executor. It does NOT itself perform specialist LLM reasoning. Tasks reach
 *     status `prepared`; the prepare-only disclaimer applies.
 *   - `provider`: EXECUTES each specialist task by calling the configured
 *     provider/model with the specialist persona prompt. Tasks reach status
 *     `done` carrying real model output; the prepare-only disclaimer does NOT
 *     apply to provider-executed tasks. A failing task is recorded (status
 *     `failed`) and the run completes `completed-with-failures` rather than
 *     crashing.
 *
 * The run reports `workerBackend` and per-task `executor` so a host can never
 * mistake a prepared task for executed specialist output. When the execution
 * contract resolves to prompt-only or host-direct, Construct owns no specialist
 * task sequence and the run records that explicitly.
 */

import { randomBytes } from 'node:crypto';

import { routeRequest } from '../orchestration-policy.mjs';
import { resolveExecution } from '../embedded-contract/execution.mjs';
import { detectHostCapabilities } from '../host-capabilities.mjs';
import { loadProjectConfig } from '../config/project-config.mjs';
import { newTraceId, newSpanId, emitTraceEvent } from '../worker/trace.mjs';
import { resolveRunStore } from './store.mjs';
import { runTaskViaProvider, INLINE, PROVIDER, WORKER_BACKEND_SET } from './worker.mjs';

export const WORKER_BACKENDS = WORKER_BACKEND_SET;
export const DEFAULT_WORKER_BACKEND = INLINE;

const RUNTIME_SEMANTICS = 'The inline worker backend owns planning, sequencing, handoff state, persistence, and observability, and prepares each specialist task for a downstream executor. It does not perform specialist LLM reasoning itself; tasks reaching status "prepared" are ready for a worker backend or host to execute. The provider worker backend executes specialist reasoning via the configured model and records real output as task.output.';

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
    output: null,
    error: null,
    startedAt: null,
    finishedAt: null,
  }));
}

// The worker backend is a deployment concern: an explicit option wins, then the
// run's recorded backend, then config (orchestration.workerBackend), then the
// inline default. An unknown value falls back to inline rather than guessing.

function resolveWorkerBackend({ explicit, run, config }) {
  const candidate = explicit || run?.workerBackend || config?.orchestration?.workerBackend || DEFAULT_WORKER_BACKEND;
  return WORKER_BACKENDS.includes(candidate) ? candidate : DEFAULT_WORKER_BACKEND;
}

function loadConfig(cwd, env) {
  try {
    return loadProjectConfig(cwd, env).config || {};
  } catch {
    return {};
  }
}

/**
 * Plan a run: resolve the execution contract, decompose into a specialist chain,
 * and persist a durable run record (status `planned`). Pure of model calls.
 *
 * @param {object} request
 * @param {object} [opts]   { env, cwd }
 * @returns {Promise<object>} the persisted run
 */
export async function planRun(request = {}, { env = process.env, cwd = process.cwd() } = {}) {
  const {
    request: text = '', workflowType = null, requestedStrategy = 'auto', useConstruct = true,
    host = null, hostModel = null, hostProvider = null, fileCount = 0, moduleCount = 0,
  } = request;

  const config = loadConfig(cwd, env);
  const { store, warnings: storeWarnings } = resolveRunStore({ config, env, cwd });

  const execData = resolveExecution(
    { workflowType, requestedStrategy, useConstruct, host, hostModel, hostProvider },
    { env, cwd },
  );
  const route = routeRequest({ request: text, fileCount, moduleCount });

  const traceId = newTraceId();
  const runId = newRunId();
  const now = new Date().toISOString();
  const workerBackend = resolveWorkerBackend({ config });

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
    workerBackend,
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
    warnings: [...(execData.warnings || []), ...storeWarnings],
    semantics: RUNTIME_SEMANTICS,
    executionSemantics: execData.semantics,
  };

  await store.saveRun(run);
  emitTraceEvent({
    rootDir: cwd, env, traceId, spanId: newSpanId(), eventType: 'task_graph.created',
    metadata: { runId, executionMode: run.execution.executionMode, specialists: run.plan.specialists, workerBackend: run.workerBackend },
  });
  return run;
}

// The inline backend prepares one task: queued → running → prepared, no model
// reasoning. The boundary ADR-0020 makes explicit.

function prepareTaskInline(task) {
  task.executor = 'inline:prepared';
  task.status = 'prepared';
  task.finishedAt = new Date().toISOString();
}

// The provider backend executes one task against the configured model. A failed
// task is recorded (status `failed`, task.error) and does not abort the run, so
// one specialist failure cannot lose the work of the others.

async function executeTaskViaProvider(task, run, env, fetchImpl) {
  try {
    const result = await runTaskViaProvider({
      task, run,
      model: run.execution?.selectedModel,
      provider: run.execution?.selectedProvider,
      env, fetchImpl,
    });
    task.output = result.output;
    task.executor = `provider:${result.provider}:${result.model}`;
    task.status = 'done';
    task.finishedAt = new Date().toISOString();
    return true;
  } catch (err) {
    task.executor = `provider:error`;
    task.error = { code: err.code || 'PROVIDER_EXECUTION_FAILED', message: err.message };
    task.status = 'failed';
    task.finishedAt = new Date().toISOString();
    return false;
  }
}

/**
 * Execute a planned run through the chosen worker backend, persisting after each
 * task transition so the run is resumable and observable.
 *
 * @param {string} cwd
 * @param {string} runId
 * @param {object} [opts]   { env, workerBackend, fetchImpl }
 * @returns {Promise<object>} the completed run
 */
export async function executeRun(cwd, runId, { env = process.env, workerBackend = null, fetchImpl } = {}) {
  const config = loadConfig(cwd, env);
  const { store } = resolveRunStore({ config, env, cwd });
  const run = await store.loadRun(runId);
  if (!run) {
    const err = new Error(`Orchestration run not found: ${runId}`);
    err.code = 'RUN_NOT_FOUND';
    throw err;
  }

  const backend = resolveWorkerBackend({ explicit: workerBackend, run, config });
  run.workerBackend = backend;
  run.status = 'running';
  run.updatedAt = new Date().toISOString();
  await store.saveRun(run);

  let anyFailed = false;
  for (const task of run.tasks) {
    task.status = 'running';
    task.startedAt = new Date().toISOString();
    emitTraceEvent({ rootDir: cwd, env, traceId: run.traceId, spanId: newSpanId(), eventType: 'worker.started', role: task.role, taskId: task.id, metadata: { runId, workerBackend: backend } });

    if (backend === PROVIDER) {
      const ok = await executeTaskViaProvider(task, run, env, fetchImpl);
      if (!ok) anyFailed = true;
    } else {
      prepareTaskInline(task);
    }

    emitTraceEvent({ rootDir: cwd, env, traceId: run.traceId, spanId: newSpanId(), eventType: 'worker.completed', role: task.role, taskId: task.id, metadata: { runId, status: task.status } });
    run.updatedAt = new Date().toISOString();
    await store.saveRun(run);
  }

  run.status = anyFailed ? 'completed-with-failures' : 'completed';
  run.updatedAt = new Date().toISOString();
  await store.saveRun(run);
  emitTraceEvent({ rootDir: cwd, env, traceId: run.traceId, spanId: newSpanId(), eventType: 'lifecycle.completed', metadata: { runId, status: run.status, tasks: run.tasks.length } });
  return run;
}

/**
 * Plan and execute in one call (the common `orchestrate run` path).
 */
export async function runOrchestration(request = {}, { env = process.env, cwd = process.cwd(), workerBackend = null, fetchImpl } = {}) {
  const planned = await planRun(request, { env, cwd });
  return executeRun(cwd, planned.runId, { env, workerBackend, fetchImpl });
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

export async function getRun(cwd, runId, { env = process.env } = {}) {
  const config = loadConfig(cwd, env);
  const { store } = resolveRunStore({ config, env, cwd });
  return store.loadRun(runId);
}

export async function getRuns(cwd, { env = process.env, ...opts } = {}) {
  const config = loadConfig(cwd, env);
  const { store } = resolveRunStore({ config, env, cwd });
  return store.listRuns(opts);
}
