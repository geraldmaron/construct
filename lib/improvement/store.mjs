/**
 * lib/improvement/store.mjs — durable proposal records for the governed
 * improvement loop (construct-6zga.1.11).
 *
 * Each submission is a versioned JSON file under `.construct/improvement/proposals/`
 * holding the proposal, held-out dataset item, evaluation report, optional
 * specialist trace, governance verdict, and rollout plan. The store is the
 * operator surface's source of truth; the controller never mutates artifacts in
 * place without persisting the new state here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { configPath } from '../config-dir.mjs';

export const IMPROVEMENT_STORE_SCHEMA_VERSION = 1;

export function improvementDir(projectDir) {
  return configPath(projectDir, 'improvement');
}

export function proposalsDir(projectDir) {
  return path.join(improvementDir(projectDir), 'proposals');
}

export function proposalRecordPath(projectDir, id) {
  return path.join(proposalsDir(projectDir), `${id}.json`);
}

export function approversPath(projectDir) {
  return path.join(improvementDir(projectDir), 'approvers.json');
}

function ensureProposalsDir(projectDir) {
  const dir = proposalsDir(projectDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadApprovers(projectDir) {
  const file = approversPath(projectDir);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed?.identities) ? parsed.identities : null;
  } catch {
    return null;
  }
}

export function saveRecord(projectDir, record) {
  ensureProposalsDir(projectDir);
  const id = record?.id || record?.proposal?.id;
  if (!id) throw new Error('record id required');
  const now = new Date().toISOString();
  const { projectDir: _omit, ...rest } = record;
  const payload = {
    schemaVersion: IMPROVEMENT_STORE_SCHEMA_VERSION,
    ...rest,
    id,
    updatedAt: now,
    submittedAt: record.submittedAt || now,
  };
  fs.writeFileSync(proposalRecordPath(projectDir, id), JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

export function loadRecord(projectDir, id) {
  const file = proposalRecordPath(projectDir, id);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function listRecords(projectDir, { state = null } = {}) {
  const dir = proposalsDir(projectDir);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const record = loadRecord(projectDir, name.replace(/\.json$/, ''));
    if (!record) continue;
    if (state && record.proposal?.state !== state) continue;
    out.push(record);
  }
  out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return out;
}
