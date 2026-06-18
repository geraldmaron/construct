/**
 * findings.mjs — the single severity-ranked ledger every audit phase appends to.
 *
 * One record shape across all phases so the beads emitter can turn any row into an
 * issue mechanically. IDs are deterministic (phase:type:target) so re-running a phase
 * updates rows in place instead of duplicating them.
 */

import { readJson, writeJson } from './artifacts.mjs';

export const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function makeId(phase, type, target) {
  const slug = String(target).replace(/[^a-zA-Z0-9._/-]+/g, '_').slice(0, 80);
  return `${phase}:${type}:${slug}`;
}

// Merge new rows for one phase into findings.json: drop the phase's prior rows, add the
// fresh set, re-sort by severity then id. Other phases' rows are left untouched.

export function recordFindings(phase, rows) {
  const ledger = readJson('findings.json') || { generated: 'audit harness', findings: [] };
  const kept = ledger.findings.filter((f) => f.phase !== phase);
  const normalized = rows.map((r) => ({
    id: r.id || makeId(phase, r.type, r.target),
    phase,
    target: r.target,
    severity: r.severity || 'medium',
    type: r.type,
    tier: r.tier || 'mechanical',
    evidence: r.evidence || '',
    recommendation: r.recommendation || '',
    status: r.status || 'open',
  }));
  const all = [...kept, ...normalized].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || a.id.localeCompare(b.id),
  );
  writeJson('findings.json', { generated: 'audit harness', findings: all });
  return normalized;
}

export function countOpen(phase) {
  const ledger = readJson('findings.json');
  if (!ledger) return 0;
  return ledger.findings.filter((f) => (!phase || f.phase === phase) && f.status === 'open').length;
}
