#!/usr/bin/env node
/**
 * lib/hooks/bootstrap-guard.mjs — enforce start-of-session bootstrap trio.
 *
 * Blocks Write/Edit/MultiEdit/NotebookEdit/TodoWrite and destructive Bash
 * until the session has invoked workflow_status + project_context + memory_search
 * (or accumulated 3+ read-style tool calls, the equivalent signal that the
 * agent has grounded itself before acting).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf8')) || {}; } catch { process.exit(0); }

const sessionId = payload.session_id || payload.sessionId || 'default';
const toolName = payload.tool_name || payload.tool || '';
const toolInput = payload.tool_input || payload.toolInput || {};

const BOOTSTRAP_TOOLS = new Set([
  'mcp__construct-mcp__workflow_status',
  'mcp__construct-mcp__project_context',
  'mcp__construct-mcp__memory_search',
  'mcp__cass__memory_search',
  'workflow_status', 'project_context', 'memory_search',
]);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']);
const BLOCKED_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'TodoWrite']);
const COMPATIBLE_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']);

const BENIGN_BASH = /^(git (status|log|diff|branch|show|rev-parse)|ls|cat|head|tail|pwd|wc|file|echo|which|node --version|npm --version)\b/;

const stateDir = join(homedir(), '.cx');
const statePath = join(stateDir, 'bootstrap-state.json');

let state = {};
if (existsSync(statePath)) {
  try { state = JSON.parse(readFileSync(statePath, 'utf8')) || {}; } catch { state = {}; }
}

const now = Date.now();
for (const [k, v] of Object.entries(state)) {
  if (!v?.ts || now - v.ts > 24 * 60 * 60 * 1000) delete state[k];
}

const s = state[sessionId] || { ts: now, reads: 0, bootstrap: new Set(), done: false };
if (Array.isArray(s.bootstrap)) s.bootstrap = new Set(s.bootstrap);
else if (!(s.bootstrap instanceof Set)) s.bootstrap = new Set();
s.ts = now;

if (BOOTSTRAP_TOOLS.has(toolName)) s.bootstrap.add(toolName.replace(/^.*__/, ''));
if (READ_TOOLS.has(toolName)) s.reads = (s.reads || 0) + 1;

if (!s.done) {
  const hasTrio = s.bootstrap.has('workflow_status') && s.bootstrap.has('project_context') && s.bootstrap.has('memory_search');
  if (hasTrio || (s.reads || 0) >= 3) s.done = true;
}

if (!s.done && toolName && COMPATIBLE_TOOLS.has(toolName) && (s.reads || 0) >= 2) {
  s.done = true;
}

let block = false;
let reason = '';
if (!s.done) {
  if (BLOCKED_TOOLS.has(toolName)) {
    block = true;
    reason = `${toolName} requires session bootstrap.`;
  } else if (toolName === 'Bash') {
    const cmd = (toolInput.command || '').trim();
    if (cmd && !BENIGN_BASH.test(cmd)) { block = true; reason = 'Bash mutations require session bootstrap.'; }
  }
}

try {
  mkdirSync(stateDir, { recursive: true });
  state[sessionId] = { ...s, bootstrap: Array.from(s.bootstrap) };
  writeFileSync(statePath, JSON.stringify(state));
} catch { /* best effort */ }

if (block) {
  process.stderr.write(
    `[bootstrap-guard] ${reason}\n` +
    `Run in parallel first: workflow_status, project_context, memory_search.\n` +
    `(Or do 3+ exploratory reads — Read/Grep/Glob/LS — if this is a pure exploration task.)\n`
  );
  process.exit(2);
}
process.exit(0);
