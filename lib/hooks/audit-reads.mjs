#!/usr/bin/env node
/**
 * lib/hooks/audit-reads.mjs — post-Read state tracker.
 *
 * Two responsibilities on every Read tool call:
 *
 *   1. ALWAYS — upsert a file-hash entry in ~/.cx/file-hashes.json keyed by
 *      absolute path, with the current sha256 + size + iso timestamp.
 *      Edit-guard reads the store to detect staleness on a subsequent Edit:
 *      mismatched on-disk content versus the stored hash means the Edit
 *      target needs a fresh Read. A read-tracker delta is recorded for the
 *      efficiency snapshot in the same pass.
 *
 *   2. OPT-IN — when `CONSTRUCT_AUDIT_READS=1`, write a single JSONL line
 *      to <project>/.cx/audit-reads.jsonl (falls back to ~/.cx/ outside a
 *      project) with timestamp, session_id, agent, cwd, target, bytes,
 *      content_hash, and prev_line_hash. The prev_line_hash chain makes
 *      after-the-fact reordering or deletion detectable by simple replay
 *      (symmetric counterpart to audit-trail.mjs for mutations). Bounded
 *      via the `audit-reads` channel.
 *
 * Reads happen far more often than writes, so the audit log is opt-in.
 * The hash store is always-on because edit-guard depends on it for
 * correctness, not telemetry.
 *
 * @p95ms 8
 * @maxBlockingScope none (PostToolUse, non-blocking)
 *
 * @lifecycle PostToolUse
 * @matcher  Read
 * @exits 0 = pass
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { logHookFailure } from './_lib/log.mjs';
import { appendBounded } from '../logging/rotate.mjs';
import { resolveProjectScopedPath } from '../project-root.mjs';
import { flushReadTrackerDeltas, recordReadDelta } from '../read-tracker-store.mjs';

const CX_DIR = join(homedir(), '.cx');
// audit-reads.jsonl is PROJECT-SCOPED — reads happen in a specific project,
// not across the user's whole machine. resolveProjectScopedPath returns
// <project>/.cx/audit-reads.jsonl when the hook fires from inside a
// Construct project, falling back to the legacy ~/.cx path otherwise so
// existing standalone invocations keep working.

const AUDIT_FILE = resolveProjectScopedPath('audit-reads.jsonl', { ensureDir: false });
const HASH_STORE = join(CX_DIR, 'file-hashes.json');
const LAST_AGENT = join(CX_DIR, 'last-agent.json');
const HASH_PREFIX_BYTES = 64 * 1024;
const HASH_RETENTION_MS = 2 * 60 * 60 * 1000;

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

// Stage 1 — always-on hash store update for edit-guard staleness detection.

let fullContent = null;
let bytes = null;
let prefixHash = null;
try {
  if (existsSync(absPath)) {
    fullContent = readFileSync(absPath, 'utf8');
    bytes = Buffer.byteLength(fullContent, 'utf8');
    const prefix = Buffer.from(fullContent, 'utf8').slice(0, HASH_PREFIX_BYTES);
    prefixHash = sha256(prefix).slice(0, 32);

    const edgeHash = createHash('sha256').update(fullContent).digest('hex').slice(0, 16);
    const nowIso = new Date().toISOString();
    const requestedLimit = Number(input?.tool_input?.limit || 0);
    const effectiveLimit = requestedLimit > 0 ? requestedLimit : 2000;

    mkdirSync(CX_DIR, { recursive: true });
    let store = {};
    try { store = JSON.parse(readFileSync(HASH_STORE, 'utf8')); } catch { /* fresh store */ }
    store[absPath] = { hash: edgeHash, ts: nowIso, size: fullContent.length };

    const cutoff = Date.now() - HASH_RETENTION_MS;
    for (const [k, v] of Object.entries(store)) {
      if (new Date(v.ts).getTime() < cutoff) delete store[k];
    }
    writeFileSync(HASH_STORE, JSON.stringify(store, null, 2));

    recordReadDelta({
      path: absPath,
      size: fullContent.length,
      limit: effectiveLimit,
      ts: nowIso,
    }, process.env);

    if (process.env.CONSTRUCT_READ_TRACKER_FLUSH === '1') {
      flushReadTrackerDeltas({ nowIso, env: process.env });
    }
  }
} catch (err) {
  logHookFailure({ hook: 'audit-reads', err, phase: 'hash-store', input: { filePath: absPath } });
}

// Stage 2 — opt-in tamper-evident audit log.

if (process.env.CONSTRUCT_AUDIT_READS !== '1') process.exit(0);

const record = {
  ts: new Date().toISOString(),
  session_id: input?.session_id || null,
  tool: 'Read',
  agent: readLastAgent(),
  cwd,
  target: filePath,
  bytes,
  content_hash: prefixHash,
  prev_line_hash: readPrevLineHash(),
};

try {
  mkdirSync(dirname(AUDIT_FILE), { recursive: true });
  appendBounded('audit-reads', AUDIT_FILE, JSON.stringify(record) + '\n');
} catch (err) {
  logHookFailure({ hook: 'audit-reads', err, phase: 'append' });
}

process.exit(0);
