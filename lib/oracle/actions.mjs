/**
 * lib/oracle/actions.mjs — Oracle tick executor with bounded-auto policy.
 *
 * Auto actions: alignment census spawn, registry validate import, adapters
 * sync (Construct tool repo only). Approve actions queue to
 * <project>/.cx/oracle/pending.jsonl. Denied actions are skipped.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { collectReadModel } from './read-model.mjs';
import { synthesizeVerdict } from './synthesize.mjs';
import { classifyAction } from './policy.mjs';
import { isConstructPackageRepo } from '../host-disposition.mjs';
import { syncProjectAdapters } from '../adapters-sync.mjs';

function pendingPath(projectDir) {
  return path.join(projectDir, '.cx', 'oracle', 'pending.jsonl');
}

function ensureOracleDir(projectDir) {
  const dir = path.join(projectDir, '.cx', 'oracle');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function appendPending(projectDir, record) {
  ensureOracleDir(projectDir);
  const line = JSON.stringify({ ...record, queuedAt: new Date().toISOString() }) + '\n';
  fs.appendFileSync(pendingPath(projectDir), line, 'utf8');
}

export function listPending(projectDir) {
  const file = pendingPath(projectDir);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

export function approvePending(projectDir, id) {
  const pending = listPending(projectDir);
  const match = pending.find((p) => p.id === id);
  if (!match) return { ok: false, reason: 'not-found' };
  if (match.status === 'approved') return { ok: true, already: true, action: match };
  match.status = 'approved';
  match.approvedAt = new Date().toISOString();
  const file = pendingPath(projectDir);
  fs.writeFileSync(file, pending.map((p) => JSON.stringify(p)).join('\n') + (pending.length ? '\n' : ''), 'utf8');
  return { ok: true, action: match };
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
      return { kind, ok: report.valid, errors: report.errors?.length ?? 0 };
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
 * actions, queue approve actions.
 */
export async function runOracleTick({ rootDir, projectDir, homeDir, dryRun = false } = {}) {
  const readModel = collectReadModel({ rootDir, projectDir, homeDir });
  const synthesis = synthesizeVerdict(readModel);

  const executed = [];
  const queued = [];
  const skipped = [];

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
    const id = `oracle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pending = {
      id,
      kind: rec.kind,
      summary: rec.summary,
      classification,
      status: 'pending',
      context: { ...rec },
    };
    if (!dryRun) appendPending(projectDir, pending);
    queued.push(pending);
  }

  const tick = {
    at: new Date().toISOString(),
    dryRun,
    verdict: synthesis.verdict,
    gaps: synthesis.gaps,
    executed,
    queued,
    skipped,
  };

  return { readModel, ...synthesis, tick };
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export function defaultRootDir() {
  return path.resolve(MODULE_DIR, '../..');
}
