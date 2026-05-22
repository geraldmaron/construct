#!/usr/bin/env node
/**
 * lib/hooks/read-tracker.mjs — Read tracker hook — tracks file reads for efficiency analysis.
 *
 * Runs as PostToolUse after Read tool calls. Logs each read to ~/.cx/read-log.json including file path, line count, and session timestamp for efficiency reporting.
 *
 * @p95ms 10
 * @maxBlockingScope none (PostToolUse, non-blocking)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { flushReadTrackerDeltas, recordReadDelta } from '../read-tracker-store.mjs';

const CX_DIR = join(homedir(), '.cx');
const HASH_STORE = join(CX_DIR, 'file-hashes.json');
let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

if ((input?.tool_name || '') !== 'Read') process.exit(0);

const rawPath = input?.tool_input?.file_path || '';
if (!rawPath) process.exit(0);

const absPath = rawPath.startsWith('/') ? rawPath : resolve(input?.cwd || process.cwd(), rawPath);
if (!existsSync(absPath)) process.exit(0);

try {
  const content = readFileSync(absPath, 'utf8');
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
  const nowIso = new Date().toISOString();
  const requestedLimit = Number(input?.tool_input?.limit || 0);
  const effectiveLimit = requestedLimit > 0 ? requestedLimit : 2000;

  mkdirSync(CX_DIR, { recursive: true });
  let store = {};
  try { store = JSON.parse(readFileSync(HASH_STORE, 'utf8')); } catch { /* fresh */ }

  store[absPath] = { hash, ts: nowIso, size: content.length };

  // Prune entries older than 2 hours
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [k, v] of Object.entries(store)) {
    if (new Date(v.ts).getTime() < cutoff) delete store[k];
  }

  writeFileSync(HASH_STORE, JSON.stringify(store, null, 2));
  recordReadDelta({
    path: absPath,
    size: content.length,
    limit: effectiveLimit,
    ts: nowIso,
  }, process.env);

  if (process.env.CONSTRUCT_READ_TRACKER_FLUSH === '1') {
    flushReadTrackerDeltas({ nowIso, env: process.env });
  }
} catch { /* best effort */ }

process.exit(0);
