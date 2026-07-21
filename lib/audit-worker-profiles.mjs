/**
 * Build the canonical Worker Profile and skill audit matrix.
 *
 * The audit joins the canonical registry, capability contracts, skills,
 * artifact manifest, enrichment metadata, and certification evidence. It
 * powers `construct audit worker-profiles` and the generated Worker Profile
 * audit guide.
 */

import fs from 'node:fs';
import path from 'node:path';

import { loadArtifactManifest } from './artifact-manifest.mjs';
import { auditWorkerProfileContracts } from './certification/worker-profile-contracts.mjs';
import { computeEvidenceTier } from './certification/evidence-tiers.mjs';
import { validateAllPerspectives, validatePerspectiveFile } from './certification/perspectives.mjs';
import { validateWorkerProfileCards } from './certification/worker-profile-cards.mjs';
import { loadRegistry } from './registry/loader.mjs';
import { PERSPECTIVE_DIRECTIVE_RE } from './perspective-preload.mjs';
import { resolvePerspectiveFromPrompt } from './worker-profiles/prompt-schema.mjs';

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'registry', 'worker-profiles'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function collectSkillFiles(skillsDir) {
  const results = [];
  function walk(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.name.endsWith('.md') && entry.name !== 'routing.md') {
        results.push(prefix ? `${prefix}/${entry.name.slice(0, -3)}` : entry.name.slice(0, -3));
      }
    }
  }
  try { walk(skillsDir); } catch { /* missing skill corpus */ }
  return results.sort();
}

function parsePerspectiveReference(promptPath) {
  if (!fs.existsSync(promptPath)) return null;
  const match = fs.readFileSync(promptPath, 'utf8').match(PERSPECTIVE_DIRECTIVE_RE);
  return match ? `perspectives/${match[1]}` : null;
}

function flattenCapabilityContracts(capabilities) {
  return Object.values(capabilities ?? {}).flatMap((capability) => Object.values(capability.contracts ?? {}));
}

function contractsForWorkerProfile(contracts, workerProfileId) {
  return contracts
    .filter((contract) => contract.producer === workerProfileId || contract.consumer === workerProfileId)
    .map((contract) => contract.id);
}

function artifactClassesFromContracts(contracts) {
  const artifactClasses = new Set();
  for (const contract of contracts) {
    const artifactClass = contract.trigger?.docAuthoring?.docType;
    if (Array.isArray(artifactClass)) artifactClass.forEach((value) => artifactClasses.add(value));
    else if (typeof artifactClass === 'string') artifactClasses.add(artifactClass);
  }
  return [...artifactClasses];
}

function enforcementForWorkerProfile(profile, contracts) {
  const items = ['no-fabrication', 'neurodivergent-output', 'human-voice'];
  const related = contracts.filter((contract) => contract.producer === profile.id || contract.consumer === profile.id);
  if (related.some((contract) => contract.postconditions?.length)) items.push('contract postconditions');
  if (profile.artifactClasses?.length) items.push('artifact structure lint', 'comment lint');
  if (profile.watchConditions?.length) items.push('watch-condition routing');
  return items;
}

function crossChecks({ registry, manifest, allSkills, contractArtifactClasses, enrichments }) {
  const issues = [];
  const manifestTypes = new Set(Object.keys(manifest.artifacts ?? {}));

  for (const profile of Object.values(registry.workerProfiles ?? {})) {
    for (const skill of profile.skillEmphasis ?? []) {
      if (!allSkills.includes(skill)) {
        issues.push({ kind: 'missing-skill-file', workerProfileId: profile.id, skill });
      }
    }
    for (const artifactClass of profile.artifactClasses ?? []) {
      if (!manifestTypes.has(artifactClass)) {
        issues.push({ kind: 'artifact-class-no-manifest', workerProfileId: profile.id, artifactClass });
      }
    }
  }

  for (const artifactClass of contractArtifactClasses) {
    if (!manifestTypes.has(artifactClass)) {
      issues.push({ kind: 'contract-artifact-no-manifest', artifactClass });
    }
  }

  const liveIds = new Set(Object.keys(registry.workerProfiles ?? {}));
  for (const workerProfileId of Object.keys(enrichments.workerProfiles ?? {})) {
    if (!liveIds.has(workerProfileId)) {
      issues.push({ kind: 'orphaned-enrichment', workerProfileId });
    }
  }

  return issues;
}

