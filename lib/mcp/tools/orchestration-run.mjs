/**
 * lib/mcp/tools/orchestration-run.mjs — MCP entry for Construct orchestration.
 *
 * Runs a real multi-specialist orchestration so MCP hosts with no subagent
 * primitive (VS Code/Copilot, Cursor) reach orchestrated outcomes through a tool
 * they already expose. The engine is the in-process orchestration runtime
 * (lib/orchestration/runtime.mjs) — solo runs need no daemon, no port, no token
 * (ADR-0022: the engine owns orchestration; ADR-0041 owned loop). When
 * CONSTRUCT_ORCHESTRATION_URL points at a remote/team orchestration service the
 * same call is proxied over HTTP instead, with the bearer token resolved from the
 * Construct env (CONSTRUCT_ORCHESTRATION_TOKEN / CONSTRUCT_DASHBOARD_TOKEN), not
 * from the dashboard server.
 */

import { runOrchestration, startRun, getRun, getRuns } from '../../orchestration/runtime.mjs';
import { governWebResults } from './web-search-governance.mjs';

const TERMINAL = ['completed', 'completed-with-failures', 'cancelled', 'error'];

function shapeRun(run) {
  const allPrepared = Array.isArray(run.tasks) && run.tasks.length > 0 && run.tasks.every((t) => t.status === 'prepared');
  return {
    runId: run.runId,
    status: allPrepared ? 'completed-prepare-only' : run.status,
    prepareOnly: allPrepared,
    semantics: run.semantics ?? null,
    executionMode: run.execution?.executionMode,
    degraded: run.degraded ?? run.execution?.degraded ?? false,
    degradationReason: run.degradationReason ?? run.execution?.degradationReason ?? null,
    intent: run.plan?.intent ?? null,
    track: run.plan?.track ?? null,
    suggestedWorkflowType: run.plan?.suggestedWorkflowType ?? null,
    researchExecutionPolicy: run.plan?.researchExecutionPolicy ?? null,
    specialists: run.plan?.specialists ?? [],
    tasks: (run.tasks || []).map((t) => ({
      id: t.id, role: t.role, status: t.status, executor: t.executor,
      output: t.output ?? null, reasoning: t.reasoning ?? null, error: t.error ?? null,
      // ADR-0050: which web grant reached the web, the F08-governed evidence, and search count.
      webCapability: t.webCapability ?? null,
      webEvidence: t.webEvidence ?? null,
      webSearchRequests: t.webSearchRequests ?? 0,
    })),
  };
}

// Fail-closed remote ingress guard (ADR-0050): the remote orchestration service is
// out-of-repo and cannot be trusted to govern. Re-run every task's webEvidence through
// the single F08 grader so a citation can never arrive trusted or ungoverned, and mark the
// run degraded if any item was not already trust:'untrusted' with a valid Admiralty grade.

export function governRemoteWebEvidence(run, now = Date.now()) {
  let tampered = false;
  for (const t of run.tasks || []) {
    if (!Array.isArray(t.webEvidence) || t.webEvidence.length === 0) continue;
    if (t.webEvidence.some((e) => e?.trust !== 'untrusted' || !/^[A-F][1-6]$/.test(e?.admiralty || ''))) tampered = true;
    t.webEvidence = governWebResults(t.webEvidence, { now });
  }
  if (tampered) {
    run.degraded = true;
    run.degradationReason = run.degradationReason || 'remote-web-evidence-regoverned';
  }
  return run;
}

function toRequest(args) {
  return {
    request: args.request,
    workflowType: args.workflow_type,
    requestedStrategy: args.requested_strategy ?? 'auto',
    host: args.host,
    hostModel: args.host_model,
    hostProvider: args.host_provider,
    fileCount: args.file_count,
    moduleCount: args.module_count,
  };
}

// A remote orchestration service is opt-in: only when CONSTRUCT_ORCHESTRATION_URL
// is set (team / enterprise). The token comes from the Construct env, not from
// the dashboard server, so the in-process default path carries no dashboard coupling.

function remoteService(env) {
  const url = env.CONSTRUCT_ORCHESTRATION_URL;
  if (!url) return null;
  const token = env.CONSTRUCT_ORCHESTRATION_TOKEN || env.CONSTRUCT_DASHBOARD_TOKEN || null;
  return { base: url.replace(/\/$/, ''), token };
}

function unreachable(base, detail) {
  return {
    error: `Remote orchestration service not reachable at ${base}: ${detail}. Unset CONSTRUCT_ORCHESTRATION_URL to run in-process, or start the service and retry.`,
    service: base,
    failFast: true,
  };
}

