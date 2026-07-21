/**
 * lib/doctor/local-production-health.mjs — local production go/no-go health model.
 *
 * Defines explicit evidence-based checks for unattended local operation. A
 * process being alive is explicitly not sufficient: each check reads durable
 * state (scheduler ticks, queue records, oracle verdict age, graph outbox,
 * budget ledger) rather than pid liveness alone. Composed gate is conjunctive:
 * any required failing check blocks go. Mirrors the philosophy referenced by
 * construct-tsyfe.10.7 for release gates.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveEmbedStatus } from '../embed/cli.mjs';
import { capabilityStatusDir, readCapabilityTick, enabledCapabilityIds, listCapabilities } from '../embed/capability-lifecycle.mjs';
import { parseCadenceMs } from '../embed/capability-jobs.mjs';

const DEFAULT_CADENCE_MS = 15 * 60_000;
import { ApprovalQueue } from '../embed/approval-queue.mjs';
import { WriteSentLog } from '../writes/sent-log.mjs';
import { DEFAULT_MAX_EXECUTION_ATTEMPTS } from '../writes/control-plane.mjs';
import { getTotalDailySpend, totalBudget, enforcementActive } from '../cost-ledger.mjs';
import { readHeartbeatStatus, HEARTBEAT_STALE_MS } from '../oracle/heartbeat.mjs';
import { readDoctorHeartbeatStatus, HEARTBEAT_STALE_MS as DOCTOR_HEARTBEAT_STALE_MS } from '../doctor/heartbeat.mjs';
import { readLatestVerdict } from '../oracle/verdicts.mjs';
import { listPending } from '../oracle/actions.mjs';
import { planProjectIdentityMigration } from '../project-identity/migrate.mjs';
import { outboxState } from '../graph/relational/outbox.mjs';
import { getDeploymentMode } from '../deployment-mode.mjs';
import { summarizeTeamHealth } from '../team/health.mjs';
import { checkSourceTargetHealth } from './source-target-health.mjs';
import { loadProjectConfig } from '../config/project-config.mjs';
import { resolveStatePath } from '../state-root.mjs';
import { doctorRoot } from '../config/xdg.mjs';

export const LOCAL_PRODUCTION_PHILOSOPHY =
  'Alive is not sufficient — every check must cite durable evidence, not pid liveness alone.';

export const LOCAL_PRODUCTION_CHECK_IDS = Object.freeze([
  'scheduler-healthy',
  'assignments-loaded',
  'next-run-valid',
  'provider-credentials-valid',
  'cursors-progressing',
  'queue-not-stuck',
  'leases-not-stale',
  'approvals-visible',
  'action-reconciliation-current',
  'budget-healthy',
  'oracle-evidence-current',
  'doctor-evidence-current',
  'no-state-path-split',
  'no-dead-letter-backlog',
]);

export const DEAD_LETTER_POLICY_MAX = 0;
export const SCHEDULER_EVIDENCE_STALE_MS = HEARTBEAT_STALE_MS;
export const VERDICT_STALE_MS = 24 * 60 * 60 * 1000;

function checkResult(id, { pass, summary, evidence = {}, required = true, skipped = false } = {}) {
  return { id, pass: Boolean(pass), summary, evidence, required, skipped };
}

function skippedCheck(id, summary, evidence = {}) {
  return checkResult(id, { pass: true, summary, evidence, required: false, skipped: true });
}

function parseIsoMs(value) {
  if (!value) return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function newestCapabilityEvidenceMs(rootDir, enabledIds, now) {
  let newest = 0;
  const tickIds = new Set(enabledIds);
  try {
    const statusDir = capabilityStatusDir(rootDir);
    if (fs.existsSync(statusDir)) {
      for (const file of fs.readdirSync(statusDir)) {
        if (file.endsWith('.json')) tickIds.add(file.replace(/\.json$/, ''));
      }
    }
  } catch { /* ignore */ }

  for (const id of tickIds) {
    const tick = readCapabilityTick(id, rootDir);
    const at = parseIsoMs(tick?.tickedAt);
    if (Number.isFinite(at) && at > newest) newest = at;
  }
  const inboxStatePath = resolveStatePath(rootDir, 'runtime', 'inbox-state.json', { ensureDir: false });
  if (fs.existsSync(inboxStatePath)) {
    try {
      const stat = fs.statSync(inboxStatePath);
      if (stat.mtimeMs > newest) newest = stat.mtimeMs;
    } catch { /* ignore */ }
  }
  return newest > 0 ? now - newest : Infinity;
}

