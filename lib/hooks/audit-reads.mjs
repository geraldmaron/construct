#!/usr/bin/env node
/**
 * lib/hooks/audit-reads.mjs — opt-in tamper-evident log of every Read tool call.
 *
 * Symmetric counterpart to audit-trail.mjs (which records mutations). Reads
 * are off by default because they happen much more often than writes; enable
 * with `CONSTRUCT_AUDIT_READS=1`. When enabled, every Read tool call writes
 * a single JSONL line to ~/.cx/audit-reads.jsonl with:
 *
 *   - timestamp ISO
 *   - session_id (when supplied by the harness)
 *   - tool_name (always Read)
 *   - agent (from ~/.cx/last-agent.json — falls back to "construct")
 *   - cwd
 *   - target (the file_path read)
 *   - bytes (size of the file at read time)
 *   - content_hash (sha256 of the file's first 64KiB at read time, truncated)
 *   - prev_line_hash (chained tamper-evidence — hash of previous JSONL line)
 *
 * The prev_line_hash chain means any after-the-fact reordering or deletion
 * breaks the chain and is detectable by a simple replay (same approach as
 * the mutation audit).
 *
 * @p95ms 8
 * @maxBlockingScope none (PostToolUse, non-blocking)
 */
import { readFileSync, appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { logHookFailure } from './_lib/log.mjs';

const CX_DIR = join(homedir(), '.cx');
const AUDIT_FILE = join(CX_DIR, 'audit-reads.jsonl');
const LAST_AGENT = join(CX_DIR, 'last-agent.json');
const HASH_PREFIX_BYTES = 64 * 1024;

if (process.env.CONSTRUCT_AUDIT_READS !== '1') process.exit(0);

function sha256(input) { return createHash('sha256').update(input).digest('hex'); }

function readLastAgent() {
  try {
    const data = JSON.parse(readFileSync(LAST_AGENT, 'utf8'));
    return data?.agent || data?.name || 'construct';
  } catch { return 'construct'; }
}

function readPrevLineHash() {
  try {
    if (!existsSync(AUDIT_FILE)) return null;
    const size = statSync(AUDIT_FILE).size;
    if (size === 0) return null;
    const readFrom = Math.max(0, size - 2048);
    const tail = readFileSync(AUDIT_FILE, 'utf8').slice(readFrom);
    const lines = tail.split('\n').filter(Boolean);
    if (lines.length === 0) return null;
    return sha256(lines[lines.length - 1]);
  } catch { return null; }
}

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); }
catch (err) { logHookFailure({ hook: 'audit-reads', err, phase: 'parse' }); process.exit(0); }

if ((input?.tool_name || '') !== 'Read') process.exit(0);

const cwd = input?.cwd || process.cwd();
const filePath = input?.tool_input?.file_path;
if (!filePath) process.exit(0);

const absPath = filePath.startsWith('/') ? filePath : resolve(cwd, filePath);

let bytes = null;
let contentHash = null;
try {
  if (existsSync(absPath)) {
    bytes = statSync(absPath).size;
    const buf = Buffer.alloc(Math.min(bytes, HASH_PREFIX_BYTES));
    const fd = await import('node:fs').then((m) => m.openSync(absPath, 'r'));
    const fsModule = await import('node:fs');
    fsModule.readSync(fd, buf, 0, buf.length, 0);
    fsModule.closeSync(fd);
    contentHash = sha256(buf).slice(0, 32);
  }
} catch (err) {
  logHookFailure({ hook: 'audit-reads', err, phase: 'hash', input: { filePath: absPath } });
}

const record = {
  ts: new Date().toISOString(),
  session_id: input?.session_id || null,
  tool: 'Read',
  agent: readLastAgent(),
  cwd,
  target: filePath,
  bytes,
  content_hash: contentHash,
  prev_line_hash: readPrevLineHash(),
};

try {
  mkdirSync(CX_DIR, { recursive: true });
  appendFileSync(AUDIT_FILE, JSON.stringify(record) + '\n', 'utf8');
} catch (err) {
  logHookFailure({ hook: 'audit-reads', err, phase: 'append' });
}

process.exit(0);
