/**
 * lib/certification/status.mjs — aggregate certification posture across surfaces.
 *
 * Rolls up latest run verdicts, stale-impact markers, and catalog coverage for
 * capabilities, Worker Profiles, skills, artifact types, document categories, and demos.
 */

import fs from 'node:fs';
import { loadRegistry } from '../registry/loader.mjs';
import path from 'node:path';

import { loadCapabilityLedger } from '../capability-ledger.mjs';
import { artifactTypes } from '../artifact-manifest.mjs';
import { loadCertificationStatus } from './stale-impact.mjs';
import { listScenarios } from './scenarios.mjs';
import { listCertificationRunIds, readCertificationRun } from './store.mjs';
import { loadCanonicalScenarios } from './canonical-scenarios.mjs';
import { DOCUMENT_IO_CATEGORIES, validateDocumentIoFixtures } from './document-io-fixtures.mjs';
import { defaultSkillInventoryPath } from './skill-inventory.mjs';

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json')) && fs.existsSync(path.join(current, 'tests'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

function readRegistry(rootDir) {
  const dir = path.join(rootDir, 'registry', 'worker-profiles');
  if (!fs.existsSync(dir)) return { workerProfiles: {} };
  return loadRegistry({ rootDir });
}

function listWorkerProfiles(registry) {
  return Object.values(registry.workerProfiles ?? {});
}

function normalizeStatus({ verdict = null, stale = false, neverRun = true }) {
  if (stale) return 'stale';
  if (!verdict || neverRun) return 'never-run';
  return verdict.status ?? 'never-run';
}

function scanLatestRuns({ rootDir }) {
  const byScenario = new Map();
  const byCapability = new Map();
  for (const runId of listCertificationRunIds({ rootDir })) {
    try {
      const { run } = readCertificationRun(runId, { rootDir });
      const prevScenario = byScenario.get(run.scenarioId);
      if (!prevScenario || run.createdAt > prevScenario.createdAt) {
        byScenario.set(run.scenarioId, run);
      }
      const prevCap = byCapability.get(run.capabilityId);
      if (!prevCap || run.createdAt > prevCap.createdAt) {
        byCapability.set(run.capabilityId, run);
      }
    } catch { /* skip corrupt run */ }
  }
  return { byScenario, byCapability };
}

function staleCapabilitySet({ rootDir }) {
  const { status } = loadCertificationStatus({ rootDir });
  if (!status?.capabilities) return new Set();
  return new Set(
    Object.values(status.capabilities)
      .filter((entry) => entry.status === 'stale')
      .map((entry) => entry.capabilityId),
  );
}

function buildCapabilityRows({ rootDir, byCapability, staleSet }) {
  const { ledger } = loadCapabilityLedger({ rootDir });
  return (ledger.capabilities ?? []).map((cap) => {
    const run = byCapability.get(cap.id);
    const stale = staleSet.has(cap.id);
    return {
      id: cap.id,
      criticality: cap.criticality ?? null,
      status: normalizeStatus({ verdict: run?.verdict, stale, neverRun: !run }),
      lastRunAt: run?.createdAt ?? null,
      lastScenarioId: run?.scenarioId ?? null,
      verdict: run?.verdict ?? null,
    };
  });
}

// Every scenario that belongs to one specialist — its hermetic per-kind entries
// (specialist.<kind>.<name>) and its live behavioral entries (specialist.live.<name>.*).

export function specialistScenarioIds(scenarios, name) {
  const hermetic = new RegExp(`^specialist\\.(representative|adversarial|ambiguous|boundary|cross)\\.${name}$`);
  return scenarios
    .map((s) => String(s.id))
    .filter((id) => hermetic.test(id) || id.startsWith(`specialist.live.${name}.`));
}

// Worst-of across a specialist's own latest runs: one failed scenario fails the row, an
// inconclusive (e.g. a skipped live run) holds it below pass, and the row only reads pass
// when at least one real run passed and none failed. A shared verdict is never smeared
// across every specialist.

export function aggregateSpecialistStatus(runs) {
  if (!runs.length) return { status: 'never-run', lastRunAt: null };
  const statuses = runs.map((r) => r.verdict?.status ?? 'never-run');
  const lastRunAt = runs.map((r) => r.createdAt).filter(Boolean).sort().pop() ?? null;
  if (statuses.includes('fail')) return { status: 'fail', lastRunAt };
  if (statuses.includes('inconclusive')) return { status: 'inconclusive', lastRunAt };
  if (statuses.includes('pass')) return { status: 'pass', lastRunAt };
  return { status: 'never-run', lastRunAt };
}

function buildSpecialistRows({ rootDir, registry, byScenario }) {
  let scenarios = [];
  try {
    scenarios = listScenarios({ repoRoot: rootDir });
  } catch { /* catalog missing in minimal fixtures */ }
  return listWorkerProfiles(registry).map((agent) => {
    const ids = specialistScenarioIds(scenarios, agent.id);
    const runs = ids.map((id) => byScenario.get(id)).filter(Boolean);
    const { status, lastRunAt } = aggregateSpecialistStatus(runs);
    return { id: agent.id, status, lastRunAt, scenarioCount: ids.length };
  });
}

