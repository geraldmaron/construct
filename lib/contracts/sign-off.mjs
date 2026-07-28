/**
 * lib/contracts/sign-off.mjs — durable sign-off and override records for the
 * contract enforcement ladder (construct-uizpv.5).
 *
 * Two record kinds share one append-only JSONL log at
 * <stateRoot>/contracts/sign-offs.jsonl:
 *
 *   sign-off — a Worker Profile named in a contract's approvalWorkerProfiles
 *              clears that contract. The only thing that clears a hard rung.
 *   override — an actor proceeds past a soft rung without a sign-off. Always
 *              paired with an audit-trail entry, so an override is possible
 *              but never silent.
 *
 * Records are scoped to an artifact reference so clearing one document does
 * not clear the next: a sign-off recorded against `docs/a.md` is not consulted
 * when gating `docs/b.md`. A record with no artifactRef is contract-wide and
 * applies to every artifact under that contract — a deliberate escape hatch
 * for standing approvals, distinguished at read time rather than by a
 * separate log.
 *
 * The store is append-only. Revoking a sign-off means appending a `revoked`
 * decision, not deleting a line, so the history of who cleared what and when
 * survives — the same reasoning that makes lib/audit-trail.mjs a hash chain.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { appendAuditRecord } from '../audit-trail.mjs';
import { resolveStatePath } from '../state-root.mjs';

export const SIGN_OFF_DECISIONS = Object.freeze(['approved', 'rejected', 'revoked']);

export function signOffLogPath(projectRoot, { ensureDir = true } = {}) {
  return resolveStatePath(projectRoot, 'contracts', 'sign-offs.jsonl', { ensureDir });
}

function appendRecord(projectRoot, record) {
  const file = signOffLogPath(projectRoot);
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
  return record;
}

function readRecords(projectRoot) {
  const file = signOffLogPath(projectRoot, { ensureDir: false });
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch { /* a corrupt line is skipped, not fatal to the gate */ }
  }
  return out;
}

/**
 * Record a Worker Profile's decision on a contract. `workerProfile` is the
 * approving identity the ladder checks against approvalWorkerProfiles;
 * `actor` is the human or process that entered it.
 */
export function recordSignOff({
  projectRoot,
  contractId,
  workerProfile,
  decision = 'approved',
  artifactRef = null,
  actor = null,
  reason = null,
  now = () => new Date().toISOString(),
} = {}) {
  if (!contractId) throw new Error('recordSignOff requires contractId');
  if (!workerProfile) throw new Error('recordSignOff requires workerProfile');
  if (!SIGN_OFF_DECISIONS.includes(decision)) {
    throw new Error(`recordSignOff decision must be one of: ${SIGN_OFF_DECISIONS.join(', ')}`);
  }

  return appendRecord(projectRoot, {
    kind: 'sign-off',
    contractId,
    workerProfile,
    decision,
    artifactRef,
    actor,
    reason,
    recordedAt: now(),
  });
}

/**
 * Record an override of a soft-blocked contract and mirror it into the audit
 * trail. The audit write happens first: if the sink rejects it, the override
 * is not recorded at all, so the log can never hold a bypass that left no
 * audit evidence.
 */
export function recordOverride({
  projectRoot,
  contractId,
  reason,
  actor = null,
  artifactRef = null,
  now = () => new Date().toISOString(),
  appendAudit = appendAuditRecord,
} = {}) {
  if (!contractId) throw new Error('recordOverride requires contractId');
  if (!reason) throw new Error('recordOverride requires a reason — an unexplained override is indistinguishable from a missing gate');

  const recordedAt = now();
  const audit = appendAudit({
    event: 'contract.override',
    contract_id: contractId,
    artifact_ref: artifactRef,
    actor,
    reason,
    timestamp: recordedAt,
  });

  return appendRecord(projectRoot, {
    kind: 'override',
    contractId,
    artifactRef,
    actor,
    reason,
    recordedAt,
    auditRef: audit?.prev_line_hash ?? null,
  });
}

function matchesArtifact(record, artifactRef) {
  if (record.artifactRef == null) return true;
  if (artifactRef == null) return false;
  return record.artifactRef === artifactRef;
}

/**
 * The effective sign-offs and overrides for one artifact, latest-wins per
 * (contractId, workerProfile). A later `revoked` or `rejected` decision
 * supersedes an earlier approval rather than coexisting with it.
 */
export function loadGateRecords({ projectRoot, artifactRef = null } = {}) {
  const records = readRecords(projectRoot).filter((record) => matchesArtifact(record, artifactRef));

  const latestSignOff = new Map();
  const overrides = [];

  for (const record of records) {
    if (record.kind === 'override') {
      overrides.push(record);
      continue;
    }
    if (record.kind !== 'sign-off') continue;
    latestSignOff.set(`${record.contractId}::${record.workerProfile}`, record);
  }

  return {
    signOffs: [...latestSignOff.values()].filter((record) => record.decision === 'approved'),
    overrides,
    all: records,
  };
}
