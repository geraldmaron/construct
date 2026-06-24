/**
 * lib/oracle/read-model.mjs — deterministic signal collector for the Oracle
 * meta-controller read model.
 *
 * Aggregates project-scoped observations, outcomes, contract violations,
 * doctor audit lines, alignment census, org graph, dead code, beads hygiene,
 * and adapter parity into one snapshot suitable for synthesis. Never throws —
 * missing paths yield empty sections.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { checkProjectParity } from '../parity.mjs';
import { validateCapabilityRegistry } from '../registry/validate.mjs';
import { isConstructPackageRepo } from '../host-disposition.mjs';
import { detectExistingContent } from '../init/detect-existing-structure.mjs';
import { collectOrgGraph } from './org-graph.mjs';
import { collectArtifactGateSignals } from './artifact-gate.mjs';
import { loadGraph, nodesByType, dependentsOf } from '../graph/store.mjs';
import { hashFiles } from '../graph/build-from-registry.mjs';
import { readViolationSupersedeCutoff } from '../contracts/violation-log.mjs';
import { doctorRoot } from '../config/xdg.mjs';

const RECENT_MS = 24 * 60 * 60 * 1000;
const DOCTOR_LIMIT = 50;
const VIOLATION_LIMIT = 100;
const CENSUS_STALE_MS = 7 * 24 * 60 * 60 * 1000;

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
  const supersedeCutoff = readViolationSupersedeCutoff(projectDir);
  const recent = readRecentJsonl(file, { since, limit: VIOLATION_LIMIT })
    .filter((row) => {
      if (!row?.ts) return false;
      if (supersedeCutoff != null && new Date(row.ts).getTime() <= supersedeCutoff) return false;
      return true;
    });
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
  const file = path.join(doctorRoot(homeDir), 'doctor-log.jsonl');
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
  const generatedAt = data.generatedAt ?? data.ts ?? null;
  const ageMs = generatedAt ? Date.now() - Date.parse(generatedAt) : Infinity;
  return {
    present: true,
    generatedAt,
    ageMs: Number.isFinite(ageMs) ? ageMs : null,
    stale: Number.isFinite(ageMs) && ageMs > CENSUS_STALE_MS,
    summary: data.summary ?? null,
    dimensions: data.dimensions ?? null,
    counts: data.counts ?? null,
    audit: {
      findingsCount: data.audit?.findingsCount ?? (data.audit?.findings?.length ?? 0),
      findings: (data.audit?.findings ?? []).slice(0, 20),
      regressions: data.audit?.ratchet?.regressions ?? [],
    },
    rootLayout: data.rootLayout ?? null,
    skills: {
      trueOrphanCount: data.skills?.trueOrphanCount ?? 0,
      composerReachableCount: data.skills?.composerReachableCount ?? null,
      pass: data.skills?.pass ?? null,
    },
  };
}

function collectRegistryValidate(rootDir) {
  try {
    const report = validateCapabilityRegistry({ rootDir });
    return {
      valid: report.valid,
      errorCount: report.errors?.length ?? 0,
      warningCount: report.warnings?.length ?? 0,
      warnings: (report.warnings ?? []).slice(0, 10),
      needsRun: !report.valid || (report.warnings?.length ?? 0) > 0,
    };
  } catch (err) {
    return { valid: false, errorCount: 1, warningCount: 0, needsRun: true, error: err.message };
  }
}

function collectBeadsOpenCount(projectDir) {
  try {
    const result = spawnSync('bd', ['list', '--json', '--status=open'], {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0) return { present: false, openCount: 0 };
    const parsed = JSON.parse(result.stdout || '[]');
    const issues = Array.isArray(parsed) ? parsed : (parsed.issues ?? []);
    return { present: true, openCount: issues.length };
  } catch {
    return { present: false, openCount: 0 };
  }
}

function collectHookFailures(homeDir) {
  const file = path.join(doctorRoot(homeDir), 'doctor-log.jsonl');
  const since = Date.now() - RECENT_MS;
  const recent = readRecentJsonl(file, { since, limit: DOCTOR_LIMIT });
  const failures = recent.filter((r) =>
    (r.kind === 'hook' || String(r.watcher ?? '').includes('hook'))
    && (r.result === 'failed' || r.result === 'error'),
  );
  return { count: failures.length, recent: failures.slice(0, 10) };
}

function collectStructureSprawl(projectDir) {
  try {
    const detection = detectExistingContent(projectDir);
    const laneCount = Object.keys(detection.existingLanes ?? {}).length;
    const duplicateLanes = Object.entries(detection.existingLanes ?? {})
      .filter(([, entries]) => (entries?.length ?? 0) > 1)
      .map(([lane]) => lane);
    return {
      present: laneCount > 0 || !!detection.customIntake?.ingestScript,
      laneCount,
      duplicateLanes,
      customIntake: detection.customIntake ?? null,
      rootTemplates: detection.rootTemplates ?? null,
    };
  } catch {
    return { present: false, laneCount: 0, duplicateLanes: [] };
  }
}

const GRAPH_SEED_FILES = [
  'registry/capabilities.json',
  'specialists/contracts.json',
  'lib/embedded-contract/workflow-defs.mjs',
];

// The living dependency matrix: file↔capability↔workflow↔test graph at
// .cx/graph/. Surfaces three oversight signals — staleness (seeds changed
// since last build), coverage (capabilities/workflows with no impl or test
// edge), and freshness (a capability whose realizing files changed after its
// lastValidated stamp). Never throws; an absent graph yields present:false.

function collectDependencyGraph(rootDir, projectDir) {
  const graph = loadGraph(projectDir);
  if (!graph.exists) {
    return { present: false, applicable: isConstructPackageRepo(projectDir) };
  }

  let stale = false;
  let staleReason = null;
  try {
    const current = hashFiles(rootDir, GRAPH_SEED_FILES);
    if (graph.meta?.sourceHash && current !== graph.meta.sourceHash) {
      stale = true;
      staleReason = 'registry/contracts/workflow seeds changed since last build';
    }
  } catch { /* hashing best-effort */ }

  const capabilitiesWithoutTest = [];
  const capabilitiesWithoutImpl = [];
  for (const cap of nodesByType(graph, 'capability')) {
    if (dependentsOf(graph, cap.id, 'validates').length === 0) capabilitiesWithoutTest.push(cap.id.slice('capability:'.length));
    if (dependentsOf(graph, cap.id, 'realizes').length === 0) capabilitiesWithoutImpl.push(cap.id.slice('capability:'.length));
  }
  const workflowsUncovered = nodesByType(graph, 'workflow')
    .filter((wf) => dependentsOf(graph, wf.id, 'embeds').length === 0)
    .map((wf) => wf.id.slice('workflow:'.length));
  const orphanFileCount = nodesByType(graph, 'file')
    .filter((f) => (graph.out.get(f.id) || []).every((e) => e.rel !== 'realizes')).length;

  const untested = [];
  for (const cap of nodesByType(graph, 'capability')) {
    const lastValidated = cap.attrs?.lastValidated;
    if (!lastValidated) continue;
    const stamp = Date.parse(lastValidated);
    if (!Number.isFinite(stamp)) continue;
    const realizers = dependentsOf(graph, cap.id, 'realizes').map((id) => id.slice('file:'.length));
    let changed = 0;
    for (const rel of realizers) {
      try {
        if (fs.statSync(path.join(rootDir, rel)).mtimeMs > stamp) changed++;
      } catch { /* file gone — coverage handles it */ }
    }
    if (changed > 0) untested.push({ capability: cap.id.slice('capability:'.length), changedFiles: changed, lastValidated });
  }

  return {
    present: true,
    applicable: true,
    generatedAt: graph.meta?.generatedAt ?? null,
    sourceHash: graph.meta?.sourceHash ?? null,
    stale,
    staleReason,
    nodeCount: graph.nodes.size,
    edgeCount: graph.edges.length,
    nodesByType: graph.meta?.nodesByType ?? {},
    edgesByRel: graph.meta?.edgesByRel ?? {},
    coverage: { capabilitiesWithoutTest, capabilitiesWithoutImpl, workflowsUncovered, orphanFileCount },
    untested,
  };
}

