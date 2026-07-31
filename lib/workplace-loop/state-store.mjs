/**
 * lib/workplace-loop/state-store.mjs — durable run state and proposal
 * persistence for the production workplace loop.
 *
 * Mirrors lib/embed/approval-queue.mjs's and lib/writes/sent-log.mjs's
 * plain-JSON-file persistence convention rather than lib/workspace/'s SQLite
 * store — this state (one fingerprint/run-counter row, a handful of proposal
 * documents) has no relational or concurrent-writer shape that would justify
 * a database, matching the same file-per-record precedent the governed-write
 * chokepoint's own durable state already uses. Rooted under
 * resolveStateDir(rootDir, 'workplace-loop') (lib/state-root.mjs, the one
 * authoritative per-project machine-scoped state location) rather than the
 * repo tree, so loop state never pollutes a working checkout and is isolated
 * per project the same way the graph/workspace/approval stores already are.
 */

import fs from 'node:fs';
import path from 'node:path';

import { resolveStateDir } from '../state-root.mjs';

function loopStateDir(rootDir) {
  return resolveStateDir(rootDir, 'workplace-loop');
}

function statePath(rootDir) {
  return path.join(loopStateDir(rootDir), 'state.json');
}

function proposalsDir(rootDir) {
  return path.join(loopStateDir(rootDir), 'proposals');
}

/**
 * @param {string} rootDir
 * @returns {{fingerprint: string, runNumber: number, lastRunAt: string, signalIds: string[], lastProposalId: string|null}|null}
 */
export function loadLoopState(rootDir) {
  const p = statePath(rootDir);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function saveLoopState(rootDir, state) {
  fs.mkdirSync(loopStateDir(rootDir), { recursive: true });
  fs.writeFileSync(statePath(rootDir), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

export function saveProposal(rootDir, proposal) {
  fs.mkdirSync(proposalsDir(rootDir), { recursive: true });
  const p = path.join(proposalsDir(rootDir), `${proposal.proposalId}.json`);
  fs.writeFileSync(p, JSON.stringify(proposal, null, 2) + '\n', 'utf8');
  return p;
}

export function loadProposal(rootDir, proposalId) {
  const p = path.join(proposalsDir(rootDir), `${proposalId}.json`);
  if (!fs.existsSync(p)) throw new Error(`workplace-loop: no proposal on record for "${proposalId}" (${p})`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * Persist the ApprovalQueue approvalIds requestApproval() enqueued for this
 * proposal, so a later, separate CLI invocation (approve/apply/verify) can
 * recover them without scanning the whole queue (lib/workplace-loop/gate.mjs's
 * recordsForApprovalIds reads this field back).
 */
export function saveProposalApprovals(rootDir, proposalId, approvalIds) {
  const proposal = loadProposal(rootDir, proposalId);
  return saveProposal(rootDir, { ...proposal, approvalIds });
}

export function listProposals(rootDir) {
  const dir = proposalsDir(rootDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}
