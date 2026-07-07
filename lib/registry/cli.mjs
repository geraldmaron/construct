/**
 * lib/registry/cli.mjs — CLI handlers for registry validate, status, doc generation, and team/specialist lifecycle.
 *
 * Exports handlers for:
 * - runRegistryStatus: Show unified registry contents
 * - runRegistryValidate: Validate unified registry schema and invariants
 * - runRegistryGenerateDocs: Generate capabilities.md from registry
 * - runRegistryDiff: Show changes to unified registry vs. last commit
 * - runRegistryPrune: List orphaned specialist prompts/skills
 * - runTeamAdd: Wizard to add a new team
 * - runTeamRemove: Remove a team with dependency checking
 * - runSpecialistAdd: Wizard to add a new specialist to a team
 * - runSpecialistRemove: Remove a specialist with contract checking
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { validateCapabilityRegistry, loadCapabilityRegistry } from './validate.mjs';
import { generateCapabilitiesDoc, checkCapabilitiesDocDrift } from './generate-docs.mjs';
import { generateAgentManifest, checkAgentManifestDrift } from './agent-manifest.mjs';
import { triageBoundOrphans, formatConsolidationProposalMarkdown } from './consolidation.mjs';
import { loadRegistry } from './loader.mjs';
import { validate as validateUnifiedRegistry } from './validator.mjs';
import { validateRegistry } from '../validator.mjs';
import { assembleRegistryAtGitRef, findTeamFile, removeOrgEntityFile } from './org-io.mjs';
import { configPath } from '../config-dir.mjs';

// The modular org under specialists/org/ is the SSOT. A project may shadow
// fields via a .cx/unified-registry.json overlay; the runtime loader merges
// it, so validation must merge it the same way (overlay wins) and run the
// same invariants the loader enforces on read.

function mergeUnifiedOverlay(base, overlay) {
  for (const section of ['teams', 'specialists', 'contracts', 'policies']) {
    if (!overlay[section]) continue;
    base[section] = base[section] || {};
    for (const [id, value] of Object.entries(overlay[section])) {
      base[section][id] = { ...base[section][id], ...value };
    }
  }
  return base;
}

export async function runUnifiedRegistryValidate(args = [], { rootDir, println = console.log, errorln = console.error } = {}) {
  const jsonOutput = args.includes('--json');
  const orgPath = path.join(rootDir, 'specialists', 'org');
  const overlayPath = configPath(rootDir, 'unified-registry.json');

  let registry;
  try {
    const { clearCache } = await import('./loader.mjs');
    clearCache();
    registry = loadRegistry({ rootDir });
  } catch (err) {
    const message = `Cannot assemble registry from ${orgPath}: ${err.message}`;
    if (jsonOutput) println(JSON.stringify({ ok: false, registryPath: orgPath, errors: [{ id: 'unreadable', message }], warnings: [] }, null, 2));
    else errorln(`✗ ${message}`);
    return 1;
  }

  const overlayApplied = fs.existsSync(overlayPath);

  const result = validateUnifiedRegistry(registry);

  if (jsonOutput) {
    println(JSON.stringify({
      ok: result.ok,
      registryPath: orgPath,
      overlayPath: overlayApplied ? overlayPath : null,
      teams: Object.keys(registry.teams || {}).length,
      specialists: Object.keys(registry.specialists || {}).length,
      contracts: Object.keys(registry.contracts || {}).length,
      policies: Object.keys(registry.policies || {}).length,
      errors: result.errors,
      warnings: result.warnings,
    }, null, 2));
    return result.ok ? 0 : 1;
  }

  println(`Unified registry: ${orgPath} (runtime merge)`);
  if (overlayApplied) println(`Overlay: ${overlayPath}`);
  println(`Teams: ${Object.keys(registry.teams || {}).length}  Specialists: ${Object.keys(registry.specialists || {}).length}  Contracts: ${Object.keys(registry.contracts || {}).length}  Policies: ${Object.keys(registry.policies || {}).length}`);
  if (result.errors.length) {
    errorln(`Errors (${result.errors.length}):`);
    for (const e of result.errors) errorln(`  ✗ ${e.id}: ${e.message}`);
  }
  if (result.warnings.length) {
    println(`Warnings (${result.warnings.length}):`);
    for (const w of result.warnings) println(`  ⚠ ${w.id}: ${w.message}`);
  }
  if (result.ok && !result.warnings.length) println('✓ Unified registry valid');
  else if (result.ok) println('✓ Unified registry valid (with warnings)');
  else errorln('✗ Unified registry invalid');

  return result.ok ? 0 : 1;
}

export async function runRegistryStatus(args = [], { rootDir, println = console.log } = {}) {
  const jsonOutput = args.includes('--json');
  const { capabilities = [] } = loadCapabilityRegistry({ rootDir });

  if (jsonOutput) {
    println(JSON.stringify(capabilities, null, 2));
    return 0;
  }

  println('Construct Capability Registry');
  println('='.repeat(40));
  println('');

  for (const cap of capabilities) {
    const tier = cap.criticality ?? '—';
    println(`[${tier}] ${cap.name ?? cap.id} (${cap.id})`);
    if (cap.description) println(`  ${cap.description}`);
    const surfaces = Object.entries(cap.surfaces ?? {}).filter(([, v]) => v?.supported);
    if (surfaces.length) {
      println(`  surfaces: ${surfaces.map(([n]) => n).join(', ')}`);
    }
    const validated = cap.lastValidated ? cap.lastValidated.slice(0, 10) : 'never';
    println(`  humanGate: ${cap.humanGate ?? '—'}  lastValidated: ${validated}`);
    println('');
  }
  return 0;
}

export async function runRegistryValidate(args = [], { rootDir, println = console.log, errorln = console.error } = {}) {
  if (args.includes('--unified')) {
    return runUnifiedRegistryValidate(args, { rootDir, println, errorln });
  }

  const jsonOutput = args.includes('--json');
  const report = validateCapabilityRegistry({ rootDir });

  if (jsonOutput) {
    println(JSON.stringify(report, null, 2));
    return report.valid ? 0 : 1;
  }

  println(`Registry: ${report.registryPath}`);
  println(`Entries: ${report.count}`);
  if (report.errors.length) {
    errorln(`Errors (${report.errors.length}):`);
    for (const e of report.errors) errorln(`  ✗ ${e}`);
  }
  if (report.warnings.length) {
    println(`Warnings (${report.warnings.length}):`);
    for (const w of report.warnings) println(`  ⚠ ${w}`);
  }
  if (report.valid && !report.warnings.length) println('✓ Registry valid');
  else if (report.valid) println('✓ Registry valid (with warnings)');
  else errorln('✗ Registry invalid');

  return report.valid ? 0 : 1;
}

export async function runRegistryGenerateDocs(args = [], { rootDir, println = console.log, errorln = console.error } = {}) {
  if (args.includes('--check')) {
    let failed = false;

    const docsDrift = checkCapabilitiesDocDrift({ rootDir }).drift;
    if (docsDrift) {
      errorln('capabilities.md drift — run `construct registry:generate-docs`');
      failed = true;
    } else {
      println('capabilities.md is up to date');
    }

    const manifestDrift = checkAgentManifestDrift({ rootDir }).drift;
    if (manifestDrift) {
      errorln('agent-manifest.json drift — run `construct registry:generate-docs`');
      failed = true;
    } else {
      println('agent-manifest.json is up to date');
    }

    return failed ? 1 : 0;
  }
  const out = generateCapabilitiesDoc({ rootDir });
  println(`Generated ${out}`);
  const { path: manifestPath } = generateAgentManifest({ rootDir });
  println(`Generated ${manifestPath}`);
  return 0;
}

export async function runTeamList(args = [], { rootDir, println = console.log } = {}) {
  const { loadRegistry, listTeams } = await import('./loader.mjs');
  const kindFlag = args.indexOf('--kind');
  const kind = kindFlag !== -1 ? args[kindFlag + 1] : null;
  loadRegistry({ rootDir });
  const teams = listTeams({ rootDir, kind });
  if (args.includes('--json')) {
    println(JSON.stringify(teams, null, 2));
    return 0;
  }
  for (const t of teams) {
    println(`${t.id.padEnd(28)} ${t.kind || 'squad'}  ${t.name}`);
  }
  return 0;
}

export async function runTeamShow(args = [], { rootDir, println = console.log, errorln = console.error } = {}) {
  const id = args.find((a) => !a.startsWith('--'));
  if (!id) {
    errorln('Usage: construct team show <team-id>');
    return 1;
  }
  const { getTeam } = await import('./loader.mjs');
  const team = getTeam(id, { rootDir });
  if (!team) {
    errorln(`Team not found: ${id}`);
    return 1;
  }
  if (args.includes('--json')) println(JSON.stringify({ id, ...team }, null, 2));
  else println(JSON.stringify({ id, ...team }, null, 2));
  return 0;
}

export async function runRegistryConsolidationProposal(args = [], { rootDir, println = console.log } = {}) {
  const triage = triageBoundOrphans({ rootDir });
  println(formatConsolidationProposalMarkdown(triage));
  return 0;
}

export async function runRegistryDiff(args = [], { rootDir, println = console.log, errorln = console.error } = {}) {
  const jsonOutput = args.includes('--json');

  let currentRegistry;
  let headRegistry;
  try {
    currentRegistry = loadRegistry({ rootDir });
  } catch (err) {
    errorln(`Error reading current registry: ${err.message}`);
    return 1;
  }

  try {
    headRegistry = assembleRegistryAtGitRef(rootDir, 'HEAD');
  } catch (err) {
    errorln(`No previous org snapshot at HEAD: ${err.message}`);
    return 1;
  }

  const diffs = {
    teamChanges: { added: [], removed: [], modified: [] },
    specialistChanges: { added: [], removed: [], modified: [] },
    contractChanges: { added: [], removed: [], modified: [] },
  };

  // Compare teams
  const currentTeamIds = new Set(Object.keys(currentRegistry.teams || {}));
  const headTeamIds = new Set(Object.keys(headRegistry.teams || {}));

  for (const id of currentTeamIds) {
    if (!headTeamIds.has(id)) {
      diffs.teamChanges.added.push(id);
    } else if (JSON.stringify(currentRegistry.teams[id]) !== JSON.stringify(headRegistry.teams[id])) {
      diffs.teamChanges.modified.push(id);
    }
  }

  for (const id of headTeamIds) {
    if (!currentTeamIds.has(id)) {
      diffs.teamChanges.removed.push(id);
    }
  }

  // Compare specialists
  const currentSpecIds = new Set(Object.keys(currentRegistry.specialists || {}));
  const headSpecIds = new Set(Object.keys(headRegistry.specialists || {}));

  for (const id of currentSpecIds) {
    if (!headSpecIds.has(id)) {
      diffs.specialistChanges.added.push(id);
    } else if (JSON.stringify(currentRegistry.specialists[id]) !== JSON.stringify(headRegistry.specialists[id])) {
      diffs.specialistChanges.modified.push(id);
    }
  }

  for (const id of headSpecIds) {
    if (!currentSpecIds.has(id)) {
      diffs.specialistChanges.removed.push(id);
    }
  }

  // Compare contracts
  const currentContractIds = new Set(Object.keys(currentRegistry.contracts || {}));
  const headContractIds = new Set(Object.keys(headRegistry.contracts || {}));

  for (const id of currentContractIds) {
    if (!headContractIds.has(id)) {
      diffs.contractChanges.added.push(id);
    } else if (JSON.stringify(currentRegistry.contracts[id]) !== JSON.stringify(headRegistry.contracts[id])) {
      diffs.contractChanges.modified.push(id);
    }
  }

  for (const id of headContractIds) {
    if (!currentContractIds.has(id)) {
      diffs.contractChanges.removed.push(id);
    }
  }

  if (jsonOutput) {
    println(JSON.stringify(diffs, null, 2));
    return 0;
  }

  // Human-readable output
  let hasChanges = false;

  if (diffs.teamChanges.added.length || diffs.teamChanges.removed.length || diffs.teamChanges.modified.length) {
    hasChanges = true;
    println('Teams:');
    for (const id of diffs.teamChanges.added) println(`  + ${id}`);
    for (const id of diffs.teamChanges.removed) println(`  - ${id}`);
    for (const id of diffs.teamChanges.modified) println(`  ~ ${id}`);
  }

  if (diffs.specialistChanges.added.length || diffs.specialistChanges.removed.length || diffs.specialistChanges.modified.length) {
    if (hasChanges) println('');
    hasChanges = true;
    println('Specialists:');
    for (const id of diffs.specialistChanges.added) println(`  + ${id}`);
    for (const id of diffs.specialistChanges.removed) println(`  - ${id}`);
    for (const id of diffs.specialistChanges.modified) println(`  ~ ${id}`);
  }

  if (diffs.contractChanges.added.length || diffs.contractChanges.removed.length || diffs.contractChanges.modified.length) {
    if (hasChanges) println('');
    hasChanges = true;
    println('Contracts:');
    for (const id of diffs.contractChanges.added) println(`  + ${id}`);
    for (const id of diffs.contractChanges.removed) println(`  - ${id}`);
    for (const id of diffs.contractChanges.modified) println(`  ~ ${id}`);
  }

  if (!hasChanges) {
    println('No changes to unified registry since last commit.');
  }

  return 0;
}

export async function runRegistryPrune(args = [], { rootDir, println = console.log, errorln = console.error } = {}) {
  const jsonOutput = args.includes('--json');
  const registry = loadRegistry({ rootDir });

  const registeredSpecialists = new Set(Object.keys(registry.specialists || {}));
  const registeredSkills = new Set();

  // Collect all registered skill file paths from registry
  for (const spec of Object.values(registry.specialists || {})) {
    if (Array.isArray(spec.skills)) {
      for (const skillPath of spec.skills) {
        // Skills are stored as paths like "docs/prd-workflow", resolve to file path
        registeredSkills.add(path.join(rootDir, 'skills', `${skillPath.split('/').pop()}.md`));
      }
    }
  }

  const orphaned = { prompts: [], skills: [] };

  // Specialist prompts not registered appear in orphaned list.
  const promptsDir = path.join(rootDir, 'specialists', 'prompts');
  if (fs.existsSync(promptsDir)) {
    const promptFiles = fs.readdirSync(promptsDir).filter(f => f.endsWith('.md'));
    for (const file of promptFiles) {
      const match = file.match(/^cx-(.+)\.md$/);
      if (match) {
        const id = `cx-${match[1]}`;
        if (!registeredSpecialists.has(id)) {
          orphaned.prompts.push(path.join('specialists', 'prompts', file));
        }
      }
    }
  }

  // Skill files not referenced by any specialist are orphaned.
  const skillsDir = path.join(rootDir, 'skills');
  if (fs.existsSync(skillsDir)) {
    const walkSkills = (dir, relPath = '') => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relFullPath = path.join(relPath, entry.name);

        if (entry.isDirectory()) {
          walkSkills(fullPath, relFullPath);
        } else if (entry.name.endsWith('.md')) {
          // A skill is registered if any specialist lists it in their skills array.
          let found = false;
          for (const spec of Object.values(registry.specialists || {})) {
            if (Array.isArray(spec.skills)) {
              for (const skillPath of spec.skills) {
                if (skillPath.endsWith(relFullPath.replace(/\.md$/, '').replace(/\\/g, '/'))) {
                  found = true;
                  break;
                }
              }
            }
            if (found) break;
          }
          if (!found) {
            orphaned.skills.push(path.join('skills', relFullPath));
          }
        }
      }
    };
    walkSkills(skillsDir);
  }

  if (jsonOutput) {
    println(JSON.stringify(orphaned, null, 2));
    return 0;
  }

  if (orphaned.prompts.length === 0 && orphaned.skills.length === 0) {
    println('No orphaned prompt or skill files found.');
    return 0;
  }

  let hasOrphans = false;

  if (orphaned.prompts.length) {
    hasOrphans = true;
    println('Orphaned specialist prompts:');
    for (const file of orphaned.prompts) {
      println(`  rm ${file}`);
    }
  }

  if (orphaned.skills.length) {
    if (hasOrphans) println('');
    hasOrphans = true;
    println('Orphaned skills:');
    for (const file of orphaned.skills) {
      println(`  rm ${file}`);
    }
  }

  return 0;
}

export async function runTeamAdd(args = [], { rootDir, println = console.log, errorln = console.error } = {}) {
  // Interactive wizard not available; requires terminal TTY and structured I/O.
  // Fallback: guide user to manual JSON editing.
  errorln('construct team add requires interactive terminal access.');
  errorln('Edit specialists/org directly and run:');
  errorln('  construct registry validate');
  errorln('');
  errorln('Expected format in teams object:');
  errorln(JSON.stringify({
    'example-group': {
      name: 'Example Group',
      owner: 'example-owner',
      roles: ['example-owner', 'example-member'],
      decisionRights: ['decision-1', 'decision-2'],
      forbiddenDecisions: ['forbidden-1'],
      escalationPath: ['example-owner', 'rd-lead', 'orchestrator'],
      charter: 'Team charter describing scope and responsibility.',
      contact: { slack: '#example', email: 'example@company.com' },
    },
  }, null, 2));
  return 1;
}

export async function runTeamRemove(args = [], { rootDir, println = console.log, errorln = console.error } = {}) {
  if (args.length === 0) {
    errorln('Usage: construct team remove <team-id> [--force]');
    return 1;
  }

  const teamId = args[0];
  const forceRemove = args.includes('--force');

  let registry;
  try {
    registry = loadRegistry({ rootDir });
  } catch (err) {
    errorln(`Error loading registry: ${err.message}`);
    return 1;
  }

  const team = registry.teams?.[teamId];
  if (!team) {
    errorln(`Team '${teamId}' not found in registry.`);
    return 1;
  }

  // Check for policy references
  const policyReferences = [];
  for (const [policyId, policy] of Object.entries(registry.policies || {})) {
    if (policy.teamOwner === teamId || (policy.requiresApprovalFrom || []).includes(teamId)) {
      policyReferences.push(policyId);
    }
  }

  // Check for contract team boundaries
  const contractReferences = [];
  for (const [contractId, contract] of Object.entries(registry.contracts || {})) {
    if (contract.teamBoundary?.producerTeam === teamId || contract.teamBoundary?.consumerTeam === teamId) {
      contractReferences.push(contractId);
    }
  }

  if ((policyReferences.length || contractReferences.length) && !forceRemove) {
    errorln(`Cannot remove team '${teamId}' — it is referenced by:`);
    if (policyReferences.length) {
      errorln(`  Policies: ${policyReferences.join(', ')}`);
    }
    if (contractReferences.length) {
      errorln(`  Contracts: ${contractReferences.join(', ')}`);
    }
    errorln('');
    errorln('Either reassign these policies/contracts first, or use --force to orphan them.');
    return 1;
  }

  if (forceRemove) {
    if (policyReferences.length) {
      println(`WARNING: Orphaning ${policyReferences.length} policy reference(s): ${policyReferences.join(', ')}`);
    }
    if (contractReferences.length) {
      println(`WARNING: Orphaning ${contractReferences.length} contract reference(s): ${contractReferences.join(', ')}`);
    }
  }

  const specialistsOnTeam = Object.entries(registry.specialists || {})
    .filter(([, spec]) => spec.team === teamId || spec.teamId === teamId)
    .map(([id]) => id);

  for (const specId of specialistsOnTeam) {
    if (!removeOrgEntityFile(rootDir, 'specialists', specId)) {
      errorln(`Could not remove specialist file for ${specId}`);
      return 1;
    }
    println(`Removed specialist ${specId}`);
  }

  const teamFile = findTeamFile(rootDir, teamId);
  if (!teamFile) {
    errorln(`Could not locate org file for team '${teamId}'`);
    return 1;
  }
  fs.unlinkSync(teamFile);

  const { clearCache } = await import('./loader.mjs');
  clearCache();
  const validation = validateUnifiedRegistry(loadRegistry({ rootDir }));
  if (!validation.ok) {
    errorln('Validation failed after removal:');
    for (const error of validation.errors) {
      errorln(`  ✗ ${error.id}: ${error.message}`);
    }
    return 1;
  }

  println(`✓ Team '${teamId}' and ${specialistsOnTeam.length} specialist(s) removed.`);
  return 0;
}

export async function runSpecialistAdd(args = [], { rootDir, println = console.log, errorln = console.error } = {}) {
  // Interactive wizard not available; requires terminal TTY and structured I/O.
  // Fallback: guide user to manual JSON editing.
  errorln('construct specialist add requires interactive terminal access.');
  errorln('Edit specialists/org directly and run:');
  errorln('  construct registry validate');
  errorln('');
  errorln('Expected format in specialists object:');
  errorln(JSON.stringify({
    'cx-new-specialist': {
      name: 'new-specialist',
      displayName: 'New Specialist',
      team: 'team-id',
      role: 'specialist-role',
      skills: ['docs/skill-1', 'docs/skill-2'],
      modelTier: 'reasoning',
      events: ['event.type'],
      fence: {
        allowedPaths: ['lib/**'],
        allowedCommands: ['bd create'],
        approvalRequired: ['commit'],
      },
    },
  }, null, 2));
  return 1;
}

export async function runSpecialistRemove(args = [], { rootDir, println = console.log, errorln = console.error } = {}) {
  if (args.length === 0) {
    errorln('Usage: construct specialist remove <specialist-id> [--force]');
    return 1;
  }

  const specialistId = args[0];
  const forceRemove = args.includes('--force');

  let registry;
  try {
    registry = loadRegistry({ rootDir });
  } catch (err) {
    errorln(`Error loading registry: ${err.message}`);
    return 1;
  }

  const specialist = registry.specialists?.[specialistId];
  if (!specialist) {
    errorln(`Specialist '${specialistId}' not found in registry.`);
    return 1;
  }

  // Check for contract references
  const contractReferences = [];
  for (const [contractId, contract] of Object.entries(registry.contracts || {})) {
    if (contract.producer === specialistId || contract.consumer === specialistId) {
      contractReferences.push(contractId);
    }
  }

  if (contractReferences.length && !forceRemove) {
    errorln(`Cannot remove specialist '${specialistId}' — it is referenced by contracts:`);
    errorln(`  ${contractReferences.join(', ')}`);
    errorln('');
    errorln('Either reassign these contracts first, or use --force.');
    return 1;
  }

  const teamId = specialist.team || specialist.teamId;
  const teamSpecialists = Object.entries(registry.specialists || {})
    .filter(([, spec]) => (spec.team || spec.teamId) === teamId)
    .map(([id]) => id);

  if (teamSpecialists.length === 1) {
    println(`WARNING: This is the last specialist on team '${teamId}'. Team will be understaffed.`);
  }

  const team = registry.teams?.[teamId];
  if (team?.owner === specialist.role) {
    println(`WARNING: This specialist has the owner role for team '${teamId}'. Team will have no owner.`);
  }

  if (!removeOrgEntityFile(rootDir, 'specialists', specialistId)) {
    errorln(`Could not locate org file for specialist '${specialistId}'`);
    return 1;
  }

  const { clearCache } = await import('./loader.mjs');
  clearCache();
  const validation = validateUnifiedRegistry(loadRegistry({ rootDir }));
  if (!validation.ok) {
    errorln('Validation failed after removal:');
    for (const error of validation.errors) {
      errorln(`  ✗ ${error.id}: ${error.message}`);
    }
    return 1;
  }

  println(`✓ Specialist '${specialistId}' removed.`);

  const promptFile = path.join(rootDir, specialist.promptFile || `specialists/prompts/${specialistId}.md`);
  if (fs.existsSync(promptFile)) {
    println(`  (orphaned prompt: rm ${path.relative(rootDir, promptFile)})`);
  }

  return 0;
}
