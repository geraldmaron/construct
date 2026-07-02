/**
 * lib/oracle/actions.mjs — Oracle tick executor with bounded-auto policy.
 *
 * Auto actions: alignment census spawn, registry validate import, adapters
 * sync (Construct tool repo only). Approve actions queue to
 * <project>/.cx/oracle/pending.jsonl. High-severity gaps auto-raise beads
 * when enabled. Denied actions are skipped.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { collectReadModel, enrichReadModel } from './read-model.mjs';
import { synthesizeVerdict } from './synthesize.mjs';
import { classifyAction, autoRaiseEnabled, autoRaiseEnabledForGap } from './policy.mjs';
import { isConstructPackageRepo } from '../host-disposition.mjs';
import { syncProjectAdapters } from '../adapters-sync.mjs';
import { writeVerdict } from './verdicts.mjs';
import { raiseIssuesForGaps } from './issues.mjs';
import { maybeWriteHighSeverityRouting } from './dispatch.mjs';
import { executeApprovedAction } from './execute.mjs';
import { signOffMetadata } from './routing.mjs';

function pendingPath(projectDir) {
  return path.join(projectDir, '.cx', 'oracle', 'pending.jsonl');
}

const ORACLE_PENDING_MAX = 50;
const ORACLE_PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function ensureOracleDir(projectDir) {
  const dir = path.join(projectDir, '.cx', 'oracle');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function normalizeSummary(summary) {
  return String(summary || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function pendingTarget(record = {}) {
  return record.target
    || record.signOff?.id
    || record.context?.signOff?.id
    || record.context?.remediationRoute?.primary
    || '';
}

function pendingDedupKey(record = {}) {
  const parts = [record.kind || '', pendingTarget(record), normalizeSummary(record.summary)];
  return `oracle:${sha256(parts.join('\u0000')).slice(0, 16)}`;
}

function readPendingRecords(projectDir) {
  const file = pendingPath(projectDir);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function sweepPendingRecords(records, now = Date.now()) {
  let changed = false;
  const next = records.map((record) => {
    const dedupKey = record.dedupKey || pendingDedupKey(record);
    if (record.dedupKey !== dedupKey) changed = true;
    const count = Number.isFinite(record.count) && record.count > 0 ? record.count : 1;
    const firstSeenAt = record.firstSeenAt || record.queuedAt || new Date(now).toISOString();
    const lastSeenAt = record.lastSeenAt || record.queuedAt || firstSeenAt;
    const updated = {
      ...record,
      dedupKey,
      count,
      firstSeenAt,
      lastSeenAt,
    };
    const ageMs = now - Date.parse(lastSeenAt);
    if (updated.status === 'pending' && Number.isFinite(ageMs) && ageMs > ORACLE_PENDING_TTL_MS) {
      updated.status = 'expired';
      updated.expiredAt = new Date(now).toISOString();
      updated.expiredReason = 'ttl';
      changed = true;
    }
    return updated;
  });

  const activePending = next
    .filter((record) => record.status === 'pending')
    .sort((a, b) => Date.parse(b.lastSeenAt || b.queuedAt || 0) - Date.parse(a.lastSeenAt || a.queuedAt || 0));

  for (const overflow of activePending.slice(ORACLE_PENDING_MAX)) {
    if (overflow.status !== 'pending') continue;
    overflow.status = 'expired';
    overflow.expiredAt = new Date(now).toISOString();
    overflow.expiredReason = 'cap';
    changed = true;
  }

  return { records: next, changed };
}

function rewritePending(projectDir, pending) {
  const file = pendingPath(projectDir);
  ensureOracleDir(projectDir);
  fs.writeFileSync(file, pending.map((p) => JSON.stringify(p)).join('\n') + (pending.length ? '\n' : ''), 'utf8');
}

function enqueuePending(projectDir, record, now = Date.now()) {
  const { records, changed } = sweepPendingRecords(readPendingRecords(projectDir), now);
  const dedupKey = pendingDedupKey(record);
  const queuedAt = new Date(now).toISOString();
  const existing = records.find((entry) => entry.status === 'pending' && entry.dedupKey === dedupKey);
  if (existing) {
    existing.summary = record.summary;
    existing.signOff = record.signOff;
    existing.context = record.context;
    existing.classification = record.classification;
    existing.target = pendingTarget(record);
    existing.count = (Number.isFinite(existing.count) ? existing.count : 1) + 1;
    existing.lastSeenAt = queuedAt;
    rewritePending(projectDir, records);
    return existing;
  }
  const pending = {
    ...record,
    id: record.id || `oracle-${dedupKey.slice('oracle:'.length)}`,
    dedupKey,
    count: 1,
    queuedAt,
    firstSeenAt: queuedAt,
    lastSeenAt: queuedAt,
    target: pendingTarget(record),
  };
  rewritePending(projectDir, changed ? records.concat(pending) : [...records, pending]);
  return pending;
}

export function listPending(projectDir, { includeExpired = false, now = Date.now() } = {}) {
  const { records, changed } = sweepPendingRecords(readPendingRecords(projectDir), now);
  if (changed) rewritePending(projectDir, records);
  return records.filter((record) => includeExpired || record.status !== 'expired');
}

export async function approvePending(projectDir, id, { execute = true, rootDir, homeDir, dryRun = false } = {}) {
  const pending = listPending(projectDir, { includeExpired: true });
  const match = pending.find((p) => p.id === id);
  if (!match) return { ok: false, reason: 'not-found' };
  if (match.status === 'expired') return { ok: false, reason: 'expired', action: match };
  if (match.status === 'approved' && match.executedAt) {
    return { ok: true, already: true, action: match };
  }
  match.status = 'approved';
  match.approvedAt = new Date().toISOString();
  match.signOff = match.signOff ?? signOffMetadata({ id: match.kind }, projectDir);

  let executionResult = null;
  if (execute) {
    try {
      executionResult = await executeApprovedAction(match, {
        rootDir: rootDir ?? defaultRootDir(),
        projectDir,
        homeDir,
        dryRun,
      });
      match.executedAt = new Date().toISOString();
      match.executionResult = executionResult;
      if (executionResult?.gateway?.bdIssueId) match.beadId = executionResult.gateway.bdIssueId;
    } catch (err) {
      match.executionResult = { ok: false, error: err?.message || String(err) };
    }
  }

  rewritePending(projectDir, pending);
  return { ok: true, action: match, executionResult };
}

async function executeAutoAction(kind, { rootDir, projectDir, dryRun }) {
  if (dryRun) return { kind, dryRun: true, ok: true };

  switch (kind) {
    case 'census-run': {
      const script = path.join(rootDir, 'scripts', 'alignment', 'census.mjs');
      if (!fs.existsSync(script)) return { kind, ok: false, error: 'census script missing' };
      const result = spawnSync(process.execPath, [script], { cwd: rootDir, encoding: 'utf8' });
      return {
        kind,
        ok: result.status === 0,
        exitCode: result.status,
        stderr: (result.stderr || '').slice(0, 500),
      };
    }
    case 'registry-validate': {
      const { validateCapabilityRegistry } = await import('../registry/validate.mjs');
      const report = validateCapabilityRegistry({ rootDir });
      return { kind, ok: report.valid, errors: report.errors?.length ?? 0, warnings: report.warnings?.length ?? 0 };
    }
    case 'adapters-sync': {
      if (!isConstructPackageRepo(projectDir)) {
        return { kind, ok: true, skipped: true, reason: 'not-tool-repo' };
      }
      const result = syncProjectAdapters({ projectRoot: projectDir, packageRoot: rootDir, log: () => {} });
      return { kind, ok: !!result.synced, hosts: result.hosts ?? [] };
    }
    default:
      return { kind, ok: false, error: 'unknown-auto-action' };
  }
}

/**
 * Run one Oracle tick: collect signals, synthesize verdict, execute auto
 * actions, queue approve actions, raise beads for high gaps.
 */
