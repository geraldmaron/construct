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
import { loadRegistry, listWorkerProfiles } from '../registry/loader.mjs';
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
import { GRAPH_SEED_FILES } from '../graph/staleness.mjs';
import { recentViolations } from '../contracts/violation-log.mjs';
import { configPath } from '../config-dir.mjs';
import { doctorRoot } from '../config/xdg.mjs';
import { summarizeToolNameMisses, summarizeToolFailures } from '../mcp/tool-recovery.mjs';
import { loadProjectConfig } from '../config/project-config.mjs';
import { validateDirective, resolveEffectiveDirectivesFromConfig } from '../directives/directive-config.mjs';
import { readDirectiveState, isDirectiveDue } from '../directives/due-tracker.mjs';

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
  const dir = configPath(projectDir, 'observations');
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
      workerProfileId: item.role ?? null,
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
  const file = configPath(projectDir, 'outcomes', '_summary.json');
  const data = readJsonSafe(file);
  if (!data) return { present: false, workerProfiles: {} };
  return {
    present: true,
    generatedAt: data.generatedAt ?? null,
    workerProfiles: data.roles ?? {},
  };
}

// Tool discoverability: names/failures the recovery layer already logs (lib/mcp/tool-recovery.mjs)
// but that nothing consumed downstream — a name missed repeatedly is a tool agents cannot find.

function collectToolDiscoverability(projectDir) {
  const misses = summarizeToolNameMisses(projectDir);
  const failures = summarizeToolFailures(projectDir);
  return {
    misses: { total: misses.total, recovered: misses.recovered, top: misses.top },
    failures: { total: failures.total, top: failures.top },
  };
}

