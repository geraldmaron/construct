/**
 * lib/roles/event-bus.mjs — append-only event log per project.
 *
 * Hook processes emit failure/signal events here. The gateway reads recent
 * events to decide escalation. Lines are rotated to keep the file bounded.
 * Fingerprint = sha1(type + project + first summary line) so the same failure
 * dedups across emits.
 *
 * Path resolution: events.jsonl lives at <project>/.construct/ when the cwd sits
 * inside a Construct project, otherwise at ~/.construct/. Without per-project
 * isolation, fingerprints from project A suppress real events in project B.
 * Override the directory with CONSTRUCT_ROLES_ROOT for tests.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveProjectScopedPath } from '../project-root.mjs';

const MAX_LINES = 1000;

function eventsPath() {
  if (process.env.CONSTRUCT_ROLES_ROOT) {
    return join(process.env.CONSTRUCT_ROLES_ROOT, 'events.jsonl');
  }
  return resolveProjectScopedPath('events.jsonl', { ensureDir: false });
}
function ensureDir() {
  const dir = dirname(eventsPath());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function fingerprintOf(type, project, summary) {
  const firstLine = String(summary || '').split('\n')[0].trim();
  return createHash('sha1').update(`${type}|${project}|${firstLine}`).digest('hex').slice(0, 16);
}

export function emit(eventType, payload = {}) {
  ensureDir();
  const project = payload.project || '';
  const summary = payload.summary || '';
  const fingerprint = fingerprintOf(eventType, project, summary);
  const line = {
    ts: Date.now(),
    type: eventType,
    project,
    branch: payload.branch || '',
    cwd: payload.cwd || '',
    summary,
    context: payload.context ?? null,
    fingerprint,
  };
  appendFileSync(eventsPath(), JSON.stringify(line) + '\n');
  rotate();
  return line;
}

// Best-effort variant for writers that emit lifecycle events as a side
// effect of their primary work (e.g. recommendation-store.createRecommendation,
// docs-lifecycle.runDocsLifecycle). A bus write failure must not surface as
// an error in the writer that just succeeded — the primary artifact already
// landed. Returns the emitted line on success, null on failure.

export function emitBestEffort(eventType, payload = {}) {
  try {
    return emit(eventType, payload);
  } catch {
    return null;
  }
}

export function recent({ since = 0, type, fingerprint, limit = 200 } = {}) {
  const ep = eventsPath();
  if (!existsSync(ep)) return [];
  const raw = readFileSync(ep, 'utf8').split('\n').filter(Boolean);
  const out = [];
  for (let i = raw.length - 1; i >= 0 && out.length < limit; i--) {
    let entry;
    try { entry = JSON.parse(raw[i]); } catch { continue; }
    if (since && entry.ts < since) break;
    if (type && entry.type !== type) continue;
    if (fingerprint && entry.fingerprint !== fingerprint) continue;
    out.push(entry);
  }
  return out;
}

function rotate() {
  try {
    const ep = eventsPath();
    const raw = readFileSync(ep, 'utf8').split('\n').filter(Boolean);
    if (raw.length <= MAX_LINES) return;
    const trimmed = raw.slice(raw.length - MAX_LINES).join('\n') + '\n';
    writeFileSync(ep, trimmed);
  } catch { /* rotate is best-effort */ }
}

export const _paths = { eventsPath };
