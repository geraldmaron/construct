/**
 * lib/roles/gateway.mjs — single entry point hooks call to record events and
 * (maybe) invoke a Worker Profile.
 *
 * Flow: kill-switch checks → emit to bus → route → threshold/cooldown/rate
 * ceiling → create bd issue → queue pending invocation → SSE toast.
 *
 * Defensive: every step is best-effort so a partial failure (bd unavailable,
 * SSE bus unloaded) never blocks the calling hook. Returns a structured
 * decision so callers can log / chain.
 *
 * Routing (construct-b0nny.16): resolves event ownership via the
 * consolidated lib/orchestration/routing-tables.mjs directly rather than
 * through lib/roles/router.mjs — router.mjs now just delegates to the same
 * function and is kept only for its own external callers.
 */

import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { emit, _paths } from './event-bus.mjs';
import { resolveEventOwner as routeEvent } from '../orchestration/routing-tables.mjs';
import { loadManifest } from './manifest.mjs';
import { runBd } from '../beads-client.mjs';
import { doctorRoot } from '../config/xdg.mjs';

/**
 * Team escalation support — loads team definitions from registry
 * and resolves escalation paths when decisions hit forbidden or unresolvable situations.
 */

function loadTeamRegistry(root) {
  try {
    const regPath = join(root, 'registry', 'policies', 'teams-registry.json');
    if (!existsSync(regPath)) return null;
    return JSON.parse(readFileSync(regPath, 'utf8'));
  } catch {
    return null;
  }
}

export function findTeamByRoleOwner(roleId, registry) {
  if (!registry || !Array.isArray(registry.teams)) return null;
  return registry.teams.find((team) => team.owner === roleId);
}

export function getTeamEscalationPath(teamId, registry) {
  if (!registry || !Array.isArray(registry.teams)) return [];
  const team = registry.teams.find((t) => t.id === teamId);
  return team?.escalationPath || [];
}

export function canTeamMakeDecision(teamId, decisionId, registry) {
  if (!registry || !Array.isArray(registry.teams)) return false;
  const team = registry.teams.find((t) => t.id === teamId);
  if (!team) return false;
  if (Array.isArray(team.forbiddenDecisions) && team.forbiddenDecisions.includes(decisionId)) {
    return false; // forbidden
  }
  return Array.isArray(team.decisionRights) && team.decisionRights.includes(decisionId);
}

// CONSTRUCT_ROLES_ROOT still wins for the roles event ecosystem's test
// isolation; the literal fallback follows the global doctor root instead of ~/.construct.

function rootDir() {
  return process.env.CONSTRUCT_ROLES_ROOT || doctorRoot();
}
function pendingPath() {
  return join(rootDir(), 'role-pending.jsonl');
}

const DEFAULTS = {
  thresholdHits: 2,
  thresholdWindowMs: 10 * 60 * 1000,
  cooldownMs: 30 * 60 * 1000,
  rateCeilingPerHour: 3,
  pendingTtlMs: 14 * 24 * 60 * 60 * 1000,
};

function ensureDir() {
   const r = rootDir();
   if (!existsSync(r)) mkdirSync(r, { recursive: true });
}

function raisedPath() {
    return join(rootDir(), 'gateway-raised.jsonl');
}

function teamsPath() {
    return join(rootDir(), 'team-decisions.jsonl');
}

function readRaisedFingerprints() {
   const rp = raisedPath();
   if (!existsSync(rp)) return [];
   try {
     return readFileSync(rp, 'utf8')
       .split('\n')
       .filter(Boolean)
       .map((l) => { try { return JSON.parse(l); } catch { return null; } })
       .filter(Boolean);
   } catch { return []; }
}

function fingerprintAlreadyRaised(fingerprint) {
   return readRaisedFingerprints().some((r) => r.fingerprint === fingerprint && r.beadId);
}

