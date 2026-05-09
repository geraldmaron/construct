#!/usr/bin/env node
/**
 * lib/hooks/audit-trail.mjs — append-only audit log of every mutation Construct
 * (or any subagent it dispatches) makes.
 *
 * Runs as PostToolUse on Edit | Write | MultiEdit | NotebookEdit | Bash.
 * For Bash, only records commands that mutate state (git/npm/docker/cargo etc.
 * write operations, rm, mv, chmod). Read-only commands are skipped.
 *
 * Each record is a single JSONL line written to ~/.cx/audit-trail.jsonl with:
 *   - timestamp ISO
 *   - session_id (from hook input when available)
 *   - tool_name
 *   - agent (from ~/.cx/last-agent.json, falls back to "construct")
 *   - task metadata (from the last-agent hint when available)
 *   - cwd
 *   - target (file_path for edits/writes, command for Bash)
 *   - detail (old_string prefix + new_string prefix for Edit; truncated diff
 *             for Write; command summary for Bash)
 *   - content_hash (sha256 of post-change file for edits, null for Bash)
 *
 * @p95ms 15
 * @maxBlockingScope none (PostToolUse, non-blocking)
 */
 *   - prev_line_hash (chained tamper-evidence — hash of previous JSONL line)
 *
 * The prev_line_hash chain means any after-the-fact reordering or deletion
 * breaks the chain and is detectable by a simple replay.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const CX_DIR = join(homedir(), '.cx');
const AUDIT_FILE = join(CX_DIR, 'audit-trail.jsonl');
const LAST_AGENT = join(CX_DIR, 'last-agent.json');
const MUTATING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash']);

const BASH_MUTATING_PATTERNS = [
  /^\s*git\s+(add|commit|push|rebase|merge|reset|checkout\s+-b|branch\s+-D|tag|cherry-pick|stash\s+(?:push|drop))/,
  /^\s*(rm|mv|cp|chmod|chown|ln|mkdir|rmdir|touch|install)\b/,
  /^\s*(npm|pnpm|yarn|bun|pip|pip3|poetry|cargo|go|brew)\s+(install|add|remove|update|upgrade|uninstall|publish|link)/,
  /^\s*docker\s+(run|build|rm|rmi|push|tag|stop|kill|exec)/,
  /^\s*kubectl\s+(apply|delete|create|replace|scale|rollout)/,
  /^\s*terraform\s+(apply|destroy)/,
  /^\s*psql\b|^\s*sqlite3\b|\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b/i,
  /^\s*construct\s+(sync|setup|mcp\s+(add|remove)|init|init-docs)/,
  />\s*[^|&]|>>\s*[^|&]/, // shell redirection that writes
];

function isMutatingBash(command) {
  if (!command) return false;
  return BASH_MUTATING_PATTERNS.some((re) => re.test(command));
}

function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

function readLastAgent() {
  try {
    const raw = readFileSync(LAST_AGENT, 'utf8');
    const data = JSON.parse(raw);
    return data?.agent || data?.name || 'construct';
  } catch {
    return 'construct';
  }
}

function readPrevLineHash() {
  try {
    if (!existsSync(AUDIT_FILE)) return null;
    const size = statSync(AUDIT_FILE).size;
    if (size === 0) return null;
    const readFrom = Math.max(0, size - 2048);
    const fs = readFileSync(AUDIT_FILE, 'utf8').slice(readFrom);
    const lines = fs.split('\n').filter(Boolean);
    if (lines.length === 0) return null;
    return sha256(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

function truncateSnippet(s, limit = 280) {
  if (!s) return '';
  const str = String(s);
  return str.length <= limit ? str : str.slice(0, limit) + '…';
}

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const toolName = input?.tool_name || '';
if (!MUTATING_TOOLS.has(toolName)) process.exit(0);

const cwd = input?.cwd || process.cwd();
const toolInput = input?.tool_input || {};

let target = null;
let detail = null;
let contentHash = null;

if (toolName === 'Bash') {
  const command = String(toolInput?.command || '');
  if (!isMutatingBash(command)) process.exit(0);
  target = 'bash';
  detail = truncateSnippet(command, 400);
} else if (toolName === 'Edit') {
  target = toolInput.file_path || null;
  detail = `-- ${truncateSnippet(toolInput.old_string, 140)}\n++ ${truncateSnippet(toolInput.new_string, 140)}`;
} else if (toolName === 'Write') {
  target = toolInput.file_path || null;
  detail = `WRITE ${String(toolInput.content || '').length} chars`;
} else if (toolName === 'MultiEdit') {
  target = toolInput.file_path || null;
  const editsCount = Array.isArray(toolInput.edits) ? toolInput.edits.length : 0;
  detail = `MultiEdit ${editsCount} edits`;
} else if (toolName === 'NotebookEdit') {
  target = toolInput.notebook_path || null;
  detail = `NotebookEdit cell ${toolInput.cell_number ?? '?'}`;
}

if (!target) process.exit(0);

if (toolName !== 'Bash' && target) {
  const absPath = target.startsWith('/') ? target : resolve(cwd, target);
  try {
    if (existsSync(absPath)) {
      contentHash = sha256(readFileSync(absPath, 'utf8')).slice(0, 32);
    }
  } catch { /* best effort */ }
}

const record = {
  ts: new Date().toISOString(),
  session_id: input?.session_id || null,
  tool: toolName,
  agent: readLastAgent(),
  task: null,
  cwd,
  target,
  detail,
  content_hash: contentHash,
  prev_line_hash: readPrevLineHash(),
};

try {
  mkdirSync(CX_DIR, { recursive: true });
  appendFileSync(AUDIT_FILE, JSON.stringify(record) + '\n', 'utf8');
} catch { /* best effort — audit failure must not block the user's work */ }

process.exit(0);
