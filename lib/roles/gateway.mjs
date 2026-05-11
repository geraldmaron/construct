/**
 * lib/roles/gateway.mjs — single entry point hooks call to record events and
 * (maybe) invoke a persona.
 *
 * Flow: kill-switch checks → emit to bus → route → threshold/cooldown/rate
 * ceiling → create bd issue → queue pending invocation → SSE toast.
 *
 * Defensive: every step is best-effort so a partial failure (bd unavailable,
 * SSE bus unloaded) never blocks the calling hook. Returns a structured
 * decision so callers can log / chain.
 */

import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { emit, _paths } from './event-bus.mjs';
import { route as routeEvent } from './router.mjs';
import { runBd } from '../beads-client.mjs';

function rootDir() {
  return process.env.CONSTRUCT_ROLES_ROOT || join(homedir(), '.cx');
}
function pendingPath() {
  return join(rootDir(), 'role-pending.jsonl');
}

const DEFAULTS = {
  thresholdHits: 2,
  thresholdWindowMs: 10 * 60 * 1000,
  cooldownMs: 30 * 60 * 1000,
  rateCeilingPerHour: 3,
};

function ensureDir() {
  const r = rootDir();
  if (!existsSync(r)) mkdirSync(r, { recursive: true });
}

function readPending() {
  const pp = pendingPath();
  if (!existsSync(pp)) return [];
  try {
    return readFileSync(pp, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

function appendPending(entry) {
  ensureDir();
  appendFileSync(pendingPath(), JSON.stringify(entry) + '\n');
}

export function shouldEscalate(event, manifest, now = Date.now()) {
  const fp = event.fingerprint;
  const pending = readPending();

  // Cooldown: same fingerprint already escalated within window?
  const recentSame = pending.find(
    (p) => p.fingerprint === fp && now - p.ts < DEFAULTS.cooldownMs
  );
  if (recentSame) return { escalate: false, reason: 'cooldown' };

  // Rate ceiling per persona per hour
  const personaId = (manifest && manifest.killSwitchEnv) ? manifest.killSwitchEnv : '';
  const hourAgo = now - 60 * 60 * 1000;
  const recentForPersona = pending.filter(
    (p) => p.ts > hourAgo && p.killSwitchEnv === personaId
  );
  if (recentForPersona.length >= DEFAULTS.rateCeilingPerHour) {
    return { escalate: false, reason: 'rate-ceiling' };
  }

  // Severity short-circuit: immediate on first hit
  const immediate = Array.isArray(manifest?.severityImmediate)
    && manifest.severityImmediate.includes(event.type);
  if (immediate) return { escalate: true, reason: 'severity-immediate', count: 1 };

  // Threshold: N hits within window from events.jsonl
  const ep = _paths.eventsPath();
  let hits = 0;
  if (existsSync(ep)) {
    const lines = readFileSync(ep, 'utf8').split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      let e;
      try { e = JSON.parse(lines[i]); } catch { continue; }
      if (now - e.ts > DEFAULTS.thresholdWindowMs) break;
      if (e.fingerprint === fp) hits++;
    }
  }
  if (hits >= DEFAULTS.thresholdHits) {
    return { escalate: true, reason: 'threshold', count: hits };
  }
  return { escalate: false, reason: 'below-threshold', count: hits };
}

async function createBdIncident(event, routeResult) {
  const labels = (routeResult.manifest.outputs?.bdLabels || []).join(',') || 'incident';
  const firstLine = String(event.summary || '').split('\n')[0].slice(0, 120);
  const title = `[${routeResult.personaId}] ${event.type} — ${firstLine}`;
  const body = JSON.stringify(
    {
      eventType: event.type,
      ts: event.ts,
      project: event.project,
      branch: event.branch,
      cwd: event.cwd,
      summary: event.summary,
      context: event.context,
      fingerprint: event.fingerprint,
      fence: routeResult.manifest.fence || {},
      handoffCandidates: routeResult.manifest.handoffCandidates || [],
    },
    null,
    2
  );
  const result = await runBd(
    ['create', title, '-t', 'bug', '-l', labels, '-d', body],
    { actor: `roles:${routeResult.personaId}`, silent: true, timeoutSeconds: 10, commandTimeoutSeconds: 30 }
  );
  if (!result.success) return { success: false, error: result.error || 'bd-failed' };
  const match = String(result.output || '').match(/Created issue:\s*([\w-]+)/);
  return { success: true, issueId: match ? match[1] : null, raw: result.output };
}

async function emitToastBestEffort(payload) {
  try {
    const mod = await import('../embed/notifications.mjs');
    if (typeof mod.emitEmbedNotification === 'function') {
      mod.emitEmbedNotification(payload);
    }
  } catch { /* dashboard not loaded; toast is best-effort */ }
}

export async function tryEscalate(event) {
  const r = routeEvent(event);
  if (!r) return { escalated: false, event, reason: 'no-owner' };

  if (r.manifest.killSwitchEnv && process.env[r.manifest.killSwitchEnv] === 'off') {
    return { escalated: false, event, reason: 'persona-off' };
  }

  const decision = shouldEscalate(event, r.manifest);
  if (!decision.escalate) {
    return { escalated: false, event, reason: decision.reason, decision };
  }

  try {
    const { checkBudget } = await import('../cost-ledger.mjs');
    const budget = checkBudget({ personaId: r.personaId });
    if (!budget.allowed) {
      return { escalated: false, event, reason: 'budget-exhausted', budget };
    }
  } catch { /* cost ledger optional — never block on missing module */ }

  const bd = await createBdIncident(event, r);
  if (!bd.success) {
    return { escalated: false, event, reason: 'bd-create-failed', error: bd.error };
  }

  const pendingEntry = {
    ts: Date.now(),
    personaId: r.personaId,
    cxId: r.cxId,
    bdIssueId: bd.issueId,
    fingerprint: event.fingerprint,
    eventType: event.type,
    summary: String(event.summary || '').split('\n')[0],
    killSwitchEnv: r.manifest.killSwitchEnv || '',
  };
  appendPending(pendingEntry);

  await emitToastBestEffort({
    type: 'warning',
    source: 'roles',
    message: `${r.cxId}: ${pendingEntry.summary}`,
    meta: {
      personaId: r.personaId,
      bdIssueId: bd.issueId,
      fingerprint: event.fingerprint,
      eventType: event.type,
    },
  });

  return { escalated: true, event, personaId: r.personaId, bdIssueId: bd.issueId, decision };
}

export async function recordAndMaybeInvoke(eventType, payload = {}) {
  if (process.env.CONSTRUCT_ROLES === 'off') {
    return { recorded: false, escalated: false, reason: 'global-off' };
  }
  const event = emit(eventType, payload);
  const r = await tryEscalate(event);
  return { recorded: true, ...r };
}

export function listPending({ unresolved = true } = {}) {
  const entries = readPending();
  if (!unresolved) return entries;
  return entries.filter((e) => !e.resolvedAt);
}

// Drain events that accumulated outside a Claude session. Walks recent
// events.jsonl, runs each unescalated one through tryEscalate. Bounded by
// `sinceMs` and `maxProcess` so a long-quiet machine can't trigger a flood.

export async function processBacklog({ sinceMs = 60 * 60 * 1000, maxProcess = 10 } = {}) {
  if (process.env.CONSTRUCT_ROLES === 'off') return { processed: 0, escalated: 0, reason: 'global-off' };

  const ep = _paths.eventsPath();
  if (!existsSync(ep)) return { processed: 0, escalated: 0 };
  const cutoff = Date.now() - sinceMs;
  const lines = readFileSync(ep, 'utf8').split('\n').filter(Boolean);
  const pending = readPending();
  const pendingFps = new Set(pending.map((p) => p.fingerprint));

  const candidates = [];
  for (let i = lines.length - 1; i >= 0 && candidates.length < maxProcess * 4; i--) {
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    if (e.ts < cutoff) break;
    if (pendingFps.has(e.fingerprint)) continue;
    candidates.push(e);
  }

  let escalated = 0;
  let processed = 0;
  for (const e of candidates.reverse()) {
    if (processed >= maxProcess) break;
    processed++;
    const r = await tryEscalate(e);
    if (r.escalated) escalated++;
  }
  return { processed, escalated };
}

export function markResolved(fingerprint) {
  const entries = readPending();
  let changed = false;
  const next = entries.map((e) => {
    if (e.fingerprint === fingerprint && !e.resolvedAt) {
      changed = true;
      return { ...e, resolvedAt: Date.now() };
    }
    return e;
  });
  if (!changed) return false;
  writeFileSync(pendingPath(), next.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return true;
}

export function resetPending() {
  const pp = pendingPath();
  if (existsSync(pp)) writeFileSync(pp, '');
}

export const _gatewayPaths = { rootDir, pendingPath };