function collectContractViolations(projectDir) {
  const file = configPath(projectDir, 'contract-violations.jsonl');
  const recent = recentViolations({
    windowMs: RECENT_MS,
    repoRoot: projectDir,
    excludeDevNoise: true,
    limit: VIOLATION_LIMIT,
  });
  return {
    present: fs.existsSync(file),
    recentCount: recent.length,
    recent: recent.map((r) => ({
      ts: r.ts,
      contractId: r.contractId ?? null,
      workerProfileId: r.agent ?? null,
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

// The living dependency matrix: file↔capability↔workflow↔test graph. Surfaces
// three oversight signals — staleness (seeds changed since last build),
// coverage (capabilities/workflows with no impl or test edge), and freshness
// (a capability whose realizing files changed after its lastValidated stamp).
// Never throws; an absent graph yields present:false. loadGraph/hashFiles
// below are backend-agnostic (construct-b0nny.3): on Node >=22.5 the host
// graph resolves from the relational SQLite store rather than
// `.construct/graph/` JSONL, with an identical return shape — this module
// needed no changes to migrate onto it.

// hashFiles below still hashes the legacy flat GRAPH_SEED_FILES list, kept as
// GRAPH_SEED_FILES' documented "legacy combined sourceHash" role
// (lib/graph/staleness.mjs) for this exact consumer.

// Freshness needs content identity, not mtime: any checkout, rebase, or touch
// rewrites file mtimes repo-wide without changing a single byte, so a pure
// mtime > stamp comparison flags every capability on every fresh clone. A
// file only "changed since lastValidated" if its working-tree bytes differ
// from HEAD (dirty edit) or a commit touching it landed after the stamp
// (`git log --since`). Both checks are batched into one spawnSync each so
// the cost stays O(1) per capability rather than O(realizers).

function gitDirtyFiles(rootDir) {
  try {
    const res = spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd: rootDir, encoding: 'utf8' });
    if (res.status !== 0) return null;
    return new Set(res.stdout.split('\n').map((l) => l.trim()).filter(Boolean));
  } catch {
    return null;
  }
}

function gitFilesChangedSince(rootDir, sinceIso, rels) {
  if (rels.length === 0) return new Set();
  try {
    const res = spawnSync(
      'git',
      ['log', `--since=${sinceIso}`, '--name-only', '--pretty=format:', '--', ...rels],
      { cwd: rootDir, encoding: 'utf8' },
    );
    if (res.status !== 0) return null;
    return new Set(res.stdout.split('\n').map((l) => l.trim()).filter(Boolean));
  } catch {
    return null;
  }
}

// Validation-grade freshness must not reuse the advisory `realizes` closure:
// build-import-graph.mjs deliberately widens that edge set for impact tracing
// (a broad edge only widens advisory reach, which is safe there). Reused
// here it would treat all 300+ files transitively reachable from a
// capability's tests as realizers, guaranteeing false positives. The
// freshness gate instead only trusts direct, declaration-sourced realizes
// edges (source: 'registry') — the curated implFiles list a capability
// actually declares — leaving the wide closure untouched for `construct
// trace`/`impact`.

function directRealizers(graph, capId) {
  const edges = graph.in.get(capId) || [];
  return edges
    .filter((e) => e.rel === 'realizes' && (e.sources || []).includes('registry'))
    .map((e) => e.from.slice('file:'.length));
}

export function collectDependencyGraph(rootDir, projectDir) {
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

  const dirtyFiles = gitDirtyFiles(rootDir);
  const untested = [];
  for (const cap of nodesByType(graph, 'capability')) {
    const lastValidated = cap.attrs?.lastValidated;
    if (!lastValidated) continue;
    const stamp = Date.parse(lastValidated);
    if (!Number.isFinite(stamp)) continue;
    const realizers = directRealizers(graph, cap.id);
    if (realizers.length === 0) continue;
    const committedChanged = gitFilesChangedSince(rootDir, lastValidated, realizers);
    let changed = 0;
    for (const rel of realizers) {
      try {
        fs.statSync(path.join(rootDir, rel));
      } catch {
        continue;
      }
      const dirty = dirtyFiles?.has(rel) ?? false;
      const committed = committedChanged?.has(rel) ?? false;
      if (dirty || committed) changed++;
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
 * Which configured directives (construct.config.json directives[]) are due
 * right now, per the same due-tracker state lib/embed/daemon.mjs's
 * directive-runner job reads and advances — the read model and the daemon
 * job agree on "due" by construction, not by convention. A directive that
 * fails shape validation is excluded here the same way the daemon job skips
 * it, rather than surfacing as a false due signal to the Oracle.
 */
function collectDueDirectives(projectDir, env = process.env) {
  try {
    const { config: projectConfig } = loadProjectConfig(projectDir, env);
    const rawDirectives = projectConfig?.directives;
    if (!Array.isArray(rawDirectives) || rawDirectives.length === 0) {
      return { present: false, due: [] };
    }

    let knownWorkerProfiles = [];
    try {
      knownWorkerProfiles = listWorkerProfiles().map((profile) => profile.id);
    } catch { /* unresolved catalog: directive validation remains best effort */ }

    const due = [];
    for (const directive of resolveEffectiveDirectivesFromConfig(projectConfig)) {
      if (validateDirective(directive, 0, { knownWorkerProfiles: knownWorkerProfiles }).length) continue;
      if (isDirectiveDue(directive, readDirectiveState(projectDir, directive.id))) {
        const { specialist, ...canonicalDirective } = directive;
        // Compat surface (owner: construct-tsyfe.8.18, expires: 2026-12-31):
        // pre-2.0 directive field specialist maps to workerProfileId.
        due.push({
          ...canonicalDirective,
          workerProfileId: directive.workerProfileId ?? specialist ?? null,
        });
      }
    }
    return { present: true, due };
  } catch (err) {
    return { present: false, due: [], error: err.message };
  }
}

function collectPolicyGovernance(rootDir) {
  const registry = loadRegistry({ rootDir });
  const profiles = new Set(Object.keys(registry.workerProfiles));
  const policies = Object.values(registry.policies);
  const unresolvedReferences = [];
  for (const policy of policies) {
    for (const workerProfile of [
      policy.ownerWorkerProfile,
      ...policy.approvalWorkerProfiles,
      ...policy.vetoWorkerProfiles,
      ...policy.escalationWorkerProfiles,
    ]) {
      if (workerProfile !== 'construct' && !profiles.has(workerProfile)) {
        unresolvedReferences.push({ policy: policy.id, workerProfile });
      }
    }
  }
  return {
    present: true,
    policyCount: policies.length,
    governedDecisionCount: new Set(policies.flatMap((policy) => policy.governs)).size,
    unresolvedReferences,
  };
}

/**
 * Collect the Oracle read model from durable Construct signals.
 *
 * @param {object} opts
 * @param {string} opts.rootDir    — Construct package root (census, parity registry)
 * @param {string} opts.projectDir — active project root (.construct/ signals)
 * @param {string} opts.homeDir    — user home (~/.construct/doctor-log.jsonl)
 * @param {NodeJS.ProcessEnv} [opts.env]
 */
export function collectReadModel({ rootDir, projectDir, homeDir, env = process.env }) {
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
  const policyGovernance = collectPolicyGovernance(rootDir);

  return {
    collectedAt,
    rootDir,
    projectDir,
    homeDir,
    observations: collectObservations(projectDir),
    outcomes: collectOutcomesSummary(projectDir),
    toolDiscoverability: collectToolDiscoverability(projectDir),
    contractViolations: collectContractViolations(projectDir),
    doctorLog: collectDoctorLog(homeDir),
    alignmentCensus: collectAlignmentCensus(rootDir),
    registryValidate,
    parity,
    orgGraph,
    artifactGate,
    policyGovernance,
    beads: collectBeadsOpenCount(projectDir),
    hookFailures: collectHookFailures(homeDir),
    structure: collectStructureSprawl(projectDir),
    deadCode: collectDeadCodeSync(rootDir, projectDir),
    dependencyGraph: collectDependencyGraph(rootDir, projectDir),
    directives: collectDueDirectives(projectDir, env),
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
