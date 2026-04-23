#!/usr/bin/env node
/**
 * lib/hooks/agent-tracker.mjs — Agent task lifecycle hook — tracks task start, completion, and handoffs.
 *
 * Runs as PostToolUse after Agent tool calls. Records agent invocations and their outcomes to ~/.cx/agent-log.json for telemetry and performance review.
 *
 * @p95ms 10
 * @maxBlockingScope none (PostToolUse, non-blocking)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const toolName = input?.tool_name || '';
if (toolName !== 'Task') process.exit(0);

const toolInput = input?.tool_input || {};
const cwd = input?.cwd || process.cwd();

// Extract agent identity from the Task tool input.
// Claude Code passes subagent_type or description in tool_input.
const agentType = toolInput?.subagent_type || toolInput?.agent || null;
const description = toolInput?.description || toolInput?.prompt || '';

// Prefer subagent_type (e.g. "cx-engineer"), fall back to first cx-* token in description.
let agentName = agentType;
if (!agentName) {
  const descMatch = /^(cx-[a-z-]+|construct)/i.exec(description.trim());
  agentName = descMatch ? descMatch[1].toLowerCase() : 'subagent';
}

// Load active task key from workflow
let taskKey = null;
try {
  const wf = JSON.parse(readFileSync(join(cwd, '.cx', 'workflow.json'), 'utf8'));
  taskKey = wf.currentTaskKey || null;
} catch { /* no workflow */ }

try {
  const home = homedir();
  mkdirSync(join(home, '.cx'), { recursive: true });
  writeFileSync(
    join(home, '.cx', 'last-agent.json'),
    JSON.stringify({ agent: agentName, taskKey, ts: new Date().toISOString() }),
  );
} catch { /* best effort */ }

process.exit(0);
