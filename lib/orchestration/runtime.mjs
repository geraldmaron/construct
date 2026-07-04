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
 *
 * Tenant propagation (ADR-0057/A7, LMCP-H1): resolveTenantContext runs once
 * per planRun/executeRun call and its tenantId rides the run record, every
 * task, and every emitted trace/run event. Enterprise mode with no
 * resolvable tenant throws TenantResolutionError — planning and resuming a
 * run both fail closed rather than persisting an unlabeled run.
 *
 * Run-level executionState (LMCP-F4): executeRun aggregates every task's
 * LMCP-F1 executionState (prepared|executed|degraded-executed|failed) into one
 * `run.executionState` via aggregateExecutionState, so a caller (construct
 * status, an MCP host) never has to walk run.tasks to learn whether a run only
 * prepared work or actually executed it. Precedence: failed >
 * degraded-executed > executed > prepared; a zero-task run (prompt-only,
 * host-direct) aggregates to null rather than fabricating a state for work
 * that never happened.
 */

import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { routeRequest } from '../orchestration-policy.mjs';
import { resolveExecution } from '../embedded-contract/execution.mjs';
import { detectHostCapabilities } from '../host-capabilities.mjs';
import { loadProjectConfig } from '../config/project-config.mjs';
import { CHAIN_OF_THOUGHT_MODES, DEFAULT_PROJECT_CONFIG } from '../config/schema.mjs';
import { newTraceId, newSpanId, emitTraceEvent } from '../worker/trace.mjs';
import { resolveRunStore } from './store.mjs';
import { runTaskViaProvider, INLINE, PROVIDER, WORKER_BACKEND_SET } from './worker.mjs';
import { roleHoldsWebCapability } from './web-capability.mjs';
import { emitRunEvent, isCancelRequested, clearCancel } from './events.mjs';
import { getDeploymentMode } from '../deployment-mode.mjs';
import { resolveTenantContext } from '../tenant/context.mjs';

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