export async function runOracleTick({ rootDir, projectDir, homeDir, dryRun = false } = {}) {
  let readModel = collectReadModel({ rootDir, projectDir, homeDir });
  readModel = await enrichReadModel(readModel);
  const synthesis = synthesizeVerdict(readModel);

  const executed = [];
  const queued = [];
  const skipped = [];
  let beadsRaised = [];

  if (autoRaiseEnabled() && synthesis.gaps.some((g) => autoRaiseEnabledForGap(g))) {
    beadsRaised = await raiseIssuesForGaps({ projectDir, gaps: synthesis.gaps, dryRun });
  }

  for (const rec of synthesis.recommendedActions) {
    const classification = classifyAction(rec.kind);
    if (classification === 'deny') {
      skipped.push({ ...rec, classification });
      continue;
    }
    if (classification === 'auto') {
      const result = await executeAutoAction(rec.kind, { rootDir, projectDir, dryRun });
      executed.push({ ...rec, classification, result });
      continue;
    }
    const pending = {
      kind: rec.kind,
      summary: rec.summary,
      classification,
      status: 'pending',
      signOff: rec.signOff ?? signOffMetadata({ id: rec.kind }, projectDir),
      context: { ...rec },
    };
    const persisted = dryRun ? pending : enqueuePending(projectDir, pending);
    queued.push(persisted);
  }

  const tick = {
    at: new Date().toISOString(),
    dryRun,
    verdict: synthesis.verdict,
    gaps: synthesis.gaps,
    executed,
    queued,
    skipped,
    beadsRaised,
  };

  if (!dryRun) {
    writeVerdict(projectDir, tick, { beadsRaised, orgGraph: readModel.orgGraph });
    maybeWriteHighSeverityRouting({ projectDir, tick, synthesis, readModel });
  }

  return { readModel, ...synthesis, tick };
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export function defaultRootDir() {
  return path.resolve(MODULE_DIR, '../..');
}
