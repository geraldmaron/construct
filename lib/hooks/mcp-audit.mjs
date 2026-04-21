#!/usr/bin/env node
/**
 * lib/hooks/mcp-audit.mjs — MCP audit hook — logs all MCP tool calls for observability and review.
 *
 * Runs as PostToolUse on MCP tool calls. Records tool name, input, and output summary to ~/.cx/mcp-audit.json for telemetry and security review.
 */
// PostToolUse(mcp__*) — audits every MCP tool call against the active workflow task.
// Writes .cx/mcp-audit.json: per-server call log with task attribution.
// Gives per-task MCP usage visibility that per-task scoped MCPs (OmO) cannot provide.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const cwd = input?.cwd || process.cwd();
const toolName = input?.tool_name || '';

const match = toolName.match(/^mcp__([^_]+(?:__[^_]+)*)__(.+)$/);
if (!match) process.exit(0);

const mcpServer = match[1].replace(/__/g, '-');
const mcpTool = match[2];

// Get active task key from workflow
let activeTaskKey = null;
let activeTaskTitle = null;
try {
  const wf = JSON.parse(readFileSync(join(cwd, '.cx', 'workflow.json'), 'utf8'));
  activeTaskKey = wf.currentTaskKey || null;
  if (activeTaskKey) {
    const t = (wf.tasks || []).find(t => t.key === activeTaskKey);
    activeTaskTitle = t?.title || null;
  }
} catch { /* no workflow */ }

const auditPath = join(cwd, '.cx', 'mcp-audit.json');
let audit = {};
try { audit = JSON.parse(readFileSync(auditPath, 'utf8')); } catch { /* fresh */ }

if (!audit[mcpServer]) audit[mcpServer] = [];
audit[mcpServer].push({
  tool: mcpTool,
  ts: new Date().toISOString(),
  taskKey: activeTaskKey,
  taskTitle: activeTaskTitle,
});

// Keep last 200 per server
if (audit[mcpServer].length > 200) audit[mcpServer] = audit[mcpServer].slice(-200);

try {
  mkdirSync(join(cwd, '.cx'), { recursive: true });
  writeFileSync(auditPath, JSON.stringify(audit, null, 2));
} catch { /* best effort */ }

process.exit(0);
