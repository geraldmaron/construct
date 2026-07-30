/**
 * lib/telemetry/beads-fallback.mjs — count legacy-lock fallback firings.
 *
 * The beads write path is optimistic by default; the exclusive file-lock runs only
 * as the PATH-3 fallback after optimistic retries exhaust. Whether that fallback
 * ever fires in practice is the evidence that decides if the lock + wait-queue can
 * be retired: one JSON line per firing to
 * ~/.construct/beads-fallback.jsonl. Zero entries over a representative window = safe to
 * remove; entries name the bd commands that actually contend.
 *
 * Errors here are non-fatal — telemetry must never add a failure mode to the
 * fallback it observes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { appendBounded } from '../logging/rotate.mjs';
import { constructDir } from '../paths.mjs';

export function defaultLogPath() {
  return path.join(constructDir(), 'beads-fallback.jsonl');
}

export function logBeadsFallback(event, opts = {}) {
  const logPath = opts.logPath || defaultLogPath();
  const entry = {
    ts: new Date().toISOString(),
    command: event?.command || 'unknown',
  };
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    appendBounded('beads-fallback', logPath, JSON.stringify(entry) + '\n');
  } catch { /* best-effort */ }
}

export function readBeadsFallbacks({ logPath = defaultLogPath() } = {}) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}
