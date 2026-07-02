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

export function shapeRun(run) {
  const hasTasks = Array.isArray(run.tasks) && run.tasks.length > 0;
  const allPrepared = hasTasks && run.tasks.every((t) => t.status === 'prepared');
  const degraded = run.degraded ?? run.execution?.degraded ?? false;
  
  // Terminal status taxonomy (construct-fbxv.1)
  // degraded zero-task runs never report as prepared or bare 'completed'
  const shapedStatus = degraded && !hasTasks && run.status === 'completed'
    ? 'degraded'
    : allPrepared
      ? 'completed-prepare-only'
      : run.status;
  
  return {
    runId: run.runId,
    status: shapedStatus,
    prepareOnly: allPrepared,
    semantics: run.semantics ?? null,
    executionMode: run.execution?.executionMode,
    degraded,
    degradationReason: run.degradationReason ?? run.execution?.degradationReason ?? null,
    intent: run.plan?.intent ?? null,
    track: run.plan?.track ?? null,
    suggestedWorkflowType: run.plan?.suggestedWorkflowType ?? null,
    researchExecutionPolicy: run.plan?.researchExecutionPolicy ?? null,
    specialists: run.plan?.specialists ?? [],
    tasks: (run.tasks || []).map((t) => ({
      id: t.id, role: t.role, status: t.status, executor: t.executor,
      output: t.output ?? null, reasoning: t.reasoning ?? null, error: t.error ?? null,
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

// A bounded fetch timing out is not the same failure as a genuinely unreachable host
// (ORCH-004 AC3): the error text must say timeout and name the bound so a healthy but
// slow service is never misreported as network-down.

function remoteFetchFailed(base, err) {
  if (err?.name === 'RemoteFetchTimeoutError') {
    return { error: `${err.message}. Raise CONSTRUCT_ORCHESTRATION_TIMEOUT_MS if the remote service is healthy but slow.`, service: base, failFast: true };
  }
  return unreachable(base, err.message);
}

export async function orchestrationRun(args = {}, { env = process.env, cwd = process.cwd(), fetchImpl = fetch } = {}) {
  const { request, worker_backend, wait = true, timeout_ms = 120000 } = args;
  if (!request || typeof request !== 'string') {
    return { error: 'Missing "request" string describing the work to orchestrate.' };
  }

  const reqObj = toRequest(args);
  const remote = remoteService(env);
  if (remote) return runViaService(remote, reqObj, { wait, timeout_ms, workerBackend: worker_backend, fetchImpl, env });

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
  if (remote) return statusViaService(remote, { run_id, limit }, { fetchImpl, env });
  try {
    if (run_id) {
      const run = await getRun(cwd, run_id, { env });
      return run ? shapeRun(run) : { error: `No run found with id ${run_id}.` };
    }
    const runs = await getRuns(cwd, { env, limit });
    return runs.map(shapeRun);
  } catch (err) {
    return { error: `Failed to read orchestration runs: ${err.message}` };
  }
}

// Remote (team / enterprise) HTTP path. Reached only when CONSTRUCT_ORCHESTRATION_URL
// is set; the wire shape matches the standalone orchestration service's
// /api/orchestration/runs contract (ADR-0022).

// Reachability fail-fast belongs to the deadline check in the poll loop, not the
// per-request budget: a remote LLM-backed run needs a generous per-request window
// (ORCH-004; construct-o6t8.2). Default is 30s, well above the industry reachability-probe
// mistake this replaces, and short of the 600s ceiling the OpenAI/Anthropic SDKs use for
// long completions — an orchestration run/status round trip is shorter-lived than that.
// Env-overridable; parsed then defaulted so an explicit 0 is not silently treated as unset.

function parseTimeoutMs(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

function requestTimeoutMs(env) {
  return parseTimeoutMs(env.CONSTRUCT_ORCHESTRATION_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS);
}

// Per-request AbortSignal so a single hung fetch cannot stall runViaService (or a
// status poll) past a deterministic window even before the poll loop's overall
// deadline check. The rejection always names the bound and says "timeout", never
// the signal's own DOMException message ("aborted due to timeout" with no number),
// so callers can distinguish a bounded timeout from a genuinely unreachable host.

class RemoteFetchTimeoutError extends Error {
  constructor(perRequestMs) {
    super(`Remote orchestration request timed out after ${perRequestMs}ms`);
    this.name = 'RemoteFetchTimeoutError';
    this.timeoutMs = perRequestMs;
  }
}

function timedRemoteFetch(fetchImpl, url, opts, perRequestMs) {
  const signal = AbortSignal.timeout(perRequestMs);
  return Promise.race([
    fetchImpl(url, { ...opts, signal }),
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(new RemoteFetchTimeoutError(perRequestMs)), { once: true })),
  ]);
}

async function runViaService(remote, reqObj, { wait, timeout_ms, workerBackend, fetchImpl, env = process.env, perRequestTimeoutMs = requestTimeoutMs(env) } = {}) {
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
    return remoteFetchFailed(base, err);
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
      if (err?.name === 'RemoteFetchTimeoutError') {
        return { error: `${err.message} while polling run ${started.runId}. Raise CONSTRUCT_ORCHESTRATION_TIMEOUT_MS if the remote service is healthy but slow.`, runId: started.runId, service: base, failFast: true };
      }
      return { error: `Lost connection to the remote service while polling run ${started.runId}: ${err.message}`, runId: started.runId, service: base, failFast: true };
    }
  }
  return { ...shapeRun(governRemoteWebEvidence(run)), service: base };
}

// The status poll GET carries the same AbortSignal bound as the run POST (ORCH-004),
// so a service that accepts the connection but never replies cannot hang this call
// indefinitely. `timeoutMs` is overridable directly for tests; production callers
// resolve it from env the same way runViaService does.

export async function statusViaService(remote, { run_id, limit } = {}, { fetchImpl, env = process.env, timeoutMs = requestTimeoutMs(env) } = {}) {
  const { base, token } = remote;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const path = run_id ? `/api/orchestration/runs/${encodeURIComponent(run_id)}` : `/api/orchestration/runs?limit=${encodeURIComponent(limit)}`;
  try {
    const res = await timedRemoteFetch(fetchImpl, `${base}${path}`, { headers }, timeoutMs);
    const envelope = await res.json();
    if (!res.ok) return { error: `Remote service error (HTTP ${res.status}): ${envelope.error || 'unknown'}`, service: base };
    // Shape the remote data before returning
    if (Array.isArray(envelope.data)) {
      return envelope.data.map(shapeRun);
    } else if (envelope.data) {
      return shapeRun(envelope.data);
    }
    return envelope.data;
  } catch (err) {
    return remoteFetchFailed(base, err);
  }
}
