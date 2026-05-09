/**
 * lib/hooks/probe-before-read.js — Enforce probe-before-read discipline.
 *
 * PreToolUse hook on the Read tool.
 * Checks recent tool call history for a size probe (Glob, wc -l, or limit:50 probe).
 * If missing and limit > 200, injects an additionalContext note.
 * Fires once per session per agent, not every read.
 *
 * @p95ms 20
 * @maxBlockingScope PreToolUse
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'node:path';
import { homedir } from 'os';

const CX_DIR = join(homedir(), '.cx');
const HISTORY_PATH = join(CX_DIR, 'read-history.json');
const MAX_PROBE_HISTORY = 10;
const PROBE_TOOLS = ['Glob', 'LS', 'Bash']; // tools that can probe file size
const LARGE_READ_THRESHOLD = 200; // lines

function readHistory() {
  try {
    if (!existsSync(HISTORY_PATH)) return [];
    const data = JSON.parse(readFileSync(HISTORY_PATH, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeHistory(history) {
  try {
    const { mkdirSync } = require('fs');
    mkdirSync(CX_DIR, { recursive: true });
    writeFileSync(HISTORY_PATH, JSON.stringify(history.slice(-MAX_PROBE_HISTORY)));
  } catch { /* best effort */ }
}

function hasRecentProbe(toolHistory, filePath) {
  // Check if we recently probed this file
  const recentTools = toolHistory.slice(-5); // last 5 tool calls
  
  for (const entry of recentTools) {
    if (!PROBE_TOOLS.includes(entry.tool)) continue;
    
    // Check if the tool call referenced this file
    const args = entry.args || {};
    const toolInput = JSON.stringify(args).toLowerCase();
    const lowerPath = filePath.toLowerCase();
    
    if (toolInput.includes(lowerPath)) return true;
  }
  
  return false;
}

function hasProbeForRead(toolInput) {
  // Check if this Read call has its own probe (limit <= LARGE_READ_THRESHOLD)
  const limit = toolInput?.limit;
  if (Number(limit) <= LARGE_READ_THRESHOLD) return true;
  
  // Check if toolInput has a probe-like field
  if (toolInput?.offset && !toolInput?.limit) return true; // reading from offset suggests probing
  return false;
}

// Main hook logic
let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const toolName = input?.tool_name;
const toolInput = input?.tool_input;

// Only process Read tool
if (toolName !== 'Read') process.exit(0);

const filePath = toolInput?.file_path || '';
const limit = toolInput?.limit;

// Skip if no file path or limit is small
if (!filePath || Number(limit) <= LARGE_READ_THRESHOLD) process.exit(0);

// Check session state
const history = readHistory();
const sessionKey = input?.session_id || 'default';

// Check if we already warned this session
if (history.some(e => e.session === sessionKey && e.warnedFor === filePath)) {
  process.exit(0);
}

// Check recent tool history for probe
const recentHistory = history.slice(-MAX_PROBE_HISTORY);
if (hasRecentProbe(recentHistory, filePath) process.exit(0);
if (hasProbeForRead(toolInput)) process.exit(0);

// No probe found — inject warning
const message = `[read-efficiency] Read of ${filePath} with limit=${limit} — no prior size probe detected. ` +
  `Consider adding a probe step (Glob, wc -l, or limit:50) before reading large files.`;

// Record that we warned
history.push({
  session: sessionKey,
  tool: toolName,
  warnedFor: filePath,
  ts: Date.now(),
});
writeHistory(history);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    additionalContext: message,
  },
}));

process.exit(0);