function readEmbedDaemonStartedAt(homeDir, env) {
  const stateFile = path.join(doctorRoot(homeDir, env), 'runtime', 'embed-daemon.json');
  if (!fs.existsSync(stateFile)) return NaN;
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return parseIsoMs(state.startedAt);
  } catch {
    return NaN;
  }
}

function checkSchedulerHealthy({ rootDir, homeDir, env, now }) {
  const embed = resolveEmbedStatus(env, homeDir);
  if (embed.level === 'none') {
    return skippedCheck('scheduler-healthy', 'embed not applicable (no provider credentials configured)', { embedLevel: embed.level });
  }
  if (embed.level === 'stopped') {
    return checkResult('scheduler-healthy', {
      pass: false,
      summary: 'embed daemon stopped while provider credentials are configured',
      evidence: { embedLevel: embed.level, detail: embed.detail },
    });
  }

  const enabledIds = enabledCapabilityIds({ rootDir });
  let evidenceAgeMs = newestCapabilityEvidenceMs(rootDir, enabledIds, now);
  if (!Number.isFinite(evidenceAgeMs) || evidenceAgeMs === Infinity) {
    const startedAt = readEmbedDaemonStartedAt(homeDir, env);
    if (Number.isFinite(startedAt)) evidenceAgeMs = now - startedAt;
  }
  const pidAlive = embed.level === 'running';
  const evidenceFresh = evidenceAgeMs <= SCHEDULER_EVIDENCE_STALE_MS;

  if (pidAlive && !evidenceFresh) {
    return checkResult('scheduler-healthy', {
      pass: false,
      summary: `embed pid is alive but scheduler evidence is stale (${Math.round(evidenceAgeMs / 60_000)}m old, limit ${Math.round(SCHEDULER_EVIDENCE_STALE_MS / 60_000)}m)`,
      evidence: { pidAlive, evidenceAgeMs, enabledCapabilities: enabledIds.length },
    });
  }

  return checkResult('scheduler-healthy', {
    pass: evidenceFresh,
    summary: evidenceFresh
      ? 'scheduler evidence is current (capability ticks or inbox state)'
      : `no scheduler evidence yet (enabled capabilities: ${enabledIds.length})`,
    evidence: { pidAlive, evidenceAgeMs, enabledCapabilities: enabledIds.length },
  });
}

function checkAssignmentsLoaded({ rootDir }) {
  const { capabilities, errors } = listCapabilities({ rootDir });
  const enabled = capabilities.filter((entry) => entry.enabled);
  if (enabled.length === 0) {
    return skippedCheck('assignments-loaded', 'no enabled embed capabilities', { enabledCount: 0 });
  }
  if (errors.length) {
    return checkResult('assignments-loaded', {
      pass: false,
      summary: `embed capability loader reported ${errors.length} error(s)`,
      evidence: { errors: errors.slice(0, 5) },
    });
  }
  const missingManifest = enabled.filter((entry) => !entry.manifest?.id);
  if (missingManifest.length) {
    return checkResult('assignments-loaded', {
      pass: false,
      summary: `${missingManifest.length} enabled capability assignment(s) missing manifest`,
      evidence: { ids: missingManifest.map((entry) => entry.id) },
    });
  }
  return checkResult('assignments-loaded', {
    pass: true,
    summary: `${enabled.length} enabled capability assignment(s) loaded`,
    evidence: { ids: enabled.map((entry) => entry.id) },
  });
}