function recordRaisedFingerprint(fingerprint, beadId) {
   ensureDir();
   appendFileSync(raisedPath(), JSON.stringify({ fingerprint, beadId, ts: Date.now() }) + '\n');
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

// Paths under the OS tmpdir are by definition test fixtures or sandbox
// runs, not real project state. Escalating from them spawns persistent
// beads for ephemeral files — pure tracker noise. macOS resolves
// $TMPDIR through a /private/var/folders/... symlink; the raw tmpdir
// and its /private prefix are both checked so either resolved form
// matches.

export function isTestFixturePath(p) {
  if (!p || typeof p !== 'string') return false;
  const tmp = tmpdir();
  if (p.startsWith(tmp)) return true;
  if (p.startsWith('/private' + tmp)) return true;
  if (p.startsWith('/tmp/')) return true;
  // macOS canonical user-tmp prefix when $TMPDIR is set elsewhere
  if (/^\/private\/var\/folders\/[^/]+\/[^/]+\/T\//.test(p)) return true;
  if (/^\/var\/folders\/[^/]+\/[^/]+\/T\//.test(p)) return true;
  return false;
}

function eventIsFromTestFixture(event) {
  if (isTestFixturePath(event?.cwd)) return true;
  if (isTestFixturePath(event?.project)) return true;
  if (isTestFixturePath(event?.context?.filePath)) return true;
  return false;
}

export function shouldEscalate(event, manifest, now = Date.now()) {
  if (eventIsFromTestFixture(event)) {
    return { escalate: false, reason: 'test-fixture-path' };
  }
  const fp = event.fingerprint;
  const pending = readPending();

  // Cooldown: same fingerprint already escalated within window?
  const recentSame = pending.find(
    (p) => p.fingerprint === fp && now - p.ts < DEFAULTS.cooldownMs
  );
  if (recentSame) return { escalate: false, reason: 'cooldown' };

  // Rate ceiling per Worker Profile per hour (match id or legacy killSwitchEnv key).
  const workerProfileId = manifest?.id || '';
  const killSwitchEnv = manifest?.killSwitchEnv || '';
  const hourAgo = now - 60 * 60 * 1000;
  const recentForWorkerProfile = pending.filter((p) => {
    if (!(p.ts > hourAgo)) return false;
    if (workerProfileId && p.workerProfileId === workerProfileId) return true;
    if (killSwitchEnv && (p.killSwitchEnv === killSwitchEnv || p.workerProfileId === killSwitchEnv)) return true;
    return false;
  });
  if (recentForWorkerProfile.length >= DEFAULTS.rateCeilingPerHour) {
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

// The bd client is injectable so tests can intercept the escalation path
// without reaching the real, shared bd/dolt database (construct-y4iv) --
// CONSTRUCT_ROLES_ROOT isolates the dedup-fingerprint state but is also set
// legitimately in production (lib/oracle/execute.mjs), so it can't double as
// a "we're in a test" signal. Callers that don't inject a client get the real
// one, so production behavior (and every other existing caller) is unchanged.

async function createBdIncident(event, routeResult, { runBd: runBdImpl = runBd } = {}) {
   // Dedup: check if this fingerprint has already been raised as a bead
   if (fingerprintAlreadyRaised(event.fingerprint)) {
     return { success: true, skipped: true, reason: 'fingerprint-already-raised', fingerprint: event.fingerprint };
   }

   const labels = (routeResult.manifest.outputs?.bdLabels || []).join(',') || 'incident';
   const firstLine = String(event.summary || '').split('\n')[0].slice(0, 120);
   const title = `[${routeResult.workerProfileId}] ${event.type} — ${firstLine}`;
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
   const result = await runBdImpl(
     ['create', title, '-t', 'bug', '-l', labels, '-d', body],
     { actor: `roles:${routeResult.workerProfileId}`, silent: true, timeoutSeconds: 10, commandTimeoutSeconds: 30 }
   );
   if (!result.success) return { success: false, error: result.error || 'bd-failed' };
   const match = String(result.output || '').match(/Created issue:\s*([\w-]+)/);
   const beadId = match ? match[1] : null;
   
   // Record this fingerprint as raised
   if (beadId) {
     recordRaisedFingerprint(event.fingerprint, beadId);
   }
   
   return { success: true, issueId: beadId, raw: result.output };
}

async function emitToastBestEffort(payload) {
  try {
    const mod = await import('../embed/notifications.mjs');
    if (typeof mod.emitEmbedNotification === 'function') {
      mod.emitEmbedNotification(payload);
    }
  } catch { /* dashboard not loaded; toast is best-effort */ }
}

export async function tryEscalate(event, deps = {}) {
  const r = routeEvent(event);
  if (!r) return { escalated: false, event, reason: 'no-owner' };

  const manifest = loadManifest(r.workerProfileId) || {
    id: r.workerProfileId,
    severityImmediate: r.workerProfile?.severityImmediate || [],
    killSwitchEnv: r.workerProfile?.killSwitchEnv || '',
    fence: r.workerProfile?.policyFence || {},
    handoffCandidates: r.workerProfile?.handoffCandidates || [],
    outputs: { bdLabels: r.workerProfile?.artifactClasses || [] },
  };
  const routeResult = { ...r, manifest };

  if (manifest.killSwitchEnv && process.env[manifest.killSwitchEnv] === 'off') {
    return { escalated: false, event, reason: 'worker-profile-off' };
  }

  const decision = shouldEscalate(event, manifest);
  if (!decision.escalate) {
    return { escalated: false, event, reason: decision.reason, decision };
  }

  try {
    const { checkBudget } = await import('../cost-ledger.mjs');
    const budget = checkBudget({ workerProfileId: r.workerProfileId });
    if (!budget.allowed) {
      return { escalated: false, event, reason: 'budget-exhausted', budget };
    }
  } catch { /* cost ledger optional — never block on missing module */ }

  const bd = await createBdIncident(event, routeResult, deps);
  if (!bd.success) {
    return { escalated: false, event, reason: 'bd-create-failed', error: bd.error };
  }

  const pendingEntry = {
    ts: Date.now(),
    workerProfileId: r.workerProfileId,
    bdIssueId: bd.issueId,
    fingerprint: event.fingerprint,
    eventType: event.type,
    summary: String(event.summary || '').split('\n')[0],
    killSwitchEnv: manifest.killSwitchEnv || '',
  };
  appendPending(pendingEntry);

  await emitToastBestEffort({
    type: 'warning',
    source: 'roles',
    message: `${r.workerProfileId}: ${pendingEntry.summary}`,
    meta: {
      workerProfileId: r.workerProfileId,
      bdIssueId: bd.issueId,
      fingerprint: event.fingerprint,
      eventType: event.type,
    },
  });

  return { escalated: true, event, workerProfileId: r.workerProfileId, bdIssueId: bd.issueId, decision };
}

export async function recordAndMaybeInvoke(eventType, payload = {}, deps = {}) {
  if (process.env.CONSTRUCT_ROLES === 'off') {
    return { recorded: false, escalated: false, reason: 'global-off' };
  }
  const event = emit(eventType, payload);
  const r = await tryEscalate(event, deps);
  return { recorded: true, ...r };
}

// A surfaced role invocation is a prompt to act, not a durable record (bd owns
// the durable issue). Unresolved entries older than the TTL are stale noise —
// e.g. pre-fixture-guard escalations that would otherwise surface at every
// session-start forever — so they drop out of listings and never expire bd work.

function isExpired(entry, now) {
  return typeof entry.ts === 'number' && (now - entry.ts) > DEFAULTS.pendingTtlMs;
}

export function listPending({ unresolved = true } = {}) {
  const entries = readPending();
  if (!unresolved) return entries;
  const now = Date.now();
  return entries.filter((e) => !e.resolvedAt && !isExpired(e, now));
}

// An entry that names an OS-tmp path is a pre-guard test-fixture escalation
// (shouldEscalate now blocks these at the source). Sweep them on prune so the
// historical noise — e.g. the cx-secrets fixtures — clears immediately rather
// than waiting out the TTL.

function referencesFixture(entry) {
  for (const field of [entry.cwd, entry.project, entry.summary]) {
    if (typeof field !== 'string') continue;
    for (const token of field.split(/\s+/)) {
      if (isTestFixturePath(token.replace(/[)\].,:;]+$/, ''))) return true;
    }
  }
  return false;
}

// Compact the queue on disk: drop resolved, TTL-expired, and fixture-path
// entries. Idempotent; returns counts so the CLI and session-start can report
// what was reclaimed.

export function prunePending({ now = Date.now() } = {}) {
  const entries = readPending();
  const kept = [];
  let resolved = 0;
  let expired = 0;
  let fixtures = 0;
  for (const e of entries) {
    if (e.resolvedAt) { resolved += 1; continue; }
    if (isExpired(e, now)) { expired += 1; continue; }
    if (referencesFixture(e)) { fixtures += 1; continue; }
    kept.push(e);
  }
  const removed = resolved + expired + fixtures;
  if (removed > 0) {
    writeFileSync(pendingPath(), kept.length ? kept.map((e) => JSON.stringify(e)).join('\n') + '\n' : '');
  }
  return { removed, resolved, expired, fixtures, kept: kept.length };
}

// Drain events that accumulated outside a Claude session. Walks recent
// events.jsonl, runs each unescalated one through tryEscalate. Bounded by
// `sinceMs` and `maxProcess` so a long-quiet machine can't trigger a flood.

export async function processBacklog({ sinceMs = 60 * 60 * 1000, maxProcess = 10, deps = {} } = {}) {
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
    const r = await tryEscalate(e, deps);
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

/**
 * Record a team decision (approved, blocked, or escalated) for policy-gate
 * authority checks and durable audit trails.
 */
export function recordTeamDecision(decisionId, teamId, outcome = 'pending', context = {}) {
  ensureDir();
  const entry = {
    ts: Date.now(),
    decisionId,
    teamId,
    outcome, // 'approved', 'blocked', 'escalated', 'pending'
    context,
  };
  appendFileSync(teamsPath(), JSON.stringify(entry) + '\n');
  return entry;
}

/**
 * Record a forbidden decision attempt — someone tried to make a decision the team is not allowed to make.
 */
export function recordForbiddenDecision(decisionId, teamId, reason = '', context = {}) {
  ensureDir();
  const entry = {
    ts: Date.now(),
    type: 'forbidden-decision',
    decisionId,
    teamId,
    reason,
    context,
  };
  appendFileSync(teamsPath(), JSON.stringify(entry) + '\n');
  return entry;
}

export const _gatewayPaths = { rootDir, pendingPath, teamsPath };
