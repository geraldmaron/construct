#!/usr/bin/env node
/**
 * lib/hooks/mcp-task-scope.mjs — MCP task scope hook — constrains MCP tool use to the active workflow task scope.
 *
 * Runs as PreToolUse on MCP tool calls. Reads the active workflow task and warns when MCP tools are used outside the declared task scope.
 */
// PreToolUse(mcp__*) — task-aware MCP scope advisor.
// Reads the active workflow task's mcpScope field.
// Warns (non-blocking) if calling an MCP not declared for the active task.
// Exceeds OmO's per-task scoped MCPs: adds attribution, guidance, and audit trail
// without requiring runtime MCP lifecycle management.
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const cwd = input?.cwd || process.cwd();
const toolName = input?.tool_name || '';

const match = toolName.match(/^mcp__([^_]+(?:__[^_]+)*)__/);
if (!match) process.exit(0);
const mcpServer = match[1].replace(/__/g, '-');

const workflowPath = join(cwd, '.cx', 'workflow.json');
if (!existsSync(workflowPath)) process.exit(0);

try {
  const wf = JSON.parse(readFileSync(workflowPath, 'utf8'));
  const activeTaskKey = wf.currentTaskKey;
  if (!activeTaskKey) process.exit(0);

  const task = (wf.tasks || []).find(t => t.key === activeTaskKey);
  if (!task?.mcpScope || task.mcpScope.length === 0) process.exit(0);

  const scope = task.mcpScope;
  const inScope = scope.some(s => mcpServer.includes(s) || s.includes(mcpServer));

  if (!inScope) {
    process.stderr.write(
      `[mcp-scope] ${mcpServer} is not in mcpScope for task "${activeTaskKey}".\n` +
      `[mcp-scope] Declared scope: ${scope.join(', ')}. Proceeding — verify this call is intentional.\n`
    );
  }
} catch { /* best effort */ }

process.exit(0);
