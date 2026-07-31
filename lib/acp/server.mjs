/**
 * lib/acp/server.mjs — Construct as an Agent Client Protocol (ACP) server.
 *
 * ACP (agentclientprotocol.com) is the editor↔agent standard that lets Zed,
 * JetBrains, and the VS Code ACP client drive any agent over JSON-RPC 2.0 on
 * stdio. This makes Construct a first-class native agent in those editors: an
 * ACP `session/prompt` runs a real multi-specialist orchestration via the same
 * engine the daemon and the MCP tool use — the editor is a thin
 * client, Construct owns the loop.
 *
 * Framing is newline-delimited JSON (one JSON-RPC message per line). Supported
 * methods: `initialize`, `session/new`, `session/prompt`, `session/cancel`;
 * progress streams as `session/update` notifications. The prompt bridges to
 * planRun/executeRun and forwards run-lifecycle events as agent message chunks.
 *
 * `fetchImpl` is injectable (mirrors lib/orchestration/worker.mjs) and threads
 * straight through to executeRun, so a test can drive the provider backend
 * without a live key or a real network call.
 */

import { createInterface } from 'node:readline';

const PROTOCOL_VERSION = 1;

function describeEvent(event) {
  if (event.type === 'planned') return `Planned ${event.tasks ?? ''} specialist task(s).`;
  if (event.type === 'running') return `Running orchestration… (workerBackend=${event.workerBackend ?? 'inline'})`;
  if (event.type === 'task') return `· ${event.role ?? 'task'} — ${event.status ?? ''}${event.executor ? ` (${event.executor})` : ''}`;
  if (event.type === 'completed') {
    const status = event.status ?? 'done';
    if (status === 'completed') return 'Completed (specialist tasks executed).';
    if (status === 'completed-prepare-only') return 'Completed (tasks prepared only — no specialist execution).';
    if (status === 'completed-with-failures') return 'Completed with failures (some tasks failed).';
    if (status === 'degraded') return 'Degraded — the run could not fully execute; see the summary.';
    if (status === 'cancelled') return 'Cancelled.';
    return `Completed: ${status}.`;
  }
  if (event.type === 'error') return `Error: ${event.error?.message ?? 'run failed'}.`;
  return null;
}

function summarize(run) {
  const tasks = (run.tasks || []).map((t) => `- ${t.role} (${t.status}${t.executor ? `, ${t.executor}` : ''})`).join('\n');
  const exec = run.execution || {};
  const degraded = run.degraded ? ` — degraded: ${run.degradationReason}` : '';
  return `Orchestration ${run.status} — executionMode=${exec.executionMode}, workerBackend=${run.workerBackend}${degraded}.\n${tasks}`;
}

function textFromPrompt(prompt) {
  if (!Array.isArray(prompt)) return '';
  return prompt.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim();
}

export function runAcpServer({ input, output, env = process.env, defaultCwd = process.cwd(), fetchImpl } = {}) {
  const sessions = new Map();
  let sessionCounter = 0;

  const write = (msg) => output.write(`${JSON.stringify(msg)}\n`);
  const respond = (id, result) => write({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });
  const notify = (method, params) => write({ jsonrpc: '2.0', method, params });
  const update = (sessionId, text) => notify('session/update', { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } });

  async function handlePrompt(id, params) {
    const sessionId = params?.sessionId;
    const session = sessions.get(sessionId);
    if (!session) return fail(id, -32602, `Unknown sessionId: ${sessionId}`);
    const text = textFromPrompt(params?.prompt);
    if (!text) return fail(id, -32602, 'prompt has no text content');

    const { planRun, executeRun } = await import('../orchestration/runtime.mjs');
    const { onRunEvent, isCancelRequested } = await import('../orchestration/events.mjs');
    try {
      const planned = await planRun({ request: text, requestedStrategy: 'orchestrated' }, { env, cwd: session.cwd });
      session.runId = planned.runId;
      const off = onRunEvent(planned.runId, (event) => {
        const line = describeEvent(event);
        if (line) update(sessionId, line);
      });
      const run = await executeRun(session.cwd, planned.runId, { env, fetchImpl });
      off();
      update(sessionId, summarize(run));
      respond(id, { stopReason: isCancelRequested(planned.runId) ? 'cancelled' : 'end_turn' });
    } catch (err) {
      update(sessionId, `Error: ${err.message}`);
      respond(id, { stopReason: 'refusal' });
    }
  }

  async function dispatch(msg) {
    const { id, method, params } = msg;
    if (method === 'initialize') {
      respond(id, {
        protocolVersion: typeof params?.protocolVersion === 'number' ? params.protocolVersion : PROTOCOL_VERSION,
        agentCapabilities: { promptCapabilities: { image: false, audio: false, embeddedContext: true } },
        authMethods: [],
      });
      return;
    }
    if (method === 'session/new') {
      const sessionId = `acp-${++sessionCounter}`;
      sessions.set(sessionId, { cwd: params?.cwd || defaultCwd, runId: null });
      respond(id, { sessionId });
      return;
    }
    if (method === 'session/prompt') { await handlePrompt(id, params); return; }
    if (method === 'session/cancel') {
      const session = sessions.get(params?.sessionId);
      if (!session) return fail(id, -32602, `Unknown sessionId: ${params?.sessionId}`);
      if (session.runId) {
        const { requestCancel } = await import('../orchestration/events.mjs');
        requestCancel(session.runId);
      }
      respond(id, {});
      return;
    }
    if (id !== undefined) fail(id, -32601, `Method not found: ${method}`);
  }

  const rl = createInterface({ input, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try { msg = JSON.parse(trimmed); } catch { return; }
    Promise.resolve(dispatch(msg)).catch((err) => {
      if (msg?.id !== undefined) fail(msg.id, -32603, err.message);
    });
  });

  return { close: () => rl.close() };
}