function checkNextRunValid({ rootDir, now }) {
  const enabledIds = enabledCapabilityIds({ rootDir });
  if (enabledIds.length === 0) {
    return skippedCheck('next-run-valid', 'no enabled embed capabilities', { enabledCount: 0 });
  }
  const { capabilities } = listCapabilities({ rootDir });
  const invalid = [];
  for (const id of enabledIds) {
    const manifest = capabilities.find((entry) => entry.id === id)?.manifest;
    const cadenceEvery = manifest?.embed?.cadence?.every;
    const cadenceMs = parseCadenceMs(cadenceEvery) ?? DEFAULT_CADENCE_MS;
    if (!Number.isFinite(cadenceMs) || cadenceMs <= 0) {
      invalid.push({ id, reason: 'invalid-cadence', cadenceEvery });
      continue;
    }
    const tick = readCapabilityTick(id, rootDir);
    const lastAt = parseIsoMs(tick?.tickedAt);
    if (Number.isFinite(lastAt)) {
      const nextAt = lastAt + cadenceMs;
      if (!Number.isFinite(nextAt)) {
        invalid.push({ id, reason: 'next-run-not-finite', cadenceMs, lastAt: tick.tickedAt });
      }
    }
  }
  if (invalid.length) {
    return checkResult('next-run-valid', {
      pass: false,
      summary: `${invalid.length} enabled capability(ies) have invalid next-run computation`,
      evidence: { invalid },
    });
  }
  return checkResult('next-run-valid', {
    pass: true,
    summary: 'next-run computation valid for all enabled capabilities',
    evidence: { enabledCount: enabledIds.length },
  });
}

function checkProviderCredentialsValid({ rootDir, env }) {
  const embed = resolveEmbedStatus(env, os.homedir());
  if (embed.level === 'none') {
    return skippedCheck('provider-credentials-valid', 'embed not applicable (no provider credentials configured)', { embedLevel: embed.level });
  }
  const { findings, configured } = checkSourceTargetHealth({ cwd: rootDir, env });
  const hardFailures = findings.filter((finding) => !finding.ok && !finding.optional);
  if (hardFailures.length) {
    return checkResult('provider-credentials-valid', {
      pass: false,
      summary: `${hardFailures.length} source-target credential/path check(s) failed`,
      evidence: { labels: hardFailures.map((finding) => finding.label) },
    });
  }
  return checkResult('provider-credentials-valid', {
    pass: true,
    summary: configured
      ? 'configured source targets pass credential/path checks'
      : 'provider credentials present for embed',
    evidence: { configuredTargets: configured },
  });
}

function checkCursorsProgressing({ rootDir, env, now }) {
  const { findings, configured } = checkSourceTargetHealth({ cwd: rootDir, env, now });
  if (!configured) {
    return skippedCheck('cursors-progressing', 'no source targets configured', { configured: 0 });
  }
  const stale = findings.filter((finding) => !finding.ok && finding.label.includes('stale'));
  if (stale.length) {
    return checkResult('cursors-progressing', {
      pass: false,
      summary: `${stale.length} source target cursor(s) stale — run construct sources sync`,
      evidence: { labels: stale.map((finding) => finding.label) },
    });
  }
  return checkResult('cursors-progressing', {
    pass: true,
    summary: 'source target cursors are fresh',
    evidence: { configuredTargets: configured },
  });
}

function checkQueueNotStuck({ rootDir, env, now }) {
  const queue = new ApprovalQueue({
    persistPath: ApprovalQueue.resolvePersistPath(rootDir, getDeploymentMode(env, { cwd: rootDir })),
  });
  const stalePending = queue
    .getPending()
    .filter((item) => parseIsoMs(item.expiresAt) < now);
  if (stalePending.length) {
    return checkResult('queue-not-stuck', {
      pass: false,
      summary: `${stalePending.length} approval queue item(s) past expiry without drain`,
      evidence: { approvalIds: stalePending.map((item) => item.approvalId).slice(0, 10) },
    });
  }
  return checkResult('queue-not-stuck', {
    pass: true,
    summary: 'approval queue is not stuck',
    evidence: { pending: queue.getPending().length },
  });
}

