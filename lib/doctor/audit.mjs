/**
 * lib/doctor/audit.mjs — append-only audit log for L0 doctor actions.
 *
 * Every deterministic action the doctor takes (restart, kill, rotate, escalate)
 * lands here as a single JSONL line. The audit log is the user's window into
 * what the L0 layer did while they weren't looking — and the basis for rolling
 * back a misfire if rules are wrong.
 *
 * Path: <doctorRoot>/doctor-log.jsonl (overridable via CONSTRUCT_DOCTOR_ROOT for tests).
 */

import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { doctorRoot } from '../config/xdg.mjs';

const MAX_LINES = 2000;

function rootDir() {
  return doctorRoot();
}
function logPath() {
  return join(rootDir(), 'doctor-log.jsonl');
}
function ensureDir() {
  const r = rootDir();
  if (!existsSync(r)) mkdirSync(r, { recursive: true });
}

export function record({ kind, watcher, action = null, target = null, result = 'ok', summary, context = null }) {
  ensureDir();
  const line = {
    ts: Date.now(),
    kind,
    watcher,
    action,
    target,
    result,
    summary: String(summary || '').slice(0, 2048),
    context,
  };
  appendFileSync(logPath(), JSON.stringify(line) + '\n');
  rotate();
  return line;
}

export function recent({ since = 0, watcher, kind, limit = 200 } = {}) {
  const p = logPath();
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean);
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    if (since && e.ts < since) break;
    if (watcher && e.watcher !== watcher) continue;
    if (kind && e.kind !== kind) continue;
    out.push(e);
  }
  return out;
}

function rotate() {
  try {
    const p = logPath();
    const raw = readFileSync(p, 'utf8').split('\n').filter(Boolean);
    if (raw.length <= MAX_LINES) return;
    writeFileSync(p, raw.slice(raw.length - MAX_LINES).join('\n') + '\n');
  } catch { /* best effort */ }
}

export const _paths = { rootDir, logPath };
