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
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { routeRequest } from '../orchestration-policy.mjs';
import { resolveExecution } from '../embedded-contract/execution.mjs';
import { detectHostCapabilities } from '../host-capabilities.mjs';
import { loadProjectConfig } from '../config/project-config.mjs';
import { CHAIN_OF_THOUGHT_MODES } from '../config/schema.mjs';
import { newTraceId, newSpanId, emitTraceEvent } from '../worker/trace.mjs';
import { resolveRunStore } from './store.mjs';
import { runTaskViaProvider, INLINE, PROVIDER, WORKER_BACKEND_SET } from './worker.mjs';
import { roleHoldsWebCapability } from './web-capability.mjs';
import { emitRunEvent, isCancelRequested, clearCancel } from './events.mjs';

export const WORKER_BACKENDS = WORKER_BACKEND_SET;
export const DEFAULT_WORKER_BACKEND = INLINE;
export const CHAIN_OF_THOUGHT = CHAIN_OF_THOUGHT_MODES;
export const DEFAULT_CHAIN_OF_THOUGHT = 'hidden';

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
    reasoning: null,
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

// Chain-of-thought disclosure is a deployment concern (ADR-0030): an explicit
// option wins, then the run's recorded mode, then config
// (orchestration.chainOfThought), then the hidden default. An unknown value
// falls back to hidden — specialist reasoning is never surfaced by guess.