export async function orchestrationRun(args = {}, { env = process.env, cwd = process.cwd(), fetchImpl = fetch } = {}) {
  const { request, worker_backend, wait = true, timeout_ms = 120000 } = args;
  if (!request || typeof request !== 'string') {
    return { error: 'Missing "request" string describing the work to orchestrate.' };
  }

  const reqObj = toRequest(args);
  const remote = remoteService(env);
  if (remote) return runViaService(remote, reqObj, { wait, timeout_ms, workerBackend: worker_backend, fetchImpl });

  const opts = { env, cwd, workerBackend: worker_backend, fetchImpl };
  try {
    if (!wait) {
      const planned = await startRun(reqObj, opts);
      return { runId: planned.runId, status: planned.status, executionMode: planned.execution?.executionMode, poll: 'orchestration_status with run_id' };
    }
    return shapeRun(await runOrchestration(reqObj, opts));
  } catch (err) {
    return { error: `Orchestration failed: ${err.message}`, failFast: true };
  }
}

export async function orchestrationStatus(args = {}, { env = process.env, cwd = process.cwd(), fetchImpl = fetch } = {}) {
  const { run_id, limit = 20 } = args;
  const remote = remoteService(env);
  if (remote) return statusViaService(remote, { run_id, limit }, { fetchImpl });
  try {
    if (run_id) {
      const run = await getRun(cwd, run_id, { env });
      return run || { error: `No run found with id ${run_id}.` };
    }
    return await getRuns(cwd, { env, limit });
  } catch (err) {
    return { error: `Failed to read orchestration runs: ${err.message}` };
  }
}

// Remote (team / enterprise) HTTP path. Reached only when CONSTRUCT_ORCHESTRATION_URL
// is set; the wire shape matches the standalone orchestration service's
// /api/orchestration/runs contract (ADR-0022).

// Per-request AbortSignal so a single hung fetch cannot stall runViaService
// past a deterministic window even before the poll loop's overall deadline check.

function timedRemoteFetch(fetchImpl, url, opts, perRequestMs) {
  const signal = AbortSignal.timeout(perRequestMs);
  return Promise.race([
    fetchImpl(url, { ...opts, signal }),
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason ?? new Error(`remote orchestration fetch timed out after ${perRequestMs}ms`)), { once: true })),
  ]);
}

async function runViaService(remote, reqObj, { wait, timeout_ms, workerBackend, fetchImpl, perRequestTimeoutMs = 200 }) {
  const { base, token } = remote;
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const body = JSON.stringify({ ...reqObj, workerBackend });
  let started;
  try {
    const res = await timedRemoteFetch(fetchImpl, `${base}/api/orchestration/runs`, { method: 'POST', headers, body }, perRequestTimeoutMs);
    if (res.status === 401 || res.status === 403) {
      return { error: `Remote service rejected the request (HTTP ${res.status}). Set CONSTRUCT_ORCHESTRATION_TOKEN (or CONSTRUCT_DASHBOARD_TOKEN).`, service: base, failFast: true };
    }
    const envelope = await res.json();
    if (!res.ok) return { error: `Remote service error (HTTP ${res.status}): ${envelope.error || 'unknown'}`, service: base };
    started = envelope.data;
  } catch (err) {
    return unreachable(base, err.message);
  }

  if (!wait) {
    return { runId: started.runId, status: started.status, executionMode: started.execution?.executionMode, service: base, poll: 'orchestration_status with run_id' };
  }

  const deadline = Date.now() + timeout_ms;
  let run = started;
  while (!TERMINAL.includes(run.status)) {
    if (Date.now() > deadline) {
      return { runId: started.runId, status: run.status, timedOut: true, service: base, note: 'Run is still executing; poll it with orchestration_status.' };
    }
    await new Promise((r) => setTimeout(r, 250));
    try {
      const res = await timedRemoteFetch(fetchImpl, `${base}/api/orchestration/runs/${encodeURIComponent(started.runId)}`, { headers }, perRequestTimeoutMs);
      const envelope = await res.json();
      if (!res.ok) return { error: `Remote service error while polling (HTTP ${res.status}): ${envelope.error || 'unknown'}`, runId: started.runId, service: base };
      run = envelope.data;
    } catch (err) {
      return { error: `Lost connection to the remote service while polling run ${started.runId}: ${err.message}`, runId: started.runId, service: base, failFast: true };
    }
  }
  return { ...shapeRun(governRemoteWebEvidence(run)), service: base };
}

async function statusViaService(remote, { run_id, limit }, { fetchImpl }) {
  const { base, token } = remote;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const path = run_id ? `/api/orchestration/runs/${encodeURIComponent(run_id)}` : `/api/orchestration/runs?limit=${encodeURIComponent(limit)}`;
  try {
    const res = await fetchImpl(`${base}${path}`, { headers });
    const envelope = await res.json();
    if (!res.ok) return { error: `Remote service error (HTTP ${res.status}): ${envelope.error || 'unknown'}`, service: base };
    return envelope.data;
  } catch (err) {
    return unreachable(base, err.message);
  }
}