function loadSkillInventoryFile(rootDir) {
  const file = defaultSkillInventoryPath(rootDir);
  if (!fs.existsSync(file)) return { skills: [] };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function buildSkillRows({ rootDir }) {
  const inventory = loadSkillInventoryFile(rootDir);
  const workflowSkills = (inventory.skills ?? []).filter((s) => s.workflowSkill === true);
  return workflowSkills.map((skill) => ({
    id: skill.id,
    status: 'never-run',
    lastRunAt: null,
    scenarioId: null,
  }));
}

function buildArtifactRows({ rootDir, byScenario }) {
  const types = artifactTypes({ rootDir });
  const prdRun = byScenario.get('artifact.release-gate.prd');
  return types.map((type) => ({
    id: type,
    status: type === 'prd' && prdRun
      ? normalizeStatus({ verdict: prdRun.verdict, stale: false, neverRun: false })
      : 'never-run',
    lastRunAt: type === 'prd' ? prdRun?.createdAt ?? null : null,
    scenarioId: type === 'prd' ? 'artifact.release-gate.prd' : null,
  }));
}

function buildDocumentCategoryRows({ rootDir }) {
  const validation = validateDocumentIoFixtures({ rootDir });
  return DOCUMENT_IO_CATEGORIES.map((cat) => ({
    id: cat.id,
    label: cat.label,
    status: 'never-run',
    fixturePresent: validation.errors.every((err) => !err.includes(`/${cat.id}/`)),
    lastRunAt: null,
    scenarioId: null,
  }));
}

function buildDemoRows({ rootDir }) {
  try {
    const { catalog } = loadCanonicalScenarios({ rootDir });
    return (catalog.demos ?? []).map((demo) => ({
      id: demo.id,
      surface: demo.surface ?? null,
      status: 'never-run',
      lastRunAt: null,
      scenarioId: null,
      tape: demo.tape ?? demo.tapePath ?? null,
    }));
  } catch {
    return [];
  }
}

/**
 * @param {object} [opts]
 * @param {string} [opts.rootDir]
 * @param {string} [opts.capabilityId] — filter to one capability
 */
export function buildCertificationStatus({ rootDir = process.cwd(), capabilityId = null } = {}) {
  const root = findConstructRoot(rootDir);
  const registry = readRegistry(root);
  const { byScenario, byCapability } = scanLatestRuns({ rootDir: root });
  const staleSet = staleCapabilitySet({ rootDir: root });

  const report = {
    generatedAt: new Date().toISOString(),
    capabilities: buildCapabilityRows({ rootDir: root, byCapability, staleSet }),
    workerProfiles: buildSpecialistRows({ rootDir: root, registry, byScenario }),
    skills: buildSkillRows({ rootDir: root }),
    artifactTypes: buildArtifactRows({ rootDir: root, byScenario }),
    documentCategories: buildDocumentCategoryRows({ rootDir: root }),
    demos: buildDemoRows({ rootDir: root }),
  };

  if (capabilityId) {
    const cap = report.capabilities.find((c) => c.id === capabilityId);
    const relatedScenarios = listScenarios({ repoRoot: root })
      .filter((s) => s.capabilityId === capabilityId)
      .map((s) => ({
        id: s.id,
        status: normalizeStatus({
          verdict: byScenario.get(s.id)?.verdict,
          stale: staleSet.has(capabilityId),
          neverRun: !byScenario.get(s.id),
        }),
        lastRunAt: byScenario.get(s.id)?.createdAt ?? null,
      }));
    return {
      generatedAt: report.generatedAt,
      capability: cap ?? { id: capabilityId, status: 'never-run' },
      scenarios: relatedScenarios,
      stale: staleSet.has(capabilityId),
    };
  }

  return report;
}

function statusLabel(status) {
  if (status === 'stale') return 'STALE';
  if (status === 'never-run') return 'never-run';
  if (status === 'pass') return 'pass';
  if (status === 'fail') return 'FAIL';
  if (status === 'inconclusive') return 'inconclusive';
  return String(status);
}

function printSection(title, rows, { idKey = 'id' } = {}) {
  process.stdout.write(`\n${title}\n`);
  if (!rows.length) {
    process.stdout.write('  (none)\n');
    return;
  }
  for (const row of rows) {
    const label = statusLabel(row.status);
    const staleMark = row.status === 'stale' ? ' ⚠' : '';
    const neverMark = row.status === 'never-run' ? ' ·' : '';
    const when = row.lastRunAt ? ` @ ${row.lastRunAt}` : '';
    process.stdout.write(`  ${String(row[idKey]).padEnd(40)} ${label}${staleMark}${neverMark}${when}\n`);
  }
}

export function formatCertificationStatus(report, { capabilityId = null } = {}) {
  if (capabilityId) {
    const cap = report.capability;
    process.stdout.write(`Certification status · capability: ${capabilityId}\n`);
    process.stdout.write(`  status: ${statusLabel(cap?.status ?? 'never-run')}\n`);
    if (report.stale) process.stdout.write('  stale: yes (ledger changePaths touched)\n');
    printSection('Scenarios', report.scenarios ?? [], { idKey: 'id' });
    return;
  }

  process.stdout.write(`Certification status · ${report.generatedAt}\n`);
  process.stdout.write('Legend: STALE = evidence outdated · never-run = no recorded run\n');
  printSection('Capabilities', report.capabilities);
  printSection('Specialists', report.workerProfiles);
  printSection('Workflow skills', report.skills);
  printSection('Artifact types', report.artifactTypes);
  printSection('Document categories', report.documentCategories);
  printSection('Demo surfaces', report.demos);
}
