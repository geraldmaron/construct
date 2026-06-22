/**
 * lib/audit-specialists.mjs — Specialist/skill corpus audit matrix.
 *
 * Merges live registry, contracts, skills, prompts, and audit-enrichments into
 * one machine-readable matrix. Powers `construct audit specialists` and the
 * human-readable docs/concepts/specialist-skill-audit.md companion.
 */

import fs from 'node:fs';
import path from 'node:path';
import { auditSkills } from './audit-skills.mjs';
import { loadArtifactManifest } from './artifact-manifest.mjs';
import { resolvePerspectiveFromPrompt } from './specialists/prompt-schema.mjs';
import { validateRoleCards } from './certification/role-cards.mjs';
import { auditSpecialistContracts } from './certification/specialist-contracts.mjs';
import { ROLE_DIRECTIVE_RE } from './role-preload.mjs';

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'specialists', 'registry.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function collectSkillFiles(skillsDir) {
  const results = [];
  function walk(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.name.endsWith('.md') && entry.name !== 'routing.md') {
        results.push(prefix ? `${prefix}/${entry.name.replace(/\.md$/, '')}` : entry.name.replace(/\.md$/, ''));
      }
    }
  }
  try { walk(skillsDir); } catch { /* missing */ }
  return results.sort();
}

function parseRoleOverlay(promptPath) {
  if (!fs.existsSync(promptPath)) return null;
  const text = fs.readFileSync(promptPath, 'utf8');
  const m = text.match(ROLE_DIRECTIVE_RE);
  return m ? `roles/${m[1]}` : null;
}

function contractsForSpecialist(contracts, name) {
  const id = name.startsWith('cx-') ? name : `cx-${name}`;
  const related = [];
  for (const c of contracts) {
    if (c.producer === id || c.consumer === id) related.push(c.id);
  }
  return related;
}

function docTypesFromContracts(contracts) {
  const types = new Set();
  for (const c of contracts) {
    const dt = c.trigger?.docAuthoring?.docType;
    if (Array.isArray(dt)) dt.forEach((t) => types.add(t));
    else if (typeof dt === 'string') types.add(dt);
  }
  return [...types];
}

function enforcementForAgent(agent, contracts) {
  const id = `cx-${agent.name}`;
  const items = ['no-fabrication.md', 'neurodivergent-output.md'];
  const related = contracts.filter((c) => c.producer === id || c.consumer === id);
  if (related.some((c) => c.postconditions?.length)) items.push('contracts.json postconditions');
  if (agent.docArtifacts?.length) items.push('artifact structure lint', 'comment-lint on artifact paths');
  if (agent.watchConditions?.length) items.push('watchConditions routing');
  return items;
}

function crossChecks({ registry, manifest, skillAudit, allSkills, contractDocTypes }) {
  const issues = [];
  const manifestTypes = new Set(Object.keys(manifest.artifacts ?? {}));

  for (const agent of registry.specialists ?? []) {
    for (const skill of agent.skills ?? []) {
      if (!allSkills.includes(skill)) {
        issues.push({ kind: 'missing-skill-file', agent: agent.name, skill });
      }
    }
    for (const doc of agent.docArtifacts ?? []) {
      if (!manifestTypes.has(doc)) {
        issues.push({ kind: 'doc-artifact-no-manifest', agent: agent.name, docType: doc });
      }
    }
  }

  for (const dt of contractDocTypes) {
    if (!manifestTypes.has(dt)) {
      issues.push({ kind: 'contract-doc-no-manifest', docType: dt });
    }
  }

  if (skillAudit.missingSkillFiles.length) {
    for (const { agent, skill } of skillAudit.missingSkillFiles) {
      issues.push({ kind: 'registry-missing-skill', agent, skill });
    }
  }

  return issues;
}