async function checkLeasesNotStale({ rootDir, env }) {
  const mode = getDeploymentMode(env, { cwd: rootDir });
  if (mode === 'solo') {
    return skippedCheck('leases-not-stale', 'solo mode (team worker leases not applicable)', { mode });
  }
  const team = await summarizeTeamHealth({ rootDir, env });
  if (team.status === 'unavailable') {
    return checkResult('leases-not-stale', {
      pass: false,
      summary: `team health unavailable in ${mode} mode: ${team.reason ?? team.summary}`,
      evidence: { mode, reason: team.reason ?? team.error },
    });
  }
  if (team.staleWorkers > 0 || (team.deadLetter ?? 0) > DEAD_LETTER_POLICY_MAX) {
    return checkResult('leases-not-stale', {
      pass: false,
      summary: `team queue degraded (${team.summary})`,
      evidence: { staleWorkers: team.staleWorkers, deadLetter: team.deadLetter, queue: team.queue },
    });
  }
  return checkResult('leases-not-stale', {
    pass: true,
    summary: 'team worker leases and queue are healthy',
    evidence: { activeWorkers: team.activeWorkers, queue: team.queue },
  });
}

function checkApprovalsVisible({ rootDir, env }) {
  const persistPath = ApprovalQueue.resolvePersistPath(rootDir, getDeploymentMode(env, { cwd: rootDir }));
  if (!fs.existsSync(persistPath)) {
    return checkResult('approvals-visible', {
      pass: true,
      summary: 'approval queue file absent (empty queue is visible)',
      evidence: { persistPath, exists: false },
    });
  }
  try {
    const queue = new ApprovalQueue({ persistPath });
    const pending = queue.getPending();
    return checkResult('approvals-visible', {
      pass: true,
      summary: 'approval queue readable',
      evidence: { persistPath, pending: pending.length },
    });
  } catch (err) {
    return checkResult('approvals-visible', {
      pass: false,
      summary: `approval queue not readable: ${err.message || err}`,
      evidence: { persistPath },
    });
  }
}

function checkActionReconciliationCurrent({ rootDir, env }) {
  const persistPath = ApprovalQueue.resolvePersistPath(rootDir, getDeploymentMode(env, { cwd: rootDir }));
  const queue = new ApprovalQueue({ persistPath });
  const exhausted = queue
    .list('approved')
    .filter((item) => !item.executedAt && (item.executionAttempts ?? 0) >= DEFAULT_MAX_EXECUTION_ATTEMPTS);
  const sentLog = new WriteSentLog({ persistPath: WriteSentLog.resolvePersistPath(rootDir) });
  const failed = sentLog.list({ status: 'error' });
  if (exhausted.length || failed.length) {
    return checkResult('action-reconciliation-current', {
      pass: false,
      summary: `write pipeline out of reconciliation (exhausted=${exhausted.length}, sent-log errors=${failed.length})`,
      evidence: {
        exhaustedApprovalIds: exhausted.map((item) => item.approvalId).slice(0, 10),
        sentLogErrorCount: failed.length,
      },
    });
  }
  return checkResult('action-reconciliation-current', {
    pass: true,
    summary: 'action reconciliation current (no exhausted approvals or sent-log errors)',
    evidence: { exhausted: 0, sentLogErrors: 0 },
  });
}

function checkBudgetHealthy() {
  const total = getTotalDailySpend();
  const cap = totalBudget();
  const ratio = cap > 0 ? total.costUsd / cap : 0;
  if (enforcementActive() && total.costUsd >= cap) {
    return checkResult('budget-healthy', {
      pass: false,
      summary: `daily budget exhausted ($${total.costUsd.toFixed(4)} / $${cap.toFixed(2)}) with enforcement active`,
      evidence: { spent: total.costUsd, cap, enforcement: true },
    });
  }
  return checkResult('budget-healthy', {
    pass: true,
    summary: ratio >= 0.8
      ? `budget at ${Math.round(ratio * 100)}% of daily cap (advisory)`
      : 'budget within healthy range',
    evidence: { spent: total.costUsd, cap, enforcement: enforcementActive(), ratio },
  });
}

