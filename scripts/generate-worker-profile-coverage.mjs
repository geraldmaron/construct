/**
 * scripts/generate-worker-profile-coverage.mjs — derives Worker Profile coverage
 * matrix from the registry, skill inventory, perspectives, and prompt
 * frontmatter, so every Worker Profile has re-verifiable skills, policy, and
 * guidance" is a re-verifiable fact rather than an assertion. Distinct from
 * docs/operations/audit/capability-matrix.md, which maps user-facing product
 * capabilities to their runtime path.
 *
 * Each row joins canonical skill emphasis, perspectives, prompt posture,
 * policy fence, events, capabilities, and artifacts. A profile passes only when
 * every required axis clears its minimum.
 *
 * --write regenerates registry/worker-profile-coverage.json and its
 * docs/guides/reference/worker-profile-coverage-matrix.md render. --check
 * regenerates in memory, exits 1 on drift or on any profile below the floor,
 * for the release gate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRegistry } from '../lib/registry/loader.mjs';
import { resolveWorkerProfilePromptPath } from '../lib/prompt-metadata.mjs';
import { splitFrontmatter } from '../lib/worker-profiles/prompt-schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const JSON_PATH = path.join(ROOT, 'registry', 'worker-profile-coverage.json');
const MD_PATH = path.join(ROOT, 'docs', 'guides', 'reference', 'worker-profile-coverage-matrix.md');

export const FLOOR = {
  minSkills: 5,
};

// The robustness floor as a pure predicate over already-extracted coverage
// facts, so the gate logic is unit-testable without touching disk.

export function evaluateFloor({
  workerProfileId,
  skillsCount,
  unresolved,
  perspectivePresent,
  refusalBoundaries,
  antiFabrication,
  fenceGatesCommitPush,
  promptPresent,
}) {
  const fails = [];
  if (skillsCount < FLOOR.minSkills) fails.push(`skills<${FLOOR.minSkills} (${skillsCount})`);
  if (unresolved.length) fails.push(`unresolved-skills: ${unresolved.join(',')}`);
  if (!perspectivePresent) fails.push(`missing perspective perspectives/${workerProfileId}`);
  if (!refusalBoundaries) fails.push('no refusal boundary in prompt perspective.failureMode');
  if (!antiFabrication) fails.push('no anti-fabrication contract in prompt');
  if (!fenceGatesCommitPush) fails.push('fence does not gate commit+push');
  if (!promptPresent) fails.push('prompt file missing');
  return fails;
}

function skillExists(rel) {
  return (
    fs.existsSync(path.join(SKILLS_DIR, `${rel}.md`)) ||
    fs.existsSync(path.join(SKILLS_DIR, rel, 'SKILL.md'))
  );
}

// Perspectives are entitled by Worker Profile selection rather than intent
// routing and are keyed by Worker Profile id.

function perspectives(workerProfileId) {
  const base = `perspectives/${workerProfileId}`;
  const present = skillExists(base);
  const dir = path.join(SKILLS_DIR, 'perspectives');
  const variants = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.startsWith(`${workerProfileId}.`) && f.endsWith('.md'))
        .map((f) => `perspectives/${f.replace(/\.md$/, '')}`)
        .sort()
    : [];
  return { base, present, variants };
}

function readPrompt(promptPath) {
  if (!promptPath) return null;
  const full = path.join(ROOT, promptPath);
  if (!fs.existsSync(full)) return false;
  return fs.readFileSync(full, 'utf8');
}

function buildRow(profile, registry) {
  const skills = profile.skillEmphasis ?? [];
  const unresolved = skills.filter((skill) => !skill.startsWith('perspectives/') && !skillExists(skill));
  const profilePerspectives = perspectives(profile.id);
  const promptPath = resolveWorkerProfilePromptPath(profile.id, { rootDir: ROOT, registry });
  const prompt = readPrompt(promptPath);
  const perspective = prompt ? splitFrontmatter(prompt).frontmatter?.perspective : null;
  const approval = new Set(profile.policyFence?.approvalRequired ?? []);
  const fenceGatesCommitPush = approval.has('commit') && approval.has('push');

  const guardrails = {
    refusalBoundaries: Boolean(perspective?.failureMode),
    antiFabrication: typeof prompt === 'string' && /anti-fabrication/i.test(prompt),
    fenceGatesCommitPush,
  };
  const guidance = {
    promptPresent: typeof prompt === 'string',
    watchConditions: (profile.watchConditions ?? []).length,
    participationRules: Array.isArray(profile.participationRules) ? profile.participationRules.length : 0,
    capabilities: (profile.capabilities ?? []).length,
    artifactClasses: (profile.artifactClasses ?? []).length,
  };

  const fails = evaluateFloor({
    workerProfileId: profile.id,
    skillsCount: skills.length,
    unresolved,
    perspectivePresent: profilePerspectives.present,
    refusalBoundaries: guardrails.refusalBoundaries,
    antiFabrication: guardrails.antiFabrication,
    fenceGatesCommitPush: guardrails.fenceGatesCommitPush,
    promptPresent: guidance.promptPresent,
  });

  return {
    workerProfileId: profile.id,
    skills: { count: skills.length, entitled: skills, unresolved },
    perspective: profilePerspectives,
    guardrails,
    guidance,
    pass: fails.length === 0,
    fails,
  };
}

export function buildMatrix() {
  const registry = loadRegistry({ rootDir: ROOT });
  const rows = Object.values(registry.workerProfiles ?? {})
    .map((profile) => buildRow(profile, registry))
    .sort((a, b) => a.workerProfileId.localeCompare(b.workerProfileId));
  return {
    version: 1,
    floor: FLOOR,
    generatedFrom: 'registry/worker-profiles/** + skills/**',
    workerProfileCount: rows.length,
    allPass: rows.every((r) => r.pass),
    workerProfiles: rows,
  };
}

function renderMarkdown(matrix) {
  const lines = [
    '<!--',
    'docs/guides/reference/worker-profile-coverage-matrix.md — generated render of',
    'registry/worker-profile-coverage.json. Do not hand-edit: run',
    '`npm run worker-profiles:coverage -- --write`.',
    '-->',
    '',
    '# Worker Profile coverage matrix',
    '',
    'Every Worker Profile joined across skill emphasis, role overlays, policy',
    'overlay, guardrails, and guidance — against a robustness floor',
    `(skills ≥ ${matrix.floor.minSkills}, role overlay present, refusalBoundaries +`,
    'anti-fabrication + commit/push fence). A row passes only when every axis clears its minimum.',
    '',
    `Floor status: **${matrix.allPass ? 'all pass' : 'FAILURES PRESENT'}** — ${matrix.workerProfileCount} Worker Profiles.`,
    '',
    '| Worker Profile | Skills | Perspective (+variants) | Guardrails | capabilities/artifacts | Pass |',
    '|---|---|---|---|---|---|',
  ];
  for (const r of matrix.workerProfiles) {
    const guard = [
      r.guardrails.refusalBoundaries ? 'refusal' : '—',
      r.guardrails.antiFabrication ? 'anti-fab' : '—',
      r.guardrails.fenceGatesCommitPush ? 'fence' : '—',
    ].join('/');
    const perspective = `${r.perspective.present ? '✓' : '✗'}${r.perspective.variants.length ? ` +${r.perspective.variants.length}` : ''}`;
    lines.push(
      `| \`${r.workerProfileId}\` | ${r.skills.count} | ${perspective} | ${guard} | ${r.guidance.capabilities}/${r.guidance.artifactClasses} | ${r.pass ? '✅' : '❌ ' + r.fails.join('; ')} |`,
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const check = process.argv.includes('--check');
  const write = process.argv.includes('--write');
  if (!check && !write) {
    console.error('usage: node scripts/generate-worker-profile-coverage.mjs --write|--check');
    process.exit(2);
  }

  const matrix = buildMatrix();
  const json = `${JSON.stringify(matrix, null, 2)}\n`;
  const md = renderMarkdown(matrix);

  if (check) {
    const failing = matrix.workerProfiles.filter((r) => !r.pass);
    if (failing.length) {
      console.error('Worker Profiles below the robustness floor:');
      for (const r of failing) console.error(`  ${r.workerProfileId}: ${r.fails.join('; ')}`);
      process.exit(1);
    }
    const currentJson = fs.existsSync(JSON_PATH) ? fs.readFileSync(JSON_PATH, 'utf8') : '';
    const currentMd = fs.existsSync(MD_PATH) ? fs.readFileSync(MD_PATH, 'utf8') : '';
    if (currentJson !== json || currentMd !== md) {
      console.error('Worker Profile coverage matrix is out of date — run: npm run worker-profiles:coverage -- --write');
      process.exit(1);
    }
    console.log(`Worker Profile coverage matrix up to date (${matrix.workerProfileCount} profiles, all pass)`);
    return;
  }

  fs.writeFileSync(JSON_PATH, json);
  fs.writeFileSync(MD_PATH, md);
  console.log(`wrote Worker Profile coverage matrix (${matrix.workerProfileCount} profiles, allPass=${matrix.allPass})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