export function auditSpecialists({ rootDir, silent = false } = {}) {
  const root = rootDir ?? findConstructRoot();
  const registry = readJson(path.join(root, 'specialists', 'registry.json'));
  const contractsDoc = readJson(path.join(root, 'specialists', 'contracts.json'));
  const enrichments = readJson(path.join(root, 'specialists', 'audit-enrichments.json'));
  const manifest = loadArtifactManifest({ rootDir: root });
  const skillAudit = auditSkills({ rootDir: root, silent: true });
  const allSkills = collectSkillFiles(path.join(root, 'skills'));
  const contractDocTypes = docTypesFromContracts(contractsDoc.contracts ?? []);
  const crossCheckIssues = crossChecks({ registry, manifest, skillAudit, allSkills, contractDocTypes });

  const specialists = (registry.specialists ?? []).map((agent) => {
    const promptPath = agent.promptFile
      ? path.join(root, agent.promptFile)
      : null;
    const meta = enrichments.specialists?.[agent.name] ?? {};
    const perspective = resolvePerspectiveFromPrompt(agent.name, { rootDir: root, registry });
    return {
      name: agent.name,
      id: `cx-${agent.name}`,
      humanEquivalent: meta.humanEquivalent ?? 'unknown',
      primaryOutputs: agent.docArtifacts ?? [],
      skillsBound: agent.skills ?? [],
      roleOverlay: promptPath ? parseRoleOverlay(promptPath) : null,
      researchProfile: meta.researchProfile ?? null,
      toneProfile: meta.toneProfile ?? 'direct',
      challengeModel: {
        tension: perspective?.tension ?? null,
        failureMode: perspective?.failureMode ?? null,
        watchConditions: agent.watchConditions ?? [],
      },
      enforcementToday: enforcementForAgent(agent, contractsDoc.contracts ?? []),
      contracts: contractsForSpecialist(contractsDoc.contracts ?? [], agent.name),
      grade: meta.grade ?? 'adequate',
      gap: meta.gap ?? 'Not assessed',
      beadId: meta.beadId ?? 'construct-hcr9',
      skillCount: (agent.skills ?? []).length,
    };
  });

  const roleOverlays = [];
  const rolesDir = path.join(root, 'skills', 'roles');
  if (fs.existsSync(rolesDir)) {
    for (const f of fs.readdirSync(rolesDir).filter((n) => n.endsWith('.md')).sort()) {
      const key = f.replace(/\.md$/, '');
      const meta = enrichments.roleOverlays?.[key] ?? {};
      roleOverlays.push({
        path: `roles/${key}`,
        grade: meta.grade ?? 'adequate',
        gap: meta.gap ?? 'Not assessed',
      });
    }
  }

  const workflowSkills = allSkills
    .filter((s) => !s.startsWith('roles/'))
    .map((skillPath) => {
      const manifestEntry = Object.entries(manifest.artifacts ?? {}).find(([, v]) => v.workflowSkill === skillPath);
      return {
        path: skillPath,
        artifactType: manifestEntry?.[0] ?? null,
        toneDefault: manifestEntry?.[1]?.toneDefault ?? null,
      };
    });

  const roleCards = validateRoleCards({ rootDir: root });
  const specialistContracts = auditSpecialistContracts({ rootDir: root });
  if (!roleCards.pass) {
    for (const err of roleCards.errors) crossCheckIssues.push({ kind: 'role-card-missing', detail: err });
  }
  if (!specialistContracts.pass) {
    for (const fail of specialistContracts.failures) {
      crossCheckIssues.push({ kind: 'specialist-contract-fail', specialist: fail.specialistId });
    }
  }

  const result = {
    version: 1,
    generatedAt: new Date().toISOString(),
    specialistCount: specialists.length,
    roleOverlayCount: roleOverlays.length,
    workflowSkillCount: workflowSkills.length,
    specialists,
    roleOverlays,
    workflowSkills,
    crossCheckIssues,
    roleCards,
    specialistContracts,
    pass: crossCheckIssues.length === 0 && skillAudit.pass,
  };

  if (!silent) {
    const line = (msg) => process.stdout.write(`${msg}\n`);
    line('Construct Specialist Audit');
    line('═══════════════════════════');
    line(`  Specialists: ${result.specialistCount}`);
    line(`  Role overlays: ${result.roleOverlayCount}`);
    line(`  Workflow skills: ${result.workflowSkillCount}`);
    line('');
    if (crossCheckIssues.length === 0) {
      line('  ✓ Cross-checks passed (skills, docArtifacts, manifest, contracts)');
    } else {
      line(`  ✗ Cross-check issues (${crossCheckIssues.length}):`);
      for (const issue of crossCheckIssues) line(`      - ${JSON.stringify(issue)}`);
    }
    line('');
    line(result.pass ? '  Result: PASS' : '  Result: FAIL');
  }

  return result;
}

export function formatAuditMarkdown(result) {
  const lines = [
    '# Specialist & skill audit',
    '',
    `Generated: ${result.generatedAt}. Re-run \`construct audit specialists --json\` for the live matrix.`,
    '',
    '## Specialists',
    '',
    '| Specialist | Human equivalent | Outputs | Skills | Role overlay | Research | Tone | Grade | Gap |',
    '|---|---|---|---|---|---|---|---|---|',
  ];

  for (const s of result.specialists) {
    lines.push(
      `| cx-${s.name} | ${s.humanEquivalent} | ${s.primaryOutputs.join(', ') || '—'} | ${s.skillCount} | ${s.roleOverlay ?? '—'} | ${s.researchProfile ?? '—'} | ${s.toneProfile} | ${s.grade} | ${s.gap} |`,
    );
  }

  lines.push('', '## Role overlays', '', '| Overlay | Grade | Gap |', '|---|---|---|');
  for (const r of result.roleOverlays) {
    lines.push(`| ${r.path} | ${r.grade} | ${r.gap} |`);
  }

  lines.push('', '## Cross-check issues', '');
  if (result.crossCheckIssues.length === 0) {
    lines.push('None.');
  } else {
    for (const issue of result.crossCheckIssues) {
      lines.push(`- \`${issue.kind}\`: ${JSON.stringify(issue)}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export async function runAuditSpecialistsCli(args = []) {
  const json = args.includes('--json');
  const markdown = args.includes('--markdown');
  const rootDir = args.find((a) => a.startsWith('--root='))?.split('=')[1];
  const result = auditSpecialists({ rootDir, silent: true });

  if (markdown) {
    process.stdout.write(formatAuditMarkdown(result));
  } else if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    auditSpecialists({ rootDir, silent: false });
  }

  if (!result.pass) process.exit(1);
}
