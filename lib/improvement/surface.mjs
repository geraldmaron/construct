/**
 * lib/improvement/surface.mjs — operator flow for the governed improvement loop.
 *
 * Wires the Worker Profile loop, eval gates, and approval-gated controller into a
 * review → approve → apply path shared by the CLI and dashboard. Submissions
 * persist under `.construct/improvement/`; the controller plans rollouts and records
 * human-performed apply/rollback but never mutates live artifacts itself.
 */
import os from 'node:os';

import {
  governProposal,
  requireApproval,
  planRollout,
  recordApplication,
  recordRollback,
} from './controller.mjs';
import { transitionProposal } from './proposal.mjs';
import { runWorkerProfileImprovement } from './worker-profile-loop.mjs';
import {
  loadApprovers,
  loadRecord,
  listRecords,
  saveRecord,
} from './store.mjs';

export function resolveKnownApprovers(projectDir, env = process.env) {
  const configured = loadApprovers(projectDir);
  if (configured?.length) return [...new Set(configured)];
  const fromEnv = [env.CONSTRUCT_IMPROVEMENT_APPROVER, env.USER, env.LOGNAME].filter(Boolean);
  try {
    fromEnv.push(os.userInfo().username);
  } catch { /* ignore */ }
  return [...new Set(fromEnv.filter((id) => typeof id === 'string' && id))];
}

function mergeGovernance(projectDir, record, governance) {
  const next = { ...record, governance, updatedAt: new Date().toISOString() };
  if (governance?.admissible && record.proposal?.state === 'proposal_ready') {
    const moved = transitionProposal(record.proposal, 'awaiting_approval');
    if (moved.ok) next.proposal = moved.proposal;
  }
  return saveRecord(projectDir, next);
}

export function submitBundle({
  projectDir,
  bundle = {},
  knownApprovers = null,
  resolvedDependencies = [],
} = {}) {
  const approvers = knownApprovers || resolveKnownApprovers(projectDir);
  const {
    trace = null,
    trigger = null,
    dataset = null,
    evaluationReport = null,
    proposal: directProposal = null,
    approver = null,
    target = 'prompt',
    baselineVersion = null,
    candidateVersion = null,
    heldOutProfiles = [],
  } = bundle;

  let proposal = directProposal;
  let loopResult = null;

  if (!proposal && trace) {
    loopResult = runWorkerProfileImprovement({
      trace,
      trigger,
      target,
      heldOutProfiles,
      baselineVersion,
      candidateVersion,
      approver,
      dataset,
      evaluationReport,
      knownApprovers: approvers,
      resolvedDependencies,
    });
    if (!loopResult.proposed) {
      return { ok: false, stage: 'worker-profile-loop', loopResult };
    }
    proposal = loopResult.proposal;
  }

  if (!proposal) return { ok: false, error: 'bundle must include trace or proposal' };

  const governance = governProposal({
    proposal,
    dataset,
    evaluationReport,
    knownApprovers: approvers,
    resolvedDependencies,
  });

  const record = saveRecord(projectDir, {
    projectDir,
    id: proposal.id,
    proposal,
    dataset,
    evaluationReport,
    trace,
    trigger,
    loopResult,
    governance,
  });

  if (governance.admissible) {
    const advanced = mergeGovernance(projectDir, record, governance);
    return { ok: true, record: advanced, governance, loopResult };
  }

  const failed = transitionProposal(proposal, 'evaluation_failed', {
    terminalReason: governance.refusals?.join(', ') || 'governance-refused',
  });
  const refused = saveRecord(projectDir, {
    ...record,
    proposal: failed.ok ? failed.proposal : proposal,
    governance,
  });
  return { ok: false, stage: governance.stage || 'governance', record: refused, governance, loopResult };
}

export function reviewRecord(projectDir, id, { knownApprovers = null, resolvedDependencies = [] } = {}) {
  const record = loadRecord(projectDir, id);
  if (!record) return { ok: false, error: 'not-found' };

  const approvers = knownApprovers || resolveKnownApprovers(projectDir);
  const governance = governProposal({
    proposal: record.proposal,
    dataset: record.dataset,
    evaluationReport: record.evaluationReport,
    knownApprovers: approvers,
    resolvedDependencies,
  });

  const next = mergeGovernance(projectDir, record, governance);
  return { ok: true, record: next, governance };
}

export function listPending(projectDir) {
  return listRecords(projectDir, { state: 'awaiting_approval' });
}

export function approveRecord(projectDir, id, { identity = null, knownApprovers = null, nowIso = null } = {}) {
  const record = loadRecord(projectDir, id);
  if (!record) return { ok: false, error: 'not-found' };

  const approvers = knownApprovers || resolveKnownApprovers(projectDir);
  const who = identity || record.proposal?.approver?.identity || approvers[0] || null;
  const approved = requireApproval({
    proposal: record.proposal,
    approval: { identity: who, approvedAt: nowIso || new Date().toISOString() },
    knownApprovers: approvers,
    nowIso,
  });
  if (!approved.ok) return approved;

  const rollout = planRollout({ proposal: approved.proposal });
  const saved = saveRecord(projectDir, {
    ...record,
    projectDir,
    proposal: approved.proposal,
    rolloutPlan: rollout.ok ? rollout.plan : null,
  });
  return { ok: true, record: saved, rollout };
}

export function applyRecord(projectDir, id, { monitor = null, nowIso = null } = {}) {
  const record = loadRecord(projectDir, id);
  if (!record) return { ok: false, error: 'not-found' };

  const applied = recordApplication({
    proposal: record.proposal,
    monitor: monitor || `monitor-${id}`,
    nowIso: nowIso || new Date().toISOString(),
  });
  if (!applied.ok) return applied;

  const saved = saveRecord(projectDir, { ...record, projectDir, proposal: applied.proposal });
  return { ok: true, record: saved };
}

export function rollbackRecord(projectDir, id, { reason = 'operator-rollback', nowIso = null } = {}) {
  const record = loadRecord(projectDir, id);
  if (!record) return { ok: false, error: 'not-found' };

  const rolled = recordRollback({
    proposal: record.proposal,
    reason,
    nowIso: nowIso || new Date().toISOString(),
  });
  if (!rolled.ok) return rolled;

  const saved = saveRecord(projectDir, { ...record, projectDir, proposal: rolled.proposal });
  return { ok: true, record: saved };
}

export function formatReviewSummary(record, governance = record?.governance) {
  const p = record?.proposal || {};
  const lines = [
    `Proposal ${p.id} · ${p.type} · ${p.state}`,
    `Profiles: ${(p.affectedProfiles || []).join(', ') || '—'}`,
    `Blast radius: ${p.blastRadius}`,
    `Baseline → candidate: ${p.lineage?.baselineVersion} → ${p.lineage?.candidateVersion}`,
  ];
  if (governance) {
    lines.push(`Governance: ${governance.admissible ? 'admissible' : 'refused'} (${governance.stage || '—'})`);
    if (governance.refusals?.length) lines.push(`Refusals: ${governance.refusals.join(', ')}`);
  }
  if (record?.rolloutPlan) {
    lines.push(`Rollout: ${record.rolloutPlan.mode} · ${record.rolloutPlan.steps?.join(' → ')}`);
  }
  return lines.join('\n');
}