export function auditWorkerProfiles({ rootDir, silent = false } = {}) {
  const root = rootDir ?? findConstructRoot();
  const registry = loadRegistry({ rootDir: root, skipValidation: true });
  const contracts = flattenCapabilityContracts(registry.capabilities);
  const enrichments = readJson(path.join(root, 'registry', 'worker-profile-audit-enrichments.json'));
  const manifest = loadArtifactManifest({ rootDir: root });
  const allSkills = collectSkillFiles(path.join(root, 'skills'));
  const contractArtifactClasses = artifactClassesFromContracts(contracts);
  const crossCheckIssues = crossChecks({
    registry,
    manifest,
    allSkills,
    contractArtifactClasses,
    enrichments,
  });

  const workerProfiles = Object.values(registry.workerProfiles ?? {}).map((profile) => {
    const promptPath = path.join(root, 'registry', 'worker-profiles', 'prompts', `${profile.id}.md`);
    const metadata = enrichments.workerProfiles?.[profile.id] ?? {};
    const promptPerspective = resolvePerspectiveFromPrompt(profile.id, { rootDir: root, registry });
    const perspective = parsePerspectiveReference(promptPath);
    const evidence = computeEvidenceTier(profile, perspective, { rootDir: root });
    return {
      workerProfileId: profile.id,
      displayName: profile.displayName,
      humanEquivalent: metadata.humanEquivalent ?? 'unknown',
      artifactClasses: profile.artifactClasses ?? [],
      skillEmphasis: profile.skillEmphasis ?? [],
      perspective,
      researchProfile: metadata.researchProfile ?? null,
      toneProfile: metadata.toneProfile ?? 'direct',
      challengeModel: {
        tension: promptPerspective?.tension ?? null,
        failureMode: promptPerspective?.failureMode ?? null,
        watchConditions: profile.watchConditions ?? [],
      },
      enforcement: enforcementForWorkerProfile(profile, contracts),
      contractIds: contractsForWorkerProfile(contracts, profile.id),
      evidenceTier: evidence.tier,
      evidenceTierReason: evidence.reason,
      evidence: evidence.evidence,
      skillCount: (profile.skillEmphasis ?? []).length,
    };
  });

  const perspectives = [];
  const perspectivesDir = path.join(root, 'skills', 'perspectives');
  if (fs.existsSync(perspectivesDir)) {
    for (const file of fs.readdirSync(perspectivesDir).filter((name) => name.endsWith('.md')).sort()) {
      const perspective = `perspectives/${file.slice(0, -3)}`;
      const validation = validatePerspectiveFile(perspective, { rootDir: root });
      perspectives.push({
        path: perspective,
        structurallyValid: validation.pass,
        errors: validation.errors ?? [],
      });
    }
  }

  const workflowSkills = allSkills
    .filter((skill) => !skill.startsWith('perspectives/'))
    .map((skill) => {
      const manifestEntry = Object.entries(manifest.artifacts ?? {})
        .find(([, value]) => value.workflowSkill === skill);
      return {
        path: skill,
        artifactClass: manifestEntry?.[0] ?? null,
        toneDefault: manifestEntry?.[1]?.toneDefault ?? null,
      };
    });

  const workerProfileCards = validateWorkerProfileCards({ rootDir: root });
  const workerProfileContracts = auditWorkerProfileContracts({ rootDir: root });
  const perspectiveAudit = validateAllPerspectives({ rootDir: root });
  if (!workerProfileCards.pass) {
    for (const error of workerProfileCards.errors) {
      crossCheckIssues.push({ kind: 'worker-profile-card-missing', detail: error });
    }
  }
  if (!workerProfileContracts.pass) {
    for (const failure of workerProfileContracts.failures) {
      crossCheckIssues.push({ kind: 'worker-profile-contract-fail', workerProfileId: failure.workerProfileId });
    }
  }
  if (!perspectiveAudit.pass) {
    for (const error of perspectiveAudit.errors.slice(0, 5)) {
      crossCheckIssues.push({ kind: 'perspective-fail', detail: error });
    }
  }

  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    workerProfileCount: workerProfiles.length,
    perspectiveCount: perspectives.length,
    workflowSkillCount: workflowSkills.length,
    workerProfiles,
    perspectives,
    workflowSkills,
    crossCheckIssues,
    workerProfileCards,
    workerProfileContracts,
    perspectiveAudit,
    pass: crossCheckIssues.length === 0,
  };

  if (!silent) {
    const line = (message = '') => process.stdout.write(`${message}\n`);
    line('Construct Worker Profile Audit');
    line('══════════════════════════════');
    line(`  Worker Profiles: ${result.workerProfileCount}`);
    line(`  Perspectives: ${result.perspectiveCount}`);
    line(`  Workflow skills: ${result.workflowSkillCount}`);
    line();
    if (crossCheckIssues.length === 0) {
      line('  ✓ Cross-checks passed (skills, artifact classes, manifest, contracts)');
    } else {
      line(`  ✗ Cross-check issues (${crossCheckIssues.length}):`);
      for (const issue of crossCheckIssues) line(`      - ${JSON.stringify(issue)}`);
    }
    line();
    line(result.pass ? '  Result: PASS' : '  Result: FAIL');
  }

  return result;
}