function buildTasks(route, tenantId) {
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
    tenantId,
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

export function resolveWorkerBackend({ explicit, run, config }) {
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

// loadProjectConfig reverts the whole file to defaults on any validation
// error (ADR-0021's fail-safe stance); loadConfig historically discarded the
// errors/source that reversion carries, so a typo (e.g. store: "sqllite")
// silently flipped workerBackend back to inline with no user-visible signal.
// configWarnings names the offending key/value and states defaults were
// applied, mirrored into planRun's warnings and construct doctor
// (construct-uccl.5).

function loadConfigWithWarnings(cwd, env) {
  try {
    const loaded = loadProjectConfig(cwd, env);
    const configWarnings = loaded.source === 'invalid'
      ? loaded.errors.map(
          (e) => `construct.config.json invalid (${e}) — reverted to defaults (workerBackend=${DEFAULT_PROJECT_CONFIG.orchestration.workerBackend}). Fix construct.config.json to keep your settings.`,
        )
      : [];
    return { config: loaded.config || {}, configWarnings };
  } catch {
    return { config: {}, configWarnings: [] };
  }
}

function loadConfig(cwd, env) {
  return loadConfigWithWarnings(cwd, env).config;
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

  const { config, configWarnings } = loadConfigWithWarnings(cwd, env);
  const { store, warnings: storeWarnings, degraded: storeDegraded, degradedReason: storeDegradedReason } = resolveRunStore({ config, env, cwd });
  if (storeDegraded) {
    process.stderr.write(`[construct] orchestration store degraded (${storeDegradedReason ?? 'unknown'}): ${storeWarnings.join('; ')}\n`);
  }

  // ADR-0057 (A7): tenant context is resolved once per run, here, and rides
  // every run/task record below. Enterprise mode with no resolvable tenant
  // throws TenantResolutionError — planRun fails closed rather than planning
  // a run with a null tenant label.
  const { tenantId } = resolveTenantContext({ env, config, mode: getDeploymentMode(env, { cwd }) });

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
  const tasks = orchestrates ? buildTasks(route, tenantId) : [];

  const run = {
    runId,
    traceId,
    tenantId,
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
    warnings: [...(execData.warnings || []), ...storeWarnings, ...configWarnings],
    semantics: RUNTIME_SEMANTICS,
    executionSemantics: execData.semantics,
  };

  await store.saveRun(run);
  emitTraceEvent({
    rootDir: cwd, env, traceId, spanId: newSpanId(), eventType: 'task_graph.created',
    metadata: { runId, tenantId, executionMode: run.execution.executionMode, specialists: run.plan.specialists, workerBackend: run.workerBackend },
  });
  emitRunEvent(runId, { type: 'planned', status: 'planned', tenantId, executionMode: run.execution.executionMode, taskCount: tasks.length });
  return run;
}

// The inline backend prepares one task: queued → running → prepared, no model
// reasoning. The boundary ADR-0020 makes explicit.

function prepareTaskInline(task) {
  task.executor = 'inline:prepared';
  task.status = 'prepared';
  task.finishedAt = new Date().toISOString();
  // The inline backend never resolves a persona or calls a model (ADR-0020), so
  // packId/promptVersion/model/provider/toolGrants stay unset — there is nothing
  // real to report yet. executionState still carries the honest signal: this task
  // was prepared, not executed (LMCP-F1/F4).
  task.executionState = 'prepared';
  // A prepared web-capable task reached no web: mark it so a host never infers live
  // web access from a task that only planned (ADR-0050).
  if (roleHoldsWebCapability(task.role)) task.webCapability = 'prepare-only';
}

// The provider backend executes one task against the configured model. A failed
// task is recorded (status `failed`, task.error) and does not abort the run, so
// one specialist failure cannot lose the work of the others.

async function executeTaskViaProvider(task, run, env, fetchImpl, chainOfThought, cwd) {
  try {
    const result = await runTaskViaProvider({
      task, run,
      model: run.execution?.selectedModel,
      provider: run.execution?.selectedProvider,
      env, fetchImpl, chainOfThought, cwd,
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

    // Persona resolution (LMCP-E2): personaAvailable rides on every task so a
    // host never has to infer whether the specialist ran under its real prompt
    // or the solo-mode fallback; degraded is set only on the fallback path.
    task.personaAvailable = result.personaAvailable;
    if (result.degraded) task.degraded = result.degraded;

    // Execution provenance (LMCP-F1): which specialist/pack/prompt/model/provider
    // actually ran and under which tool grants — the basis for audit and
    // evaluation. Rides on every provider-executed task, not gated on
    // chainOfThought, same as personaAvailable above.
    task.specialistId = result.specialistId;
    task.packId = result.packId;
    task.promptVersion = result.promptVersion;
    task.model = result.model;
    task.provider = result.provider;
    task.toolGrants = result.toolGrants || [];
    task.executionState = result.executionState;

    // `surface` attaches reasoning to the task so every display surface renders
    // it; `telemetry_only` keeps it off the task (recorded only in the trace).
    if (chainOfThought === 'surface' && result.reasoning) task.reasoning = result.reasoning;
    return {
      ok: true,
      reasoning: result.reasoning || '',
      webCapability: result.webCapability || null,
      personaAvailable: result.personaAvailable,
      personaDegraded: Boolean(result.degraded),
      specialistId: result.specialistId,
      packId: result.packId,
      promptVersion: result.promptVersion,
      model: result.model,
      provider: result.provider,
      toolGrants: result.toolGrants || [],
      executionState: result.executionState,
    };
  } catch (err) {
    task.executor = `provider:error`;
    task.error = { code: err.code || 'PROVIDER_EXECUTION_FAILED', message: err.message };
    task.status = 'failed';
    task.finishedAt = new Date().toISOString();
    // A refused/failed provider call never resolved a real specialist/pack/prompt to
    // report — executionState is the one honest signal available here (LMCP-F1/F4).
    task.executionState = 'failed';
    return { ok: false, reasoning: '', executionState: 'failed' };
  }
}

// Run-level executionState aggregates every task's LMCP-F1 executionState
// (prepared|executed|degraded-executed|failed) into one honest signal for the
// whole run (LMCP-F4). A run with no tasks (prompt-only, host-direct) owns no
// specialist sequence, so it aggregates to null rather than fabricating a
// state for work that never happened. `failed` wins over everything — a run
// that failed even one task must never report an aggregate that reads as
// clean. `degraded-executed` beats `executed` next, so a solo-mode persona
// fallback is never hidden behind a bare 'executed' when at least one real
// execution also happened. All-`prepared` is the more specific "nothing ran"
// signal and only applies when every task shares it.

const EXECUTION_STATE_PRECEDENCE = ['failed', 'degraded-executed', 'executed', 'prepared'];

function aggregateExecutionState(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return null;
  const present = new Set(tasks.map((t) => t.executionState).filter(Boolean));
  for (const state of EXECUTION_STATE_PRECEDENCE) {
    if (present.has(state)) return state;
  }
  // No task carries a recognized executionState (pre-F1 legacy run) — nothing
  // honest to report, so null rather than guessing.
  return null;
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

  // A run persisted before this bead carries no tenantId; resolve it now
  // rather than leave the field permanently absent on resumed runs. Enterprise
  // mode fails closed here exactly as it would have at planRun time.
  if (run.tenantId === undefined) {
    run.tenantId = resolveTenantContext({ env, config, mode: getDeploymentMode(env, { cwd }) }).tenantId;
  }

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
    let personaDegraded = false;
    for (const task of run.tasks) {
      if (isCancelRequested(runId)) { cancelled = true; break; }
      task.status = 'running';
      task.startedAt = new Date().toISOString();
      emitTraceEvent({ rootDir: cwd, env, traceId: run.traceId, spanId: newSpanId(), eventType: 'worker.started', role: task.role, taskId: task.id, metadata: { runId, tenantId: run.tenantId, workerBackend: backend } });
      emitRunEvent(runId, { type: 'task', taskId: task.id, role: task.role, status: 'running', tenantId: run.tenantId });

      let taskReasoning = '';
      if (backend === PROVIDER) {
        const res = await executeTaskViaProvider(task, run, env, fetchImpl, chainOfThought, cwd);
        if (!res.ok) anyFailed = true;
        if (res.webCapability === 'unavailable') webUnavailable = true;
        if (res.personaDegraded) personaDegraded = true;
        taskReasoning = res.reasoning;
      } else {
        prepareTaskInline(task);
      }

      // telemetry_only records reasoning to the trace without ever surfacing it to
      // a display; surface keeps it off the trace (it rides on task.reasoning).
      // personaAvailable/degraded ride the trace unconditionally (not gated on
      // chainOfThought) so a persona-degraded run is always discoverable from
      // trace history alone, independent of reasoning-disclosure mode.
      const completedMeta = { runId, tenantId: run.tenantId, status: task.status };
      if (chainOfThought === 'telemetry_only' && taskReasoning) {
        completedMeta.reasoning = taskReasoning;
        completedMeta.reasoningChars = taskReasoning.length;
      }
      if (task.personaAvailable === false) {
        completedMeta.personaAvailable = false;
        completedMeta.degraded = task.degraded || 'persona-fallback';
      }
      // Execution provenance (LMCP-F1): specialist/pack/prompt/model/provider/
      // tool-grants/executionState ride the trace unconditionally whenever the
      // task carries them (inline prepare-only tasks carry only executionState;
      // provider tasks, success or failure, carry the full set) — same
      // always-on pattern as personaAvailable above, so a reader never has to
      // reconstruct provenance from a separate source.
      if (task.executionState !== undefined) completedMeta.executionState = task.executionState;
      if (task.specialistId !== undefined) completedMeta.specialistId = task.specialistId;
      if (task.packId !== undefined) completedMeta.packId = task.packId;
      if (task.promptVersion !== undefined) completedMeta.promptVersion = task.promptVersion;
      if (task.model !== undefined) completedMeta.model = task.model;
      if (task.provider !== undefined) completedMeta.provider = task.provider;
      if (task.toolGrants !== undefined) completedMeta.toolGrants = task.toolGrants;
      emitTraceEvent({ rootDir: cwd, env, traceId: run.traceId, spanId: newSpanId(), eventType: 'worker.completed', role: task.role, taskId: task.id, metadata: completedMeta });
      emitRunEvent(runId, { type: 'task', taskId: task.id, role: task.role, status: task.status, executor: task.executor, ...(task.reasoning ? { reasoning: task.reasoning } : {}), ...(task.error ? { error: task.error } : {}) });
      run.updatedAt = new Date().toISOString();
      await store.saveRun(run);
    }

    // LMCP-F4: aggregate every task's executionState into one run-level signal
    // before the terminal status is computed, so a reader never has to walk
    // run.tasks to learn whether the run prepared, executed, degraded-executed,
    // or failed.
    run.executionState = aggregateExecutionState(run.tasks);

    let terminalStatus;
    // degraded can come from the execution contract (no model resolved), a web
    // capability gap, or a solo-mode persona fallback; any source means the run
    // must not surface as a bare success.
    const isDegraded = run.degraded || run.execution?.degraded || webUnavailable || personaDegraded;
    if (isDegraded) {
      run.degraded = true;
      run.degradationReason = run.degradationReason || run.execution?.degradationReason
        || (webUnavailable ? 'capability-unavailable' : personaDegraded ? 'persona-fallback' : 'no-model-resolved');
    }
    // Prepare-only is the more specific "no specialist executed" signal, so an
    // all-prepared run reports that even if also degraded; otherwise any degraded run
    // — zero-task or executed-with-a-gap — is 'degraded', never bare 'completed'.
    if (cancelled) {
      terminalStatus = 'cancelled';
    } else if (anyFailed) {
      terminalStatus = 'completed-with-failures';
    } else if (run.tasks.length > 0 && run.tasks.every((t) => t.status === 'prepared')) {
      terminalStatus = 'completed-prepare-only';
    } else if (isDegraded) {
      terminalStatus = 'degraded';
    } else {
      terminalStatus = 'completed';
    }
    run.status = terminalStatus;
    run.updatedAt = new Date().toISOString();
    await store.saveRun(run);
    clearCancel(runId);
    emitTraceEvent({ rootDir: cwd, env, traceId: run.traceId, spanId: newSpanId(), eventType: 'lifecycle.completed', metadata: { runId, tenantId: run.tenantId, status: run.status, tasks: run.tasks.length } });
    emitRunEvent(runId, { type: 'completed', status: run.status, tenantId: run.tenantId });
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

  // Fire-and-forget: no claim, heartbeat, or retry — process death silently kills the run.
  // Solo mode only; durable team/enterprise worker execution is a separate bead. runMode
  // labels the record as in-process so orchestration_status never conflates it with a durable worker.

  planned.runMode = 'in-process';
  const { store } = resolveRunStore({ config: loadConfig(cwd, env), env, cwd });
  await store.saveRun(planned);

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
    tenantId: run.tenantId ?? null,
    status: run.status,
    // LMCP-F4: the run-level aggregate of every task's executionState, or null
    // for a zero-task run (prompt-only/host-direct) or a pre-F4 legacy record.
    executionState: run.executionState ?? aggregateExecutionState(run.tasks) ?? null,
    requestedStrategy: e.requestedStrategy,
    effectiveStrategy: e.effectiveStrategy,
    executionMode: e.executionMode,
    constructCapabilitiesActive: e.constructCapabilitiesActive,
    workerBackend: run.workerBackend,
    chainOfThought: run.chainOfThought ?? null,
    hostRole: run.hostRole,
    degraded: run.degraded ?? e.degraded ?? false,
    degradationReason: run.degradationReason ?? e.degradationReason ?? null,
    selectedProvider: e.selectedProvider,
    selectedModel: e.selectedModel,
    // ?? null / ?? [] on every LMCP-F1 field: a pre-F1 run record carries none of
    // these keys, so a typed absence is returned rather than `undefined`.
    tasks: (run.tasks || []).map((t) => ({
      id: t.id, role: t.role, status: t.status, executor: t.executor, tenantId: t.tenantId ?? null,
      reasoning: t.reasoning ?? null, output: t.output ?? null, error: t.error ?? null,
      specialistId: t.specialistId ?? null,
      packId: t.packId ?? null,
      promptVersion: t.promptVersion ?? null,
      model: t.model ?? null,
      provider: t.provider ?? null,
      toolGrants: t.toolGrants ?? [],
      executionState: t.executionState ?? null,
      personaAvailable: t.personaAvailable ?? null,
    })),
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