function checkOracleEvidenceCurrent({ rootDir, homeDir, env, now }) {
  if (env?.CONSTRUCT_ORACLE === 'off' || env?.CONSTRUCT_ORACLE === '0') {
    return skippedCheck('oracle-evidence-current', 'oracle disabled', { enabled: false });
  }
  const heartbeat = readHeartbeatStatus({ homeDir, env });
  const pending = listPending(rootDir, { now }).length;
  const verdict = readLatestVerdict(rootDir);
  const verdictAt = parseIsoMs(verdict?.at);
  const verdictAgeMs = Number.isFinite(verdictAt) ? now - verdictAt : Infinity;
  const verdictStale = verdictAgeMs > VERDICT_STALE_MS;

  if (heartbeat.enabled && heartbeat.stale && pending > 0) {
    return checkResult('oracle-evidence-current', {
      pass: false,
      summary: `oracle producer stale with ${pending} pending action(s) — alive is not sufficient`,
      evidence: { pending, heartbeatAgeMs: heartbeat.ageMs, verdictAgeMs },
    });
  }
  if (verdictStale && pending > 0) {
    return checkResult('oracle-evidence-current', {
      pass: false,
      summary: `oracle verdict evidence stale (${Math.round(verdictAgeMs / 3_600_000)}h) with pending work`,
      evidence: { pending, verdictAgeMs },
    });
  }
  return checkResult('oracle-evidence-current', {
    pass: !verdictStale || pending === 0,
    summary: verdictStale
      ? 'oracle verdict stale but no pending work'
      : 'oracle evidence current',
    evidence: { pending, verdictAgeMs, heartbeatStale: heartbeat.stale ?? false },
  });
}

function checkDoctorEvidenceCurrent({ env, now }) {
  if (env?.CONSTRUCT_DOCTOR === 'off' || env?.CONSTRUCT_DOCTOR === '0') {
    return skippedCheck('doctor-evidence-current', 'doctor disabled', { enabled: false });
  }
  const heartbeat = readDoctorHeartbeatStatus({ env, now });
  if (!heartbeat.running) {
    return skippedCheck('doctor-evidence-current', 'doctor daemon not running', { running: false });
  }
  if (heartbeat.stale) {
    const ageMin = Number.isFinite(heartbeat.evidenceAgeMs)
      ? Math.round(heartbeat.evidenceAgeMs / 60_000)
      : null;
    return checkResult('doctor-evidence-current', {
      pass: false,
      summary: `doctor pid is alive but watcher evidence is stale (${ageMin ?? 'unknown'}m old, limit ${Math.round(DOCTOR_HEARTBEAT_STALE_MS / 60_000)}m)`,
      evidence: {
        pidAlive: heartbeat.pidAlive,
        evidenceAgeMs: heartbeat.evidenceAgeMs,
        auditSampleCount: heartbeat.auditSampleCount,
      },
    });
  }
  return checkResult('doctor-evidence-current', {
    pass: true,
    summary: 'doctor watcher evidence is current',
    evidence: {
      evidenceAgeMs: heartbeat.evidenceAgeMs,
      auditSampleCount: heartbeat.auditSampleCount,
    },
  });
}

