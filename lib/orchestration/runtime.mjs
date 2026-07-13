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
import { resolveStateDir } from '../state-root.mjs';
import { resolveRunStore, projectKey } from './store.mjs';
import { resolveTraceStore } from './trace-store.mjs';
import { runTaskViaProvider, materializeTaskPrompt, INLINE, PROVIDER, HOST, WORKER_BACKEND_SET } from './worker.mjs';
import { roleHoldsWebCapability } from './web-capability.mjs';
import { gateResearchEvidence } from './research-evidence-gate.mjs';
import { emitRunEvent, isCancelRequested, clearCancel } from './events.mjs';
import { getDeploymentMode } from '../deployment-mode.mjs';
import { resolveTenantContext } from '../tenant/context.mjs';
import { resolveContextBindings } from './context-bindings.mjs';
import { extractContentSignals } from './content-signals.mjs';
import { recruit } from './recruiter.mjs';

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

// Persisted run records drop the full contract objects (schemas, postconditions)
// resolveContractChain attaches — the run store only needs enough to identify
// which typed handoff applied at which stage, not the handoff's shape.

function buildTrimmedContractChain(contractChain = []) {
  return (contractChain || []).map((e) => ({
    id: e.contract?.id, producer: e.contract?.producer, consumer: e.contract?.consumer, stage: e.stage,
  }));
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
    recruited: Boolean(reasons[role]),
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

// Best-effort mirror of a local trace event into the team-shared trace store
// (LMCP-G10): a no-op in solo mode or when Postgres is unreachable
// (resolveTraceStore already encodes that fallback), and never allowed to
// fail the run itself — the local `.construct/traces` JSONL emitTraceEvent already
// wrote is the durable record either way.

function persistTeamTrace({ cwd, env, config, event, tenantId }) {
  if (!event) return;
  try {
    const teamStore = resolveTraceStore({ env, cwd, config });
    if (teamStore.kind !== 'postgres') return;
    teamStore.saveTraceEvent(event, { project: projectKey(config, cwd), tenantId }).catch(() => {});
  } catch { /* observability must not break the caller — see header comment */ }
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
    workerBackend: explicitWorkerBackend = null, contextTargets = null,
  } = request;

  const { config, configWarnings } = loadConfigWithWarnings(cwd, env);

  // Context-target bindings (B4) are validated here, before any task is built or
  // any run record is saved, so an unknown id fails the whole plan closed rather
  // than persisting a run bound to context it cannot reach. Omission resolves to
  // an empty list and leaves today's implicit source resolution untouched.
  const contextBindings = resolveContextBindings(contextTargets, { config, env, cwd });
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
      contractChain: buildTrimmedContractChain(route.contractChain),
      // Same trimmed contractChain as above (not the full contract objects
      // route.routePath.contractChain carries) — the persisted run record
      // stays one contractChain, not two copies at different fidelities.
      routePath: route.routePath ? {
        teamPath: route.routePath.teamPath,
        specialistSequence: route.routePath.specialistSequence,
        contractChain: buildTrimmedContractChain(route.contractChain),
        sourcePolicy: route.routePath.sourcePolicy,
        rationale: route.routePath.rationale,
      } : null,
    },
    tasks,
    participation: [],
    status: 'planned',
    warnings: [...(execData.warnings || []), ...storeWarnings, ...configWarnings],
    semantics: RUNTIME_SEMANTICS,
    executionSemantics: execData.semantics,
    // Only present when the run was given explicit context targets, so a run
    // without them stays byte-identical to a pre-B4 record (R1/AC3).
    ...(contextBindings.length ? { contextBindings } : {}),
  };

  await store.saveRun(run);
  emitTraceEvent({
    rootDir: cwd, env, traceId, spanId: newSpanId(), eventType: 'task_graph.created',
    metadata: {
      runId, tenantId, executionMode: run.execution.executionMode, specialists: run.plan.specialists,
      workerBackend: run.workerBackend, routePath: run.plan.routePath,
    },
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

// Deterministic evidence gate on a finalized research task, applied to both the
// provider and host backends so the model tier is irrelevant. A substantial
// cx-researcher answer with no citation of its expected kind is marked degraded
// (evidenceGate.ok=false) rather than presented as verified — the persona's
// no-fabrication contract is honor-system, so the gate is the enforcement.

function applyResearchEvidenceGate(task, run) {
  const verdict = gateResearchEvidence({
    output: task.output,
    role: task.role,
    request: run?.request?.summary || run?.request || '',
  });
  if (!verdict.applicable) return;
  task.evidenceGate = { ok: verdict.ok, kind: verdict.kind, citationCount: verdict.citationCount };
  if (!verdict.ok) task.evidenceGate.reason = verdict.reason;
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
    applyResearchEvidenceGate(task, run);

    // Web-capable execution records which grant mode reached (or did not reach) the web
    // and the F08-governed evidence gathered, so a host never has to infer it (ADR-0050).
    if (result.webCapability) {
      task.webCapability = result.webCapability;
      task.webEvidence = result.webEvidence || [];
      task.webCalls = result.webCalls || 0;
      task.webSearchRequests = result.webSearchRequests || 0;
    }

    // Evidence grounding (construct-5wkl AC#5): a citation the specialist wrote
    // but that never appeared in its own governed webEvidence is unverified —
    // the task still completes (real output, already paid for) but carries the
    // warning rather than looking identical to a fully-grounded answer.
    if (result.evidenceStatus) {
      task.evidenceStatus = result.evidenceStatus;
      task.unverifiedCitations = result.unverifiedCitations || [];
    }

    // Provider telemetry (construct-5wkl AC#3): redacted, machine-readable
    // execution metadata — provider, model, finish_reason, usage, elapsedMs,
    // retryCount, and reasoning request/return — so a debugging pass never has
    // to re-run the task to learn why it behaved the way it did.
    if (result.providerMeta) task.providerMeta = result.providerMeta;

    // In-run contract enforcement (construct-pteo2.14): the worker's handoff
    // check result rides the task so a reader — and finalizeRun's terminal
    // status — sees a BLOCKED_CONTRACT without replaying the violation log.
    if (result.contractStatus && result.contractStatus !== 'unchecked') {
      task.contractStatus = result.contractStatus;
      if (result.contractId) task.contractId = result.contractId;
      if (result.contractViolations) task.contractViolations = result.contractViolations;
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
    task.error = {
      code: err.code || 'PROVIDER_EXECUTION_FAILED',
      message: err.message,
      ...(err.remediation ? { remediation: err.remediation } : {}),
      ...(Number.isFinite(err.retryCount) ? { retryCount: err.retryCount } : {}),
    };
    task.status = 'failed';
    task.finishedAt = new Date().toISOString();
    // A refused/failed provider call never resolved a real specialist/pack/prompt to
    // report — executionState is the one honest signal available here (LMCP-F1/F4).
    task.executionState = 'failed';
    // A content-shaped failure (empty/reasoning-only/content-filtered/malformed)
    // still reached a real HTTP response, so its redacted provider metadata
    // (construct-5wkl AC#3) is worth keeping even though the task failed.
    if (err.providerMeta) task.providerMeta = err.providerMeta;
    return { ok: false, reasoning: '', executionState: 'failed' };
  }
}

// The host backend materializes one task's prompt (same materializeTaskPrompt the
// provider executor uses) and stops — no model call runs here. The calling host
// (the MCP client that requested the run) executes the prompt in its own session
// and reports the result back through submitHostTaskResult. A materialization
// failure (e.g. a team/enterprise persona hard-fail) is recorded as a task
// failure, same posture as a provider call that throws before ever reaching a
// model — one specialist's prompt failing to resolve does not lose the others.

function prepareTaskForHost(task, run, cwd, env) {
  try {
    const prompt = materializeTaskPrompt({ task, run, cwd, env });
    task.hostPrompt = { system: prompt.system, user: prompt.user };
    task.specialistId = prompt.specialistId;
    task.packId = prompt.packId;
    task.promptVersion = prompt.promptVersion;
    task.toolGrants = prompt.toolGrants;
    task.personaAvailable = prompt.personaAvailable;
    if (prompt.degraded) task.degraded = prompt.degraded;
    task.executor = 'host:awaiting';
    task.status = 'awaiting-host';
    task.finishedAt = null;
    task.executionState = 'awaiting-host';
    return { ok: true };
  } catch (err) {
    task.executor = 'host:error';
    task.error = {
      code: err.code || 'HOST_MATERIALIZE_FAILED',
      message: err.message,
      ...(err.remediation ? { remediation: err.remediation } : {}),
    };
    task.status = 'failed';
    task.finishedAt = new Date().toISOString();
    task.executionState = 'failed';
    return { ok: false };
  }
}

// Evolving-signal participation (construct-pteo2.11): after a provider task
// completes, its OUTPUT is a new signal source — a cost table appearing in a
// specialist's real output recruits the cost reviewer onto the same run,
// executed by the remaining loop iterations (swarm assembly reused from the
// construct-pteo2.5 recruiter). Every join is recorded on run.participation
// with a reason and emitted as run/trace events; a joined participant that
// never reaches execution (cancellation) leaves the same way. A team joins
// as a unit: its member specialists join together under the team's reason.
// Bounded (MAX_EVOLVED_JOINS) so hostile output text cannot flood the run,
// and a re-evaluation failure never breaks the run.

const MAX_EVOLVED_JOINS = 4;

function joinParticipant(run, { role, reason, via, afterTask, team = null }) {
  const id = `t${run.tasks.length + 1}`;
  run.tasks.push({
    id,
    seq: run.tasks.length,
    role,
    tenantId: run.tenantId,
    reason,
    recruited: true,
    joinedVia: 'evolving-signals',
    ...(team ? { joinedWithTeam: team } : {}),
    handoffContract: null,
    status: 'queued',
    executor: null,
    output: null,
    reasoning: null,
    error: null,
    startedAt: null,
    finishedAt: null,
  });
  run.participation.push({
    event: 'joined',
    role,
    reason,
    via,
    ...(team ? { team } : {}),
    afterTask,
    at: new Date().toISOString(),
  });
  return id;
}

function reevaluateParticipation(run, task, { cwd, env }) {
  if (!task.output || task.status === 'failed') return;
  if (!Array.isArray(run.participation)) run.participation = [];
  const joinedSoFar = run.participation.filter((p) => p.event === 'joined').length;
  if (joinedSoFar >= MAX_EVOLVED_JOINS) return;
  try {
    const signals = extractContentSignals(String(task.output));
    const onField = run.tasks.map((t) => `cx-${String(t.role).replace(/^cx-/, '')}`);
    const recruits = recruit({ signals, kind: 'review', exclude: onField });
    let budget = MAX_EVOLVED_JOINS - joinedSoFar;
    for (const p of recruits) {
      if (budget <= 0) break;
      if (p.specialist) {
        const role = p.specialist.startsWith('cx-') ? p.specialist : `cx-${p.specialist}`;
        if (run.tasks.some((t) => t.role === role)) continue;
        const id = joinParticipant(run, { role, reason: p.reason, via: p.via, afterTask: task.id });
        budget -= 1;
        emitRunEvent(run.runId, { type: 'participant', event: 'joined', taskId: id, role, reason: p.reason });
        emitTraceEvent({ rootDir: cwd, env, traceId: run.traceId, spanId: newSpanId(), eventType: 'participant.joined', role, taskId: id, metadata: { runId: run.runId, tenantId: run.tenantId, reason: p.reason, afterTask: task.id } });
      } else if (p.team && Array.isArray(p.members)) {
        for (const member of p.members) {
          if (budget <= 0) break;
          const role = member.startsWith('cx-') ? member : `cx-${member}`;
          if (run.tasks.some((t) => t.role === role)) continue;
          const id = joinParticipant(run, { role, reason: p.reason, via: p.via, afterTask: task.id, team: p.team });
          budget -= 1;
          emitRunEvent(run.runId, { type: 'participant', event: 'joined', taskId: id, role, team: p.team, reason: p.reason });
          emitTraceEvent({ rootDir: cwd, env, traceId: run.traceId, spanId: newSpanId(), eventType: 'participant.joined', role, taskId: id, metadata: { runId: run.runId, tenantId: run.tenantId, team: p.team, reason: p.reason, afterTask: task.id } });
        }
      }
    }
  } catch { /* participation re-evaluation is advisory, never run-breaking */ }
}

function withdrawUnexecutedJoins(run, { cwd, env, reason }) {
  if (!Array.isArray(run.participation)) return;
  for (const task of run.tasks) {
    if (task.joinedVia !== 'evolving-signals' || task.status !== 'queued') continue;
    task.status = 'withdrawn';
    task.finishedAt = new Date().toISOString();
    run.participation.push({
      event: 'left',
      role: task.role,
      reason,
      at: new Date().toISOString(),
    });
    emitRunEvent(run.runId, { type: 'participant', event: 'left', taskId: task.id, role: task.role, reason });
    emitTraceEvent({ rootDir: cwd, env, traceId: run.traceId, spanId: newSpanId(), eventType: 'participant.left', role: task.role, taskId: task.id, metadata: { runId: run.runId, tenantId: run.tenantId, reason } });
  }
}

// Run-level executionState aggregates every task's LMCP-F1 executionState
// (prepared|executed|degraded-executed|failed|awaiting-host) into one honest
// signal for the whole run (LMCP-F4). A run with no tasks (prompt-only,
// host-direct) owns no specialist sequence, so it aggregates to null rather
// than fabricating a state for work that never happened. `failed` wins over
// everything — a run that failed even one task must never report an
// aggregate that reads as clean. `degraded-executed` beats `executed` next,
// so a solo-mode persona fallback is never hidden behind a bare 'executed'
// when at least one real execution also happened. `awaiting-host` beats
// `prepared` — a host-backend task materialized its prompt but has not
// prepared-and-stopped the way the inline backend does, so it is a distinct,
// more specific "still pending" signal. All-`prepared` is the most specific
// "nothing ran" signal and only applies when every task shares it.

const EXECUTION_STATE_PRECEDENCE = ['failed', 'degraded-executed', 'executed', 'awaiting-host', 'prepared'];

// Execution honesty for recruited participants (construct-pteo2.12): a task
// added by condition-driven recruitment (dispatchReasons entry → recruited:
// true in buildTasks) that never reached executed/degraded-executed is a
// review that did NOT happen. In a mixed run the aggregate reads 'executed'
// (precedence above), so without this check the unexecuted recruit hides
// behind a bare 'completed' — the exact silent no-op the bead forbids.

export function assessRecruitmentHonesty(tasks) {
  const unexecuted = (Array.isArray(tasks) ? tasks : []).filter((t) => t.recruited
    && t.executionState !== 'executed'
    && t.executionState !== 'degraded-executed');
  if (unexecuted.length === 0) return null;
  return {
    unexecutedRecruits: unexecuted.map((t) => ({
      role: t.role,
      executionState: t.executionState ?? null,
      reason: t.reason ?? null,
    })),
    note: 'recruited reviewer(s) were prepared but never executed — their review was NOT performed',
  };
}

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

// The one honest terminal-status computation, shared by executeRun (the
// synchronous provider/inline/host-materialization path) and
// submitHostTaskResult (the asynchronous host-pickup completion path) — a run
// must resolve to the same completed/completed-with-failures/degraded/
// completed-prepare-only taxonomy regardless of which of those two callers
// closes it out, so this is written once and reused, not reimplemented.

async function finalizeRun(run, { cwd, env, config, store, cancelled = false, anyFailed = false, webUnavailable = false, personaDegraded = false } = {}) {
  // LMCP-F4: aggregate every task's executionState into one run-level signal
  // before the terminal status is computed, so a reader never has to walk
  // run.tasks to learn whether the run prepared, executed, degraded-executed,
  // awaited a host, or failed.
  run.executionState = aggregateExecutionState(run.tasks);

  const recruitmentHonesty = assessRecruitmentHonesty(run.tasks);
  if (recruitmentHonesty) run.recruitmentHonesty = recruitmentHonesty;

  // A blocked handoff contract (construct-pteo2.14) must never surface as a
  // bare success: the run degrades with the contract named unless a stronger
  // terminal state (failed/cancelled) already owns the verdict.
  const blockedContracts = run.tasks.filter((t) => t.contractStatus === 'blocked-contract');
  if (blockedContracts.length > 0 && !run.degradationReason) {
    run.degraded = true;
    run.degradationReason = 'blocked-contract';
  }

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
  } else if (recruitmentHonesty) {
    run.degraded = true;
    run.degradationReason = run.degradationReason || 'recruited-reviewer-not-executed';
    terminalStatus = 'degraded';
  } else {
    terminalStatus = 'completed';
  }
  run.status = terminalStatus;
  run.updatedAt = new Date().toISOString();
  await store.saveRun(run);
  clearCancel(run.runId);
  // terminalStatus already encodes prepared-vs-executed (completed-prepare-only)
  // and degraded-vs-clean, but its precedence order (cancelled > failed >
  // prepare-only > degraded) can collapse a run that is BOTH e.g.
  // completed-with-failures AND degraded into one string. executionState
  // (LMCP-F4) and the degraded boolean ride alongside it so a trace/SSE
  // consumer never has to re-read the run store to recover the signal
  // terminalStatus's precedence dropped.
  const completedTrace = emitTraceEvent({ rootDir: cwd, env, traceId: run.traceId, spanId: newSpanId(), eventType: 'lifecycle.completed', metadata: { runId: run.runId, tenantId: run.tenantId, status: run.status, executionState: run.executionState, degraded: Boolean(run.degraded), tasks: run.tasks.length } });
  persistTeamTrace({ cwd, env, config, event: completedTrace, tenantId: run.tenantId });
  emitRunEvent(run.runId, { type: 'completed', status: run.status, executionState: run.executionState, degraded: Boolean(run.degraded), tenantId: run.tenantId });
  return run;
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

  const runFilePath = join(resolveStateDir(cwd, 'runtime', 'orchestration', 'runs'), `${runId}.json`);

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
        reevaluateParticipation(run, task, { cwd, env });
      } else if (backend === HOST) {
        const res = prepareTaskForHost(task, run, cwd, env);
        if (!res.ok) anyFailed = true;
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

    // The host backend never executes synchronously — it materializes prompts
    // and stands the run at 'awaiting-host' until the calling host submits every
    // task's result via submitHostTaskResult, which finalizes through the same
    // finalizeRun below. The only case that does NOT stand awaiting is when no
    // task actually reached 'awaiting-host' (materialization failed for every
    // task, or the route planned zero tasks) — there is nothing pending pickup,
    // so the run must resolve to a real terminal state rather than stand
    // forever with nothing to submit.
    if (backend === HOST && run.tasks.some((t) => t.status === 'awaiting-host')) {
      run.executionState = aggregateExecutionState(run.tasks);
      run.status = 'awaiting-host';
      run.updatedAt = new Date().toISOString();
      await store.saveRun(run);
      clearCancel(runId);
      emitRunEvent(runId, { type: 'awaiting-host', status: 'awaiting-host', executionState: run.executionState, tenantId: run.tenantId, taskCount: run.tasks.length });
      return run;
    }

    if (cancelled) {
      withdrawUnexecutedJoins(run, { cwd, env, reason: 'run cancelled before the joined participant executed' });
    }

    return finalizeRun(run, { cwd, env, config, store, cancelled, anyFailed, webUnavailable, personaDegraded });
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

// Terminal run statuses a host result can never be submitted against — a run
// that already finalized has nothing left awaiting pickup, so a late submit is
// rejected rather than silently mutating a closed record.

const TERMINAL_RUN_STATUSES = new Set(['completed', 'completed-with-failures', 'completed-prepare-only', 'degraded', 'cancelled', 'error']);

function hostResultError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Record the calling host's execution of one `awaiting-host` task, submitted
 * by the host after it ran the materialized prompt (task.hostPrompt) in its own
 * model session. The result is host-reported, not independently verified —
 * every field this writes is tagged `provenanceSource: 'host-reported'` so it
 * can never be mistaken for a construct-verified provider execution
 * (task.executor also differs: `host:<hostRole>` vs `provider:<provider>:<model>`).
 * When every task on the run is terminal, the run is finalized through the
 * SAME honest terminal-status logic executeRun uses (finalizeRun) — completed
 * vs completed-with-failures is decided once, not reimplemented here.
 *
 * Persistence is read-modify-write via store.saveRun, the same single-writer
 * posture executeRun already has; concurrent submissions racing the same run
 * are not safety-guarded here (team-mode row-locking is a deferred follow-up,
 * see the ADR).
 *
 * @param {string} cwd
 * @param {string} runId
 * @param {string} taskId
 * @param {{output:string, model?:string, provider?:string, reasoning?:string}} result
 * @param {object} [opts]   { env }
 * @returns {Promise<{run:object, nextTask:object|null}>}
 */
export async function submitHostTaskResult(cwd, runId, taskId, result = {}, { env = process.env } = {}) {
  const config = loadConfig(cwd, env);
  const { store } = resolveRunStore({ config, env, cwd });
  const run = await store.loadRun(runId);
  if (!run) throw hostResultError('RUN_NOT_FOUND', `Orchestration run not found: ${runId}`);

  const task = (run.tasks || []).find((t) => t.id === taskId);
  if (!task) throw hostResultError('TASK_NOT_FOUND', `Task ${taskId} not found on run ${runId}.`);

  if (TERMINAL_RUN_STATUSES.has(run.status)) {
    throw hostResultError('RUN_ALREADY_TERMINAL', `Run ${runId} is already terminal (${run.status}); no task result can be submitted.`);
  }
  if (task.status !== 'awaiting-host') {
    throw hostResultError('TASK_NOT_AWAITING_HOST', `Task ${taskId} is not awaiting host execution (status: ${task.status}).`);
  }
  const { output, model = null, provider = null, reasoning = null } = result;
  if (typeof output !== 'string' || !output.trim()) {
    throw hostResultError('HOST_RESULT_EMPTY_OUTPUT', `Host task result for ${taskId} requires non-empty output.`);
  }

  task.output = output;
  task.executor = `host:${run.hostRole || 'unknown'}`;
  task.status = 'done';
  task.finishedAt = new Date().toISOString();
  task.executionState = 'executed';
  applyResearchEvidenceGate(task, run);
  // Host-reported, never independently verified — the distinguishing marker a
  // reader needs so this never looks like a construct-verified provider
  // execution (which carries no provenanceSource field at all).
  task.provenanceSource = 'host-reported';
  if (model) task.model = model;
  if (provider) task.provider = provider;
  if (reasoning) task.reasoning = reasoning;
  delete task.hostPrompt;

  emitTraceEvent({
    rootDir: cwd, env, traceId: run.traceId, spanId: newSpanId(), eventType: 'worker.completed', role: task.role, taskId: task.id,
    metadata: {
      runId, tenantId: run.tenantId, status: task.status, executionState: task.executionState,
      specialistId: task.specialistId, packId: task.packId, promptVersion: task.promptVersion,
      model: task.model, provider: task.provider, toolGrants: task.toolGrants, provenanceSource: task.provenanceSource,
    },
  });
  emitRunEvent(runId, { type: 'task', taskId: task.id, role: task.role, status: task.status, executor: task.executor, ...(task.reasoning ? { reasoning: task.reasoning } : {}) });

  run.updatedAt = new Date().toISOString();

  const stillAwaiting = run.tasks.some((t) => t.status === 'awaiting-host');
  if (stillAwaiting) {
    const nextTask = run.tasks.find((t) => t.status === 'awaiting-host');
    // executeRun materialized every awaiting-host task's prompt in one pass,
    // before any host result existed — nextTask's hostPrompt was built with
    // no upstream output available. Re-materialize it now that this task's
    // real output is on run.tasks, so the prompt the host receives next
    // actually contains the handoff it is meant to build on (the same prompt
    // a provider-backend run for this task would have sent).
    const refreshed = materializeTaskPrompt({ task: nextTask, run, cwd, env });
    nextTask.hostPrompt = { system: refreshed.system, user: refreshed.user };
    await store.saveRun(run);
    return { run, nextTask };
  }

  const anyFailed = run.tasks.some((t) => t.status === 'failed');
  const finalized = await finalizeRun(run, { cwd, env, config, store, anyFailed });
  return { run: finalized, nextTask: null };
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
 * The honest terminal-status taxonomy (construct-fbxv.1): a degraded run
 * never surfaces as a bare 'completed', and an all-prepared run reports the
 * more specific 'completed-prepare-only' rather than a bare 'completed' that
 * would read as real specialist output. Shared by every reader of a run
 * record (shapeRun, hostAdapterMetadata) so a caller sees the same status
 * whichever one it reads through.
 */
export function deriveHonestRunStatus(run) {
  const hasTasks = Array.isArray(run.tasks) && run.tasks.length > 0;
  const allPrepared = hasTasks && run.tasks.every((t) => t.status === 'prepared');
  const degraded = run.degraded ?? run.execution?.degraded ?? false;
  const status = allPrepared
    ? 'completed-prepare-only'
    : degraded && run.status === 'completed'
      ? 'degraded'
      : run.status;
  return { status, allPrepared, degraded };
}

/**
 * The structured metadata a host adapter consumes for runtime-backed integration.
 */
export function hostAdapterMetadata(run) {
  const e = run.execution || {};
  const { status, degraded } = deriveHonestRunStatus(run);
  return {
    runId: run.runId,
    traceId: run.traceId,
    tenantId: run.tenantId ?? null,
    status,
    // LMCP-F4: the run-level aggregate of every task's executionState, or null
    // for a zero-task run (prompt-only/host-direct) or a pre-F4 legacy record.
    executionState: run.executionState ?? aggregateExecutionState(run.tasks) ?? null,
    // The REAL dispatched role list — authoritative over routePath's display
    // fallback, which can carry a hypothetical route the track classifier
    // considered but never dispatched (an empty specialists/tasks pair with a
    // non-empty routePath.specialistSequence is a legitimately trivial run,
    // not a failure — cross-check the two rather than reading routePath alone).
    specialists: run.plan?.specialists ?? [],
    // The team/specialist/contract route that produced this run's task
    // sequence (construct-d1r7.15), so a host adapter can explain the
    // dispatch without re-deriving it from tasks.
    routePath: run.plan?.routePath ?? null,
    requestedStrategy: e.requestedStrategy,
    effectiveStrategy: e.effectiveStrategy,
    executionMode: e.executionMode,
    constructCapabilitiesActive: e.constructCapabilitiesActive,
    workerBackend: run.workerBackend,
    chainOfThought: run.chainOfThought ?? null,
    hostRole: run.hostRole,
    degraded,
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
      // Present only on a host-executed task — absence (not a bare `false`)
      // is what keeps a provider-verified task from ever reading the same as
      // a host-reported one.
      ...(t.provenanceSource ? { provenanceSource: t.provenanceSource } : {}),
      ...(t.hostPrompt ? { hostPrompt: t.hostPrompt } : {}),
      ...(t.evidenceGate ? { evidenceGate: t.evidenceGate } : {}),
    })),
    warnings: run.warnings || [],
    semantics: run.semantics,
    executionSemantics: run.executionSemantics,
    // Resolved context-target bindings (B4): a typed absence for a run planned
    // without them, so an inspecting host never infers bindings that weren't set.
    contextBindings: run.contextBindings ?? [],
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
