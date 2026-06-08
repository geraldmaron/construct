/**
 * lib/mcp/tools/orchestration-run.mjs — MCP client for the local orchestration daemon.
 *
 * Executes a real multi-specialist run by driving the daemon's HTTP API
 * (ADR-0022), so MCP hosts with no subagent primitive — VS Code/Copilot, Cursor —
 * reach orchestrated outcomes through a tool they actually expose: the engine
 * owns orchestration; this tool is the thin client. The daemon URL resolves from
 * dashboard state (else the default loopback port) and the bearer token from
 * ~/.construct/config.env. When the daemon is unreachable the tool fails fast
 * with an actionable error rather than silently degrading to a single-persona
 * pass — the absence of an executable path is made loud, not hidden.
 */

import { readDashboardState } from '../../service-manager.mjs';
import { getDashboardToken } from '../../server/auth.mjs';

const TERMINAL = ['completed', 'completed-with-failures', 'cancelled', 'error'];

function resolveDaemon(env = process.env) {
  const state = readDashboardState();
  const base = (env.CONSTRUCT_ORCHESTRATION_URL || state?.url || `http://${env.BIND_HOST || '127.0.0.1'}:${env.PORT || '4242'}`).replace(/\/$/, '');
  return { base, token: getDashboardToken(), daemonRunning: Boolean(state) };
}

// A reachability failure is the fail-fast signal MCP hosts need: report how to
// start the engine instead of letting the host fall back to a manual pass.

function unreachable(base, detail) {
  return {
    error: `Orchestration daemon not reachable at ${base}: ${detail}. Start it with \`construct dashboard\`, then retry. The engine runs orchestration; this host is a thin client (ADR-0022).`,
    daemon: base,
    failFast: true,
  };
}

export async function orchestrationRun(args = {}, { fetchImpl = fetch, env = process.env } = {}) {
  const {
    request,
    workflow_type,
    requested_strategy = 'auto',
    worker_backend,
    host,
    host_model,
    host_provider,
    file_count,
    module_count,
    wait = true,
    timeout_ms = 120000,
  } = args;

  if (!request || typeof request !== 'string') return { error: 'Missing "request" string describing the work to orchestrate.' };

  const { base, token } = resolveDaemon(env);
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const body = JSON.stringify({
    request,
    workflowType: workflow_type,
    requestedStrategy: requested_strategy,
    workerBackend: worker_backend,
    host,
    hostModel: host_model,
    hostProvider: host_provider,
    fileCount: file_count,
    moduleCount: module_count,
  });

  let started;
  try {
    const res = await fetchImpl(`${base}/api/orchestration/runs`, { method: 'POST', headers, body });
    if (res.status === 401 || res.status === 403) {
      return { error: `Daemon rejected the request (HTTP ${res.status}). The dashboard token is missing or wrong — check CONSTRUCT_DASHBOARD_TOKEN in ~/.construct/config.env.`, daemon: base, failFast: true };
    }
    const envelope = await res.json();
    if (!res.ok) return { error: `Daemon error (HTTP ${res.status}): ${envelope.error || 'unknown'}`, daemon: base };
    started = envelope.data;
  } catch (err) {
    return unreachable(base, err.message);
  }

  if (!wait) {
    return { runId: started.runId, status: started.status, executionMode: started.execution?.executionMode, daemon: base, poll: 'orchestration_status with run_id' };
  }

  const deadline = Date.now() + timeout_ms;
  let run = started;
  while (!TERMINAL.includes(run.status)) {
    if (Date.now() > deadline) {
      return { runId: started.runId, status: run.status, timedOut: true, daemon: base, note: 'Run is still executing; poll it with orchestration_status.' };
    }
    await new Promise((r) => setTimeout(r, 250));
    try {
      const res = await fetchImpl(`${base}/api/orchestration/runs/${encodeURIComponent(started.runId)}`, { headers });
      const envelope = await res.json();
      if (!res.ok) return { error: `Daemon error while polling (HTTP ${res.status}): ${envelope.error || 'unknown'}`, runId: started.runId, daemon: base };
      run = envelope.data;
    } catch (err) {
      return { error: `Lost connection to the daemon while polling run ${started.runId}: ${err.message}`, runId: started.runId, daemon: base, failFast: true };
    }
  }

  return {
    runId: run.runId,
    status: run.status,
    executionMode: run.execution?.executionMode,
    degraded: run.execution?.degraded ?? false,
    degradationReason: run.execution?.degradationReason ?? null,
    tasks: (run.tasks || []).map((t) => ({ id: t.id, role: t.role, status: t.status, executor: t.executor, output: t.output ?? null, reasoning: t.reasoning ?? null, error: t.error ?? null })),
    daemon: base,
  };
}

export async function orchestrationStatus(args = {}, { fetchImpl = fetch, env = process.env } = {}) {
  const { run_id, limit = 20 } = args;
  const { base, token } = resolveDaemon(env);
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const path = run_id ? `/api/orchestration/runs/${encodeURIComponent(run_id)}` : `/api/orchestration/runs?limit=${encodeURIComponent(limit)}`;
  try {
    const res = await fetchImpl(`${base}${path}`, { headers });
    const envelope = await res.json();
    if (!res.ok) return { error: `Daemon error (HTTP ${res.status}): ${envelope.error || 'unknown'}`, daemon: base };
    return envelope.data;
  } catch (err) {
    return unreachable(base, err.message);
  }
}
