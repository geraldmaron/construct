/**
 * lib/server/chat.mjs — Dashboard chat endpoint handler.
 *
 * Handles POST /api/chat (non-streaming JSON) and GET /api/chat/stream (SSE).
 * Shells out to the `claude --print` CLI and streams the response back as
 * Server-Sent Events. Returns a structured fallback if the CLI is unavailable.
 *
 * Message history is kept per conversation ID in memory (cleared on restart).
 * The client sends { id?, message } — omitting id starts a new conversation.
 */

import { spawn, execSync } from 'child_process';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const HOME = homedir();
const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── Session-end optimize hook ──────────────────────────────────────────────
// After a chat session closes, check whether enough new quality scores have
// accumulated in the performance review to warrant running optimize.
// Fires asynchronously — never blocks the response.

let _sessionsSinceOptimize = 0;
const OPTIMIZE_EVERY_N_SESSIONS = parseInt(process.env.CX_OPTIMIZE_INTERVAL ?? '5', 10);

function maybeRunOptimize() {
  _sessionsSinceOptimize++;
  if (_sessionsSinceOptimize < OPTIMIZE_EVERY_N_SESSIONS) return;
  _sessionsSinceOptimize = 0;

  // Spawn optimize --list to see if any agents are below threshold
  const script = join(ROOT_DIR, 'scripts', 'optimize.mjs');
  if (!existsSync(script)) return;

  const proc = spawn(process.execPath, [script, '--list', '--threshold=0.7'], {
    cwd: ROOT_DIR,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  proc.stdout.on('data', d => { out += d; });
  proc.on('close', () => {
    // Find agents flagged below threshold and run optimize on each
    const flagged = out.split('\n')
      .filter(l => l.includes('← below threshold'))
      .map(l => l.trim().split(/\s+/)[0])
      .filter(Boolean);

    for (const agent of flagged) {
      const opt = spawn(process.execPath, [script, agent, `--threshold=0.7`], {
        cwd: ROOT_DIR,
        env: { ...process.env },
        stdio: 'ignore',
        detached: true,
      });
      opt.unref();
    }
  });
  proc.unref();
}

// ── Conversation store ─────────────────────────────────────────────────────
const conversations = new Map();
const CONV_TTL_MS = 2 * 60 * 60 * 1000;

function pruneConversations() {
  const now = Date.now();
  for (const [id, conv] of conversations) {
    if (now - conv.lastAt > CONV_TTL_MS) conversations.delete(id);
  }
}

export function getOrCreateConversation(id) {
  pruneConversations();
  if (id && conversations.has(id)) {
    const conv = conversations.get(id);
    conv.lastAt = Date.now();
    return conv;
  }
  const newId = randomBytes(12).toString('hex');
  const conv = { id: newId, messages: [], createdAt: Date.now(), lastAt: Date.now() };
  conversations.set(newId, conv);
  return conv;
}

// ── CLI detection ──────────────────────────────────────────────────────────

let _cliCmd = undefined; // undefined = not yet checked, false = not found, string = found

function detectCli() {
  if (_cliCmd !== undefined) return _cliCmd;
  for (const cmd of ['claude', 'anthropic']) {
    try {
      execSync(`which ${cmd}`, { stdio: 'ignore' });
      _cliCmd = cmd;
      return _cliCmd;
    } catch { /* not found */ }
  }
  _cliCmd = false;
  return _cliCmd;
}

// Read-only Construct MCP tools that are pre-authorized in dashboard chat.
// Destructive tools (storage_reset, delete_ingested_artifacts, ingest_document)
// are deliberately omitted and still require explicit approval.
const ALLOWED_CONSTRUCT_TOOLS = [
  'mcp__construct-mcp__provider_fetch',
  'mcp__construct-mcp__knowledge_search',
  'mcp__construct-mcp__memory_search',
  'mcp__construct-mcp__memory_recent',
  'mcp__construct-mcp__project_context',
  'mcp__construct-mcp__session_list',
  'mcp__construct-mcp__session_load',
  'mcp__construct-mcp__session_search',
  'mcp__construct-mcp__agent_health',
  'mcp__construct-mcp__storage_status',
  'mcp__construct-mcp__list_skills',
  'mcp__construct-mcp__get_skill',
  'mcp__construct-mcp__list_templates',
  'mcp__construct-mcp__get_template',
  'mcp__construct-mcp__list_teams',
  'mcp__construct-mcp__get_team',
  'mcp__construct-mcp__agent_contract',
  'mcp__construct-mcp__orchestration_policy',
  'mcp__construct-mcp__search_skills',
  'mcp__construct-mcp__efficiency_snapshot',
  'mcp__construct-mcp__session_usage',
  'mcp__construct-mcp__list_schema_artifacts',
  'mcp__construct-mcp__extract_document_text',
  'mcp__construct-mcp__summarize_diff',
  'mcp__construct-mcp__scan_file',
  'Read', 'Glob', 'Grep',
];

function buildCliArgs() {
  return [
    '--print',
    '--permission-mode', 'default',
    '--allowedTools', ...ALLOWED_CONSTRUCT_TOOLS,
  ];
}

// ── Prompt builder ─────────────────────────────────────────────────────────

function buildPrompt(messages, newMessage, rootDir) {
  const lines = [];

  // Attach project context prefix on first message
  if (messages.length === 0) {
    lines.push(
      '[System]',
      'You are Construct, the operator-facing chat for this project. The MCP tools',
      '`provider_fetch`, `knowledge_search`, `memory_search`, `memory_recent`,',
      '`project_context`, and `session_*` are pre-authorized read-only lookups.',
      'Call them directly without asking for approval. They route to the configured',
      'GitHub/Jira/Slack/local sources via authority-guarded providers.',
      'For "what is X" / "tell me about X" queries about a project name, repo, or',
      'concept, your first action is `provider_fetch({ query: "<user query>" })`.',
      '',
    );
    const contextFile = join(rootDir || process.cwd(), '.cx', 'context.md');
    if (existsSync(contextFile)) {
      try {
        const ctx = readFileSync(contextFile, 'utf8').slice(0, 1500);
        lines.push(`[Project context]\n${ctx}\n`);
      } catch { /* ignore */ }
    }
  }

  // Include last 6 turns of history
  for (const m of messages.slice(-6)) {
    lines.push(`${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`);
  }
  lines.push(`Human: ${newMessage}`, '', 'Assistant:');
  return lines.join('\n');
}

// ── SSE helpers ────────────────────────────────────────────────────────────

function sseWrite(res, type, text, id) {
  res.write(`data: ${JSON.stringify({ type, text, id })}\n\n`);
}

function cliMissingResponse(res, conv) {
  sseWrite(res, 'chunk',
    '**Construct chat** requires the `claude` CLI.\n\n' +
    'Install: `npm install -g @anthropic-ai/claude-code`\n\n' +
    'Then authenticate once with `claude` before using the dashboard chat.',
    conv.id);
  sseWrite(res, 'done', '', conv.id);
  conv.messages.push({ role: 'assistant', content: '[claude CLI not available]' });
  res.end();
}

// ── Handlers ───────────────────────────────────────────────────────────────

/**
 * GET /api/chat/stream?message=<text>[&id=<convId>]
 * Streams response as SSE: data: { type, text, id }
 *   type = 'chunk' | 'done' | 'error'
 */
export function handleChatStream(req, res, { rootDir } = {}) {
  const url = new URL(req.url, 'http://localhost');
  const message = url.searchParams.get('message');
  const convId = url.searchParams.get('id') || undefined;

  if (!message) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'message query param required' }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const conv = getOrCreateConversation(convId);
  conv.messages.push({ role: 'user', content: message });

  const cli = detectCli();
  if (!cli) { cliMissingResponse(res, conv); return; }

  const prompt = buildPrompt(conv.messages.slice(0, -1), message, rootDir);
  const proc = spawn(cli, buildCliArgs(), {
    cwd: rootDir || process.cwd(),
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  proc.stdin.write(prompt);
  proc.stdin.end();

  let fullResponse = '';

  proc.stdout.on('data', chunk => {
    const text = chunk.toString();
    fullResponse += text;
    sseWrite(res, 'chunk', text, conv.id);
  });

  proc.on('close', code => {
    if (code !== 0 && !fullResponse) {
      sseWrite(res, 'error', `Chat exited with code ${code}. Check that \`claude\` is authenticated.`, conv.id);
    } else {
      sseWrite(res, 'done', '', conv.id);
    }
    conv.messages.push({ role: 'assistant', content: fullResponse || '[no response]' });
    res.end();
    maybeRunOptimize();
  });

  proc.on('error', err => {
    sseWrite(res, 'error', 'Failed to start chat: ' + err.message, conv.id);
    res.end();
  });

  req.on('close', () => { try { proc.kill(); } catch { /* ignore */ } });
}

/**
 * POST /api/chat — non-streaming, full response as JSON.
 * Body: { id?, message }  →  { id, reply }
 */
export function handleChat(req, res, { rootDir } = {}) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const data = JSON.parse(body || '{}');
      if (!data.message) throw new Error('message required');

      const conv = getOrCreateConversation(data.id);
      conv.messages.push({ role: 'user', content: data.message });

      const cli = detectCli();
      if (!cli) {
        const reply = 'The `claude` CLI is not installed. Run: npm install -g @anthropic-ai/claude-code';
        conv.messages.push({ role: 'assistant', content: reply });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: conv.id, reply, cliMissing: true }));
        return;
      }

      const prompt = buildPrompt(conv.messages.slice(0, -1), data.message, rootDir);
      const proc = spawn(cli, buildCliArgs(), {
        cwd: rootDir || process.cwd(),
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      proc.stdin.write(prompt);
      proc.stdin.end();

      let reply = '';
      proc.stdout.on('data', c => { reply += c.toString(); });
      proc.on('close', code => {
        const text = reply.trim() || (code !== 0 ? `[exit ${code}]` : '[empty response]');
        conv.messages.push({ role: 'assistant', content: text });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: conv.id, reply: text }));
        maybeRunOptimize();
      });
      proc.on('error', err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

/**
 * GET /api/chat/history?id=<convId>
 */
export function handleChatHistory(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const id = url.searchParams.get('id');
  if (!id || !conversations.has(id)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: null, messages: [] }));
    return;
  }
  const conv = conversations.get(id);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ id: conv.id, messages: conv.messages }));
}