function checkNoStatePathSplit({ rootDir, env }) {
  let config = {};
  try {
    ({ config } = loadProjectConfig(rootDir, env));
  } catch { /* best effort */ }
  const plan = planProjectIdentityMigration(rootDir, { config });
  const mergeActions = plan.actions?.filter((action) => action.kind === 'merge') ?? [];
  const conflicts = mergeActions.flatMap((action) => action.conflicts ?? []);
  const flagged = plan.flagged ?? [];
  if (conflicts.length || flagged.some((entry) => entry.exists && entry.entryCount > 0)) {
    return checkResult('no-state-path-split', {
      pass: false,
      summary: 'state-path split detected (legacy project-identity buckets with data)',
      evidence: { conflicts: conflicts.length, flagged: flagged.map((entry) => entry.key) },
    });
  }
  return checkResult('no-state-path-split', {
    pass: true,
    summary: 'no state-path split (canonical project key owns state)',
    evidence: { canonicalKey: plan.canonicalKey },
  });
}

function checkNoDeadLetterBacklog({ rootDir }) {
  try {
    const outbox = outboxState(rootDir);
    if ((outbox.deadLetter ?? 0) > DEAD_LETTER_POLICY_MAX) {
      return checkResult('no-dead-letter-backlog', {
        pass: false,
        summary: `graph outbox dead-letter backlog ${outbox.deadLetter} exceeds policy (${DEAD_LETTER_POLICY_MAX})`,
        evidence: { outbox },
      });
    }
    return checkResult('no-dead-letter-backlog', {
      pass: true,
      summary: 'graph outbox dead-letter backlog within policy',
      evidence: { outbox },
    });
  } catch {
    return skippedCheck('no-dead-letter-backlog', 'graph store not present', { graph: 'absent' });
  }
}

/**
 * @param {object} [opts]
 * @param {string} [opts.rootDir]
 * @param {string} [opts.homeDir]
 * @param {object} [opts.env]
 * @param {number} [opts.now]
 */
export async function runLocalProductionHealth({
  rootDir = process.cwd(),
  homeDir = os.homedir(),
  env = process.env,
  now = Date.now(),
} = {}) {
  const checks = [
    checkSchedulerHealthy({ rootDir, homeDir, env, now }),
    checkAssignmentsLoaded({ rootDir }),
    checkNextRunValid({ rootDir, now }),
    checkProviderCredentialsValid({ rootDir, env }),
    checkCursorsProgressing({ rootDir, env, now }),
    checkQueueNotStuck({ rootDir, env, now }),
    await checkLeasesNotStale({ rootDir, env }),
    checkApprovalsVisible({ rootDir, env }),
    checkActionReconciliationCurrent({ rootDir, env }),
    checkBudgetHealthy(),
    checkOracleEvidenceCurrent({ rootDir, homeDir, env, now }),
    checkDoctorEvidenceCurrent({ env, now }),
    checkNoStatePathSplit({ rootDir, env }),
    checkNoDeadLetterBacklog({ rootDir }),
  ];
  return evaluateLocalProductionGate({ checks, philosophy: LOCAL_PRODUCTION_PHILOSOPHY });
}

/**
 * Conjunctive go/no-go: every required, non-skipped check must pass.
 *
 * @param {{ checks: object[], philosophy?: string }} input
 */
export function evaluateLocalProductionGate({ checks, philosophy = LOCAL_PRODUCTION_PHILOSOPHY } = {}) {
  const applicable = checks.filter((check) => check.required && !check.skipped);
  const failures = applicable.filter((check) => !check.pass);
  const go = failures.length === 0;
  return {
    go,
    philosophy,
    checks,
    summary: go
      ? `GO — ${applicable.length} required check(s) passed`
      : `NO-GO — ${failures.length} required check(s) failed`,
    failures: failures.map((check) => ({ id: check.id, summary: check.summary })),
  };
}

export function formatLocalProductionReport(result) {
  const lines = [];
  lines.push('Local production health');
  lines.push(result.philosophy);
  lines.push('');
  lines.push(`Verdict: ${result.summary}`);
  lines.push('');
  for (const check of result.checks) {
    const mark = check.skipped ? 'SKIP' : (check.pass ? 'PASS' : 'FAIL');
    lines.push(`[${mark}] ${check.id}: ${check.summary}`);
  }
  return lines.join('\n');
}