function collectDeadCodeSync(rootDir, projectDir) {
  if (!isConstructPackageRepo(projectDir)) {
    return { present: false, skipped: true, deadCount: 0, regressions: [] };
  }
  return { present: false, pendingAsync: true, deadCount: 0, regressions: [] };
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

  const registryValidate = collectRegistryValidate(rootDir);
  const orgGraph = collectOrgGraph({ rootDir, projectDir, parity, registryValidate });
  const artifactGate = collectArtifactGateSignals({ rootDir, projectDir });

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
    registryValidate,
    parity,
    orgGraph,
    artifactGate,
    beads: collectBeadsOpenCount(projectDir),
    hookFailures: collectHookFailures(homeDir),
    structure: collectStructureSprawl(projectDir),
    deadCode: collectDeadCodeSync(rootDir, projectDir),
    dependencyGraph: collectDependencyGraph(rootDir, projectDir),
  };
}

/**
 * Async enrichment for beads drift and dead-code audit (tool repo only).
 */
export async function enrichReadModel(model) {
  let beads = { ...model.beads };
  try {
    const { detectBeadsDrift } = await import('../beads/drift.mjs');
    const drift = detectBeadsDrift();
    beads = {
      ...beads,
      stuckInProgress: drift.counts?.stuckInProgress ?? 0,
      staleOpen: drift.counts?.staleOpen ?? 0,
      mergeDrift: drift.counts?.mergeDrift ?? 0,
      totalIssues: drift.totalIssues ?? 0,
    };
  } catch { /* bd unavailable */ }

  let deadCode = model.deadCode;
  if (isConstructPackageRepo(model.projectDir)) {
    try {
      const { deadcodeFindings } = await import('../../scripts/audit/02-deadcode.mjs');
      const findings = deadcodeFindings();
      const baselinePath = path.join(model.rootDir, 'scripts', 'audit', 'baseline.json');
      const baseline = readJsonSafe(baselinePath) ?? { acceptedIds: [] };
      const accepted = new Set(baseline.acceptedIds ?? []);
      const regressions = findings.filter((f) => f.type === 'dead-module' && !accepted.has(f.target));
      deadCode = {
        present: true,
        deadCount: findings.filter((f) => f.type === 'dead-module').length,
        testOnlyCount: findings.filter((f) => f.type === 'module-test-only').length,
        regressions: regressions.map((f) => f.target),
        findings: findings.slice(0, 15),
      };
    } catch {
      deadCode = { present: false, deadCount: 0, regressions: [] };
    }
  }

  return { ...model, beads, deadCode };
}
