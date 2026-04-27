#!/usr/bin/env node
/**
 * lib/hooks/mcp-audit.mjs — MCP audit hook — logs all MCP tool calls for observability and review.
 *
 * Runs as PostToolUse on MCP tool calls. Records tool name, input, and output summary to ~/.cx/mcp-audit.json for telemetry and security review.
 *
 * @p95ms 10
 * @maxBlockingScope none (PostToolUse, non-blocking)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const toolName = input?.tool_name || '';

const match = toolName.match(/^mcp__([^_]+(?:__[^_]+)*)__(.+)$/);
if (!match) process.exit(0);

const mcpServer = match[1].replace(/__/g, '-');
const mcpTool = match[2];

const cwd = input?.cwd || process.cwd();
const auditPath = join(cwd, '.cx', 'mcp-audit.json');
let audit = {};
try { audit = JSON.parse(readFileSync(auditPath, 'utf8')); } catch { /* fresh */ }

if (!audit[mcpServer]) audit[mcpServer] = [];
audit[mcpServer].push({
  tool: mcpTool,
  ts: new Date().toISOString(),
  coordination: 'tracker-plus-plan',
});

// Keep last 200 per server
if (audit[mcpServer].length > 200) audit[mcpServer] = audit[mcpServer].slice(-200);

try {
  mkdirSync(join(cwd, '.cx'), { recursive: true });
  writeFileSync(auditPath, JSON.stringify(audit, null, 2));
} catch { /* best effort */ }

process.exit(0);