export function formatWorkerProfileAuditMarkdown(result) {
  const lines = [
    '# Worker Profile & skill audit',
    '',
    `Generated: ${result.generatedAt}. Re-run \`construct audit worker-profiles --json\` for the current matrix.`,
    '',
    '## Evidence tiers',
    '',
    'Each rung requires genuine evidence at every rung below it, computed from Worker Profile',
    'cards, prompt contracts, perspectives, and certification-store runs.',
    '',
    '| Tier | What it means |',
    '|---|---|',
    '| `declared` | Exists in the canonical registry. |',
    '| `structurally-valid` | Worker Profile card, prompt contract, and perspective pass static checks. |',
    '| `behaviorally-tested` | A certification run passed a behavioral gate. |',
    '| `live-tested` | A non-hermetic model passed a behavioral gate. |',
    '| `host-proven` | A real orchestrated handoff passed its contract check. |',
    '',
    '## Worker Profiles',
    '',
    '| Worker Profile | Human equivalent | Artifact classes | Skills | Perspective | Research | Tone | Evidence tier | Reason |',
    '|---|---|---|---|---|---|---|---|---|',
  ];

  for (const profile of result.workerProfiles) {
    lines.push(
      `| ${profile.workerProfileId} | ${profile.humanEquivalent} | ${profile.artifactClasses.join(', ') || '—'} | ${profile.skillCount} | ${profile.perspective ?? '—'} | ${profile.researchProfile ?? '—'} | ${profile.toneProfile} | ${profile.evidenceTier} | ${profile.evidenceTierReason} |`,
    );
  }

  lines.push('', '## Perspectives', '', '| Perspective | Structurally valid | Errors |', '|---|---|---|');
  for (const perspective of result.perspectives) {
    lines.push(`| ${perspective.path} | ${perspective.structurallyValid ? 'yes' : 'no'} | ${perspective.errors.length ? perspective.errors.join('; ') : '—'} |`);
  }

  lines.push('', '## Cross-check issues', '');
  if (result.crossCheckIssues.length === 0) lines.push('None.');
  else for (const issue of result.crossCheckIssues) lines.push(`- \`${issue.kind}\`: ${JSON.stringify(issue)}`);

  return `${lines.join('\n')}\n`;
}

export async function runAuditWorkerProfilesCli(args = []) {
  const json = args.includes('--json');
  const markdown = args.includes('--markdown');
  const rootDir = args.find((arg) => arg.startsWith('--root='))?.split('=')[1];
  const result = auditWorkerProfiles({ rootDir, silent: true });

  if (markdown) process.stdout.write(formatWorkerProfileAuditMarkdown(result));
  else if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else auditWorkerProfiles({ rootDir, silent: false });

  if (!result.pass) process.exit(1);
}
