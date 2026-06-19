/**
 * lib/oracle/read-model.mjs — deterministic signal collector for the Oracle
 * meta-controller read model.
 *
 * Aggregates project-scoped observations, outcomes, contract violations,
 * doctor audit lines, alignment census, and adapter parity into one snapshot
 * suitable for synthesis. Never throws — missing paths yield empty sections.
 */

import fs from 'node:fs';
import path from 'node:path';

import { checkProjectParity } from '../parity.mjs';

const RECENT_MS = 24 * 60 * 60 * 1000;
const DOCTOR_LIMIT = 50;
const VIOLATION_LIMIT = 100;

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readRecentJsonl(filePath, { since = 0, limit = 200 } = {}) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      let row;
      try { row = JSON.parse(lines[i]); } catch { continue; }
      const ts = row.ts ?? row.timestamp ?? (row.createdAt ? Date.parse(row.createdAt) : 0);
      if (since && ts < since) break;
      out.push(row);
    }
    return out.reverse();
  } catch {
    return [];
  }
}

function collectObservations(projectDir) {
  const dir = path.join(projectDir, '.cx', 'observations');
  if (!fs.existsSync(dir)) {
    return { present: false, count: 0, indexCount: 0, recent: [] };
  }

  const indexPath = path.join(dir, 'index.json');
  const index = readJsonSafe(indexPath);
  const indexEntries = Array.isArray(index) ? index : (index?.entries ?? []);

  let fileCount = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'index.json') fileCount++;
    }
  } catch { /* ignore */ }

  const cutoff = Date.now() - RECENT_MS;
  const recent = [];
  for (const item of indexEntries) {
    const ts = item.timestamp || item.ts || item.createdAt;
    if (!ts || Date.parse(ts) < cutoff) continue;
    recent.push({
      id: item.id,
      role: item.role ?? null,
      category: item.category ?? null,
      summary: String(item.summary ?? '').slice(0, 240),
      ts,
    });
    if (recent.length >= 25) break;
  }

  return {
    present: true,
    count: fileCount,
    indexCount: indexEntries.length,
    recent,
  };
}

function collectOutcomesSummary(projectDir) {
  const file = path.join(projectDir, '.cx', 'outcomes', '_summary.json');
  const data = readJsonSafe(file);
  if (!data) return { present: false, roles: {} };
  return {
    present: true,
    generatedAt: data.generatedAt ?? null,
    roles: data.roles ?? {},
  };
}

function collectContractViolations(projectDir) {
  const file = path.join(projectDir, '.cx', 'contract-violations.jsonl');
  const since = Date.now() - RECENT_MS;
  const recent = readRecentJsonl(file, { since, limit: VIOLATION_LIMIT });
  return {
    present: fs.existsSync(file),
    recentCount: recent.length,
    recent: recent.map((r) => ({
      ts: r.ts,
      contractId: r.contractId ?? null,
      agent: r.agent ?? null,
      verdict: r.verdict ?? 'CONTRACT_VIOLATION',
      direction: r.direction ?? null,
    })),
  };
}

function collectDoctorLog(homeDir) {
  const file = path.join(homeDir, '.cx', 'doctor-log.jsonl');
  const since = Date.now() - RECENT_MS;
  const recent = readRecentJsonl(file, { since, limit: DOCTOR_LIMIT });
  return {
    present: fs.existsSync(file),
    recentCount: recent.length,
    recent: recent.map((r) => ({
      ts: r.ts,
      kind: r.kind ?? null,
      watcher: r.watcher ?? null,
      action: r.action ?? null,
      result: r.result ?? null,
      summary: String(r.summary ?? '').slice(0, 240),
    })),
  };
}

function collectAlignmentCensus(rootDir) {
  const file = path.join(rootDir, 'audit-artifacts', 'alignment-census.json');
  const data = readJsonSafe(file);
  if (!data) return { present: false };
  return {
    present: true,
    generatedAt: data.generatedAt ?? data.ts ?? null,
    summary: data.summary ?? null,
    dimensions: data.dimensions ?? null,
    counts: data.counts ?? null,
  };
}

/**
 * Collect the Oracle read model from durable Construct signals.
 *
 * @param {object} opts
 * @param {string} opts.rootDir    — Construct package root (census, parity registry)
 * @param {string} opts.projectDir — active project root (.cx/ signals)
 * @param {string} opts.homeDir    — user home (~/.cx/doctor-log.jsonl)
 */
export function collectReadModel({ rootDir, projectDir, homeDir }) {
  const collectedAt = new Date().toISOString();
  let parity;
  try {
    parity = checkProjectParity({ rootDir, projectDir });
  } catch (err) {
    parity = { ok: false, skipped: false, error: err.message, surfaces: [], summary: [`parity check failed: ${err.message}`] };
  }

  return {
    collectedAt,
    rootDir,
    projectDir,
    homeDir,
    observations: collectObservations(projectDir),
    outcomes: collectOutcomesSummary(projectDir),
    contractViolations: collectContractViolations(projectDir),
    doctorLog: collectDoctorLog(homeDir),
    alignmentCensus: collectAlignmentCensus(rootDir),
    parity,
  };
}
