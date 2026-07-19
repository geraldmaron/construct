/**
 * scripts/alignment/census.mjs — reproducible alignment census for Phase 0 scorecard.
 *
 * Aggregates audit harness output, skill bindings, workflow cross-maps, parity,
 * and capability test coverage into one JSON artifact under audit-artifacts/.
 * Every count is derived from repo paths the scorecard cites inline.
 *
 * Run: node scripts/alignment/census.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { smokeFindings } from '../audit/01-smoke.mjs';
import { deadcodeFindings } from '../audit/02-deadcode.mjs';
import { docsFindings } from '../audit/03-docs.mjs';
import { namingFindings } from '../audit/03b-naming.mjs';
import { brandFindings } from '../audit/03d-brand.mjs';
import { rootLayoutFindings } from '../audit/03c-root-layout.mjs';
import { auditFindings } from '../audit/06-audit.mjs';
import { makeId } from '../audit/lib/findings.mjs';
import { writeJson, readJson } from '../audit/lib/artifacts.mjs';
import { REPO_ROOT } from '../audit/lib/handlers.mjs';
import { auditSkills } from '../../lib/audit-skills.mjs';
import { triageBoundOrphans } from '../../lib/registry/consolidation.mjs';
import { getProcedureDefinition, listProcedureDefinitions, PROCEDURE_IDS } from '../../lib/embedded-contract/procedure-definitions.mjs';
import { checkParity } from '../../lib/parity.mjs';
import { loadCapabilities } from '../../lib/platforms/capabilities.mjs';
import { loadRegistry } from '../../lib/registry/loader.mjs';

const WORKFLOW_SKILL_MAP = {
  'evidence-ingest': 'docs/evidence-ingest-workflow',
  'proposal-review': null,
  'prd-draft': 'docs/prd-workflow',
  'architecture-review': null,
  'risk-review': null,
  'research-synthesis': 'docs/research-workflow',
  'transcript-process': 'docs/transcript-synthesis',
  'data-structure': null,
  'memo-draft': 'docs/memo-and-decision-capture',
  'structure-notes': 'operating/unstructured-triage',
};

function collectSkillFiles(skillsDir) {
  const results = [];
  function walk(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, prefix ? `${prefix}/${entry.name}` : entry.name);
      else if (entry.name.endsWith('.md') && entry.name !== 'routing.md') {
        results.push(prefix ? `${prefix}/${entry.name.replace(/\.md$/, '')}` : entry.name.replace(/\.md$/, ''));
      }
    }
  }
  walk(skillsDir);
  return results;
}

function registryBoundOrphans(root) {
  const triage = triageBoundOrphans({ rootDir: root });
  return {
    declaredCount: triage.declaredCount,
    fileCount: triage.fileCount,
    boundOrphans: triage.items.map((i) => i.skill),
    composerReachableCount: triage.composerReachableCount,
    trueOrphanCount: triage.trueOrphanCount,
    aBindCount: triage.aBindCount,
    byCategory: triage.byCategory,
  };
}

function yamlWorkflowTemplates(root) {
  const dir = path.join(root, 'templates', 'workflows');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
}

function workflowCrossMap(root) {
  return PROCEDURE_IDS.map((type) => {
    const def = getProcedureDefinition(type);
    const skill = WORKFLOW_SKILL_MAP[type] ?? null;
    const skillExists = skill ? fs.existsSync(path.join(root, 'skills', `${skill}.md`)) : null;
    return {
      type,
      chain: def?.workerProfiles ?? [],
      skill,
      skillExists,
      outputSchema: def?.outputSchema ?? null,
      defaultApprovalMode: def?.approvalMode ?? null,
    };
  });
}

function collectRootLayoutSummary(rootDir) {
  const rows = rootLayoutFindings(rootDir);
  const legacyDirs = rows.filter((r) => r.type === 'legacy-root-dir').map((r) => r.target);
  const phantomPackPaths = rows.filter((r) => r.type === 'packaging-phantom').map((r) => r.target);
  const staleAutoDocKeys = rows.filter((r) => r.type === 'stale-auto-doc').map((r) => r.target);
  const legacyImports = rows.filter((r) => r.type === 'import-legacy-path').map((r) => r.target);
  return {
    legacyDirs,
    phantomPackPaths,
    staleAutoDocKeys,
    legacyImports,
    findingCount: rows.length,
    clean: rows.length === 0,
  };
}

function capabilityTestCoverage(root) {
  const capDir = path.join(root, 'tests', 'capabilities');
  const legacyMatrix = path.join(root, 'tests', 'registry', 'capability-matrix.json');
  const registryPath = path.join(root, 'registry', 'capabilities.json');
  let entries = [];
  if (fs.existsSync(registryPath)) {
    entries = JSON.parse(fs.readFileSync(registryPath, 'utf8')).capabilities ?? [];
  } else if (fs.existsSync(legacyMatrix)) {
    entries = JSON.parse(fs.readFileSync(legacyMatrix, 'utf8')).capabilities ?? [];
  }
  return entries.map((cap) => {
    const tests = [];
    if (fs.existsSync(capDir)) {
      for (const surface of fs.readdirSync(capDir, { withFileTypes: true })) {
        if (!surface.isDirectory()) continue;
        if (surface.name !== cap.id) continue;
        const dir = path.join(capDir, surface.name);
        for (const f of fs.readdirSync(dir)) {
          if (f.endsWith('.test.mjs')) tests.push(`tests/capabilities/${cap.id}/${f}`);
        }
      }
    }
    return { id: cap.id, criticality: cap.criticality ?? null, lastValidated: cap.lastValidated ?? null, tests };
  });
}

export function runAlignmentCensus({ rootDir = REPO_ROOT, homeDir = process.env.HOME } = {}) {
  const repoDeterministic = (rows) => rows.filter((r) => r.type !== 'audit-chain-broken');
  const phases = [
    ['01-smoke', smokeFindings()],
    ['02-deadcode', deadcodeFindings()],
    ['03-docs', docsFindings()],
    ['03b-naming', namingFindings()],
    ['03d-brand', brandFindings()],
    ['03c-root-layout', rootLayoutFindings()],
    ['06-audit', repoDeterministic(auditFindings())],
  ];
  const findings = phases.flatMap(([phase, rows]) =>
    rows.map((r) => ({ ...r, id: r.id || makeId(phase, r.type, r.target) })),
  );

  const baseline = JSON.parse(fs.readFileSync(path.join(rootDir, 'scripts', 'audit', 'baseline.json'), 'utf8'));
  const ratchetRegressions = findings.map((f) => f.id).filter((id) => !baseline.acceptedIds.includes(id));

  const skills = auditSkills({ rootDir, silent: true });
  const bound = registryBoundOrphans(rootDir);
  const contractsCount = Object.keys(loadRegistry({ rootDir, skipValidation: true }).contracts || {}).length;

  let parity = null;
  try {
    parity = checkParity({ rootDir, homeDir });
  } catch (err) {
    parity = { ok: false, error: err?.message || String(err) };
  }

  let platforms = null;
  try {
    platforms = loadCapabilities();
  } catch (err) {
    platforms = { error: err?.message || String(err) };
  }

  const census = {
    generatedAt: new Date().toISOString(),
    branch: process.env.GIT_BRANCH || 'unknown',
    rootLayout: collectRootLayoutSummary(rootDir),
    audit: {
      commandCount: readJson('command-census.json')?.commands?.length ?? null,
      findingsCount: findings.length,
      findings,
      ratchet: { acceptedIds: baseline.acceptedIds.length, regressions: ratchetRegressions },
    },
    skills: {
      ...skills,
      ...bound,
      auditOrphans: skills.orphanSkills,
    },
    workflows: {
      embeddedCount: PROCEDURE_IDS.length,
      yamlTemplates: yamlWorkflowTemplates(rootDir),
      crossMap: workflowCrossMap(rootDir),
      embeddedList: listProcedureDefinitions(),
    },
    contracts: { count: contractsCount },
    parity,
    platforms: platforms?.hosts ? { hostCount: platforms.hosts.length } : platforms,
    capabilities: capabilityTestCoverage(rootDir),
  };

  writeJson('alignment-census.json', census);
  return census;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const ratchetMode = process.argv.includes('--ratchet');
  const census = runAlignmentCensus();
  process.stdout.write(
    `[alignment:census] skills=${census.skills.fileCount} bound-orphans=${census.skills.boundOrphans.length} ` +
    `composer-reachable=${census.skills.composerReachableCount ?? 0} true-orphans=${census.skills.trueOrphanCount ?? 0} ` +
    `findings=${census.audit.findingsCount} ratchet-regressions=${census.audit.ratchet.regressions.length}\n`,
  );
  if (ratchetMode && census.audit.ratchet.regressions.length > 0) {
    process.stderr.write(`[alignment:census] ratchet failed: ${census.audit.ratchet.regressions.join(', ')}\n`);
    process.exit(1);
  }
}