function resolveChainOfThought({ explicit, run, config }) {
  const candidate = explicit || run?.chainOfThought || config?.orchestration?.chainOfThought || DEFAULT_CHAIN_OF_THOUGHT;
  return CHAIN_OF_THOUGHT.includes(candidate) ? candidate : DEFAULT_CHAIN_OF_THOUGHT;
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
    workerBackend: explicitWorkerBackend = null,
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
  const workerBackend = resolveWorkerBackend({ explicit: explicitWorkerBackend, config });
  const chainOfThought = resolveChainOfThought({ config });

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
    chainOfThought,
    execution: pickExecution(execData),
    plan: {
      intent: route.intent,
      track: route.track,
      specialists: route.specialists || [],
      suggestedWorkflowType: route.suggestedWorkflowType || null,
      researchExecutionPolicy: route.researchExecutionPolicy || null,
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
  emitRunEvent(runId, { type: 'planned', status: 'planned', executionMode: run.execution.executionMode, taskCount: tasks.length });
  return run;
}

// The inline backend prepares one task: queued → running → prepared, no model
// reasoning. The boundary ADR-0020 makes explicit.

function prepareTaskInline(task) {
  task.executor = 'inline:prepared';
  task.status = 'prepared';
  task.finishedAt = new Date().toISOString();
  // A prepared web-capable task reached no web: mark it so a host never infers live
  // web access from a task that only planned (ADR-0050).
  if (roleHoldsWebCapability(task.role)) task.webCapability = 'prepare-only';
}

// The provider backend executes one task against the configured model. A failed
// task is recorded (status `failed`, task.error) and does not abort the run, so
// one specialist failure cannot lose the work of the others.

async function executeTaskViaProvider(task, run, env, fetchImpl, chainOfThought) {
  try {
    const result = await runTaskViaProvider({
      task, run,
      model: run.execution?.selectedModel,
      provider: run.execution?.selectedProvider,
      env, fetchImpl, chainOfThought,
    });
    task.output = result.output;
    task.executor = `provider:${result.provider}:${result.model}`;
    task.status = 'done';
    task.finishedAt = new Date().toISOString();

    // Web-capable execution records which grant mode reached (or did not reach) the web
    // and the F08-governed evidence gathered, so a host never has to infer it (ADR-0050).
    if (result.webCapability) {
      task.webCapability = result.webCapability;
      task.webEvidence = result.webEvidence || [];
      task.webCalls = result.webCalls || 0;
      task.webSearchRequests = result.webSearchRequests || 0;
    }

    // `surface` attaches reasoning to the task so every display surface renders
    // it; `telemetry_only` keeps it off the task (recorded only in the trace).
    if (chainOfThought === 'surface' && result.reasoning) task.reasoning = result.reasoning;
    return { ok: true, reasoning: result.reasoning || '', webCapability: result.webCapability || null };
  } catch (err) {
    task.executor = `provider:error`;
    task.error = { code: err.code || 'PROVIDER_EXECUTION_FAILED', message: err.message };
    task.status = 'failed';
    task.finishedAt = new Date().toISOString();
    return { ok: false, reasoning: '' };
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

  const runFilePath = join(cwd, '.cx', 'runtime', 'orchestration', 'runs', `${runId}.json`);

  try {
    const backend = resolveWorkerBackend({ explicit: workerBackend, run, config });
    const chainOfThought = resolveChainOfThought({ run, config });
    run.workerBackend = backend;
    run.chainOfThought = chainOfThought;
    run.status = 'running';
    run.updatedAt = new Date().toISOString();
    await store.saveRun(run);
    emitRunEvent(runId, { type: 'running', status: 'running', workerBackend: backend });

    let anyFailed = false;
    let cancelled = false;
    let webUnavailable = false;
    for (const task of run.tasks) {
      if (isCancelRequested(runId)) { cancelled = true; break; }
      task.status = 'running';
      task.startedAt = new Date().toISOString();
      emitTraceEvent({ rootDir: cwd, env, traceId: run.traceId, spanId: newSpanId(), eventType: 'worker.started', role: task.role, taskId: task.id, metadata: { runId, workerBackend: backend } });
      emitRunEvent(runId, { type: 'task', taskId: task.id, role: task.role, status: 'running' });

      let taskReasoning = '';
      if (backend === PROVIDER) {
        const res = await executeTaskViaProvider(task, run, env, fetchImpl, chainOfThought);
        if (!res.ok) anyFailed = true;
        if (res.webCapability === 'unavailable') webUnavailable = true;
        taskReasoning = res.reasoning;
      } else {
        prepareTaskInline(task);
      }

      // telemetry_only records reasoning to the trace without ever surfacing it to
      // a display; surface keeps it off the trace (it rides on task.reasoning).
      const completedMeta = { runId, status: task.status };
      if (chainOfThought === 'telemetry_only' && taskReasoning) {
        completedMeta.reasoning = taskReasoning;
        completedMeta.reasoningChars = taskReasoning.length;
      }
      emitTraceEvent({ rootDir: cwd, env, traceId: run.traceId, spanId: newSpanId(), eventType: 'worker.completed', role: task.role, taskId: task.id, metadata: completedMeta });
      emitRunEvent(runId, { type: 'task', taskId: task.id, role: task.role, status: task.status, executor: task.executor, ...(task.reasoning ? { reasoning: task.reasoning } : {}), ...(task.error ? { error: task.error } : {}) });
      run.updatedAt = new Date().toISOString();
      await store.saveRun(run);
    }

    let terminalStatus;
    // degraded can come from execution contract (no model resolved) or web capability gap
    const isDegraded = run.degraded || run.execution?.degraded || webUnavailable;
    if (isDegraded) {
      run.degraded = true;
      run.degradationReason = run.degradationReason || run.execution?.degradationReason || (webUnavailable ? 'capability-unavailable' : 'no-model-resolved');
    }
    if (cancelled) {
      terminalStatus = 'cancelled';
    } else if (anyFailed) {
      terminalStatus = 'completed-with-failures';
    } else if (isDegraded && run.tasks.length === 0) {
      terminalStatus = 'degraded';
    } else if (run.tasks.length > 0 && run.tasks.every((t) => t.status === 'prepared')) {
      terminalStatus = 'completed-prepare-only';
    } else {
      terminalStatus = 'completed';
    }
    run.status = terminalStatus;
    run.updatedAt = new Date().toISOString();
    await store.saveRun(run);
    clearCancel(runId);
    emitTraceEvent({ rootDir: cwd, env, traceId: run.traceId, spanId: newSpanId(), eventType: 'lifecycle.completed', metadata: { runId, status: run.status, tasks: run.tasks.length } });
    emitRunEvent(runId, { type: 'completed', status: run.status });
    return run;
  } catch (err) {
    run.status = 'error';
    run.error = { code: err.code || 'RUN_EXECUTE_FAILED', message: err.message };
    run.updatedAt = new Date().toISOString();
    // Direct (non-atomic) write to the existing run file: the file was created by
    // planRun so the inode exists; overwriting an existing file succeeds even on a
    // read-only directory (only creating new files requires write permission on the
    // directory itself). This persists the terminal failure durably so
    // getRun/getRuns surfaces the error status to doctor and orchestration_status.
    try { writeFileSync(runFilePath, `${JSON.stringify(run, null, 2)}\n`); } catch { /* best-effort */ }
    emitRunEvent(runId, { type: 'error', status: 'error', error: run.error });
    throw err;
  }
}

/**
 * Plan and execute in one call (the common `orchestrate run` path).
 */
export async function runOrchestration(request = {}, { env = process.env, cwd = process.cwd(), workerBackend = null, fetchImpl } = {}) {
  const planned = await planRun(request, { env, cwd });
  return executeRun(cwd, planned.runId, { env, workerBackend, fetchImpl });
}

/**
 * Start a run for a thin client: plan + persist synchronously, then execute in
 * the BACKGROUND (not awaited) so the caller gets a runId immediately and tracks
 * progress via the event stream / run store. Execution failures are caught and
 * surfaced as a terminal `error` run event rather than an unhandled rejection.
 *
 * @param {object} request
 * @param {object} [opts]   { env, cwd, workerBackend, fetchImpl }
 * @returns {Promise<object>} the planned run (status `planned`)
 */
export async function startRun(request = {}, { env = process.env, cwd = process.cwd(), workerBackend = null, fetchImpl } = {}) {
  const planned = await planRun(request, { env, cwd });
  Promise.resolve()
    .then(() => executeRun(cwd, planned.runId, { env, workerBackend, fetchImpl }))
    .catch((err) => {
      emitRunEvent(planned.runId, { type: 'error', status: 'error', error: { code: err.code || 'RUN_FAILED', message: err.message } });
    });
  return planned;
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
    chainOfThought: run.chainOfThought ?? null,
    hostRole: run.hostRole,
    degraded: e.degraded,
    degradationReason: e.degradationReason,
    selectedProvider: e.selectedProvider,
    selectedModel: e.selectedModel,
    tasks: (run.tasks || []).map((t) => ({ id: t.id, role: t.role, status: t.status, executor: t.executor, reasoning: t.reasoning ?? null, output: t.output ?? null, error: t.error ?? null })),
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
