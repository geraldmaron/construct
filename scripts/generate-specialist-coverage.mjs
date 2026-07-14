/**
 * scripts/generate-specialist-coverage.mjs — derives a per-specialist coverage
 * matrix from the registry, skill inventory, role overlays, and prompt
 * frontmatter, so "every specialist has a robust set of skills, guardrails, and
 * guidance" is a re-verifiable fact rather than an assertion. Distinct from
 * docs/operations/audit/capability-matrix.md, which maps user-facing product
 * capabilities (plan/build/fix/…) to their command+skill+specialist path.
 *
 * Each row joins four coverage axes: skill entitlements (declared in
 * specialists/org/specialists/*.json skills[], resolved against skills/**),
 * role overlay (skills/roles/<role>.md + sub-overlays), guardrails
 * (prompt perspective.failureMode refusalBoundaries, an anti-fabrication
 * contract, and a fence that gates commit+push), and guidance (prompt body plus
 * embedOrientation focusAreas/riskSignals). A specialist passes the robustness
 * floor only when every axis clears its minimum; the floor is a real gate, not
 * a cosmetic score.
 *
 * --write regenerates registry/specialist-coverage.json and its
 * docs/guides/reference/specialist-coverage-matrix.md render. --check
 * regenerates in memory, exits 1 on drift OR on any specialist below the floor,
 * for the release gate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRegistry } from '../lib/registry/loader.mjs';
import { buildRoleCard } from '../lib/certification/role-cards.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const JSON_PATH = path.join(ROOT, 'registry', 'specialist-coverage.json');
const MD_PATH = path.join(ROOT, 'docs', 'guides', 'reference', 'specialist-coverage-matrix.md');

export const FLOOR = {
  minSkills: 5,
  minFocusAreas: 6,
};

// The robustness floor as a pure predicate over already-extracted coverage
// facts, so the gate logic is unit-testable without touching disk.

export function evaluateFloor({
  role,
  skillsCount,
  unresolved,
  overlayPresent,
  refusalBoundaries,
  antiFabrication,
  fenceGatesCommitPush,
  promptPresent,
  focusAreas,
}) {
  const fails = [];
  if (skillsCount < FLOOR.minSkills) fails.push(`skills<${FLOOR.minSkills} (${skillsCount})`);
  if (unresolved.length) fails.push(`unresolved-skills: ${unresolved.join(',')}`);
  if (!overlayPresent) fails.push(`missing role overlay roles/${role}`);
  if (!refusalBoundaries) fails.push('no refusalBoundaries (prompt perspective.failureMode)');
  if (!antiFabrication) fails.push('no anti-fabrication contract in prompt');
  if (!fenceGatesCommitPush) fails.push('fence does not gate commit+push');
  if (!promptPresent) fails.push('prompt file missing');
  if (focusAreas < FLOOR.minFocusAreas) fails.push(`focusAreas<${FLOOR.minFocusAreas} (${focusAreas})`);
  return fails;
}

function skillExists(rel) {
  return (
    fs.existsSync(path.join(SKILLS_DIR, `${rel}.md`)) ||
    fs.existsSync(path.join(SKILLS_DIR, rel, 'SKILL.md'))
  );
}

// Role overlays are entitled by role-directive preload, not intent routing, so
// they live in skills/roles/ and are keyed off the specialist's own role field.

function roleOverlays(role) {
  const base = `roles/${role}`;
  const present = skillExists(base);
  const dir = path.join(SKILLS_DIR, 'roles');
  const subOverlays = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.startsWith(`${role}.`) && f.endsWith('.md'))
        .map((f) => `roles/${f.replace(/\.md$/, '')}`)
        .sort()
    : [];
  return { base, present, subOverlays };
}

function promptHasAntiFabrication(promptFile) {
  if (!promptFile) return false;
  const full = path.join(ROOT, promptFile);
  if (!fs.existsSync(full)) return false;
  return /anti-fabrication/i.test(fs.readFileSync(full, 'utf8'));
}

function buildRow(agent) {
  const skills = agent.skills ?? [];
  const unresolved = skills.filter((s) => !s.startsWith('roles/') && !skillExists(s));
  const overlays = roleOverlays(agent.role);
  const card = buildRoleCard(agent, { rootDir: ROOT });
  const approval = new Set(agent.fence?.approvalRequired ?? []);
  const fenceGatesCommitPush = approval.has('commit') && approval.has('push');
  const focusAreas = (agent.embedOrientation?.focusAreas ?? []).length;
  const riskSignals = (agent.embedOrientation?.riskSignals ?? []).length;

  const guardrails = {
    refusalBoundaries: Boolean(card.refusalBoundaries),
    antiFabrication: promptHasAntiFabrication(agent.promptFile),
    fenceGatesCommitPush,
  };
  const guidance = {
    promptPresent: Boolean(agent.promptFile) && fs.existsSync(path.join(ROOT, agent.promptFile)),
    focusAreas,
    riskSignals,
    watchConditions: (agent.watchConditions ?? []).length,
    participationRules: (agent.participationRules?.rules ?? []).length,
  };

  const fails = evaluateFloor({
    role: agent.role,
    skillsCount: skills.length,
    unresolved,
    overlayPresent: overlays.present,
    refusalBoundaries: guardrails.refusalBoundaries,
    antiFabrication: guardrails.antiFabrication,
    fenceGatesCommitPush: guardrails.fenceGatesCommitPush,
    promptPresent: guidance.promptPresent,
    focusAreas,
  });

  return {
    specialistId: `cx-${agent.name}`,
    role: agent.role,
    team: agent.teamId ?? agent.team ?? null,
    skills: { count: skills.length, entitled: skills, unresolved },
    roleOverlay: overlays,
    guardrails,
    guidance,
    pass: fails.length === 0,
    fails,
  };
}

export function buildMatrix() {
  const registry = loadRegistry({ rootDir: ROOT });
  const rows = Object.values(registry.specialists ?? {})
    .map(buildRow)
    .sort((a, b) => a.specialistId.localeCompare(b.specialistId));
  return {
    version: 1,
    floor: FLOOR,
    generatedFrom: 'specialists/org (registry) + skills/** + specialists/prompts/**',
    specialistCount: rows.length,
    allPass: rows.every((r) => r.pass),
    specialists: rows,
  };
}

function renderMarkdown(matrix) {
  const lines = [
    '<!--',
    'docs/guides/reference/specialist-coverage-matrix.md — generated render of',
    'registry/specialist-coverage.json. Do not hand-edit: run',
    '`npm run specialists:coverage -- --write`.',
    '-->',
    '',
    '# Specialist coverage matrix',
    '',
    'Every specialist joined across four coverage axes — skill entitlements, role',
    'overlay, guardrails, and guidance — against a robustness floor',
    `(skills ≥ ${matrix.floor.minSkills}, role overlay present, refusalBoundaries +`,
    'anti-fabrication + commit/push fence, focusAreas ≥',
    `${matrix.floor.minFocusAreas}). A row passes only when every axis clears its minimum.`,
    '',
    `Floor status: **${matrix.allPass ? 'all pass' : 'FAILURES PRESENT'}** — ${matrix.specialistCount} specialists.`,
    '',
    '| Specialist | Role | Skills | Overlay (+sub) | Guardrails | focus/risk | Pass |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const r of matrix.specialists) {
    const guard = [
      r.guardrails.refusalBoundaries ? 'refusal' : '—',
      r.guardrails.antiFabrication ? 'anti-fab' : '—',
      r.guardrails.fenceGatesCommitPush ? 'fence' : '—',
    ].join('/');
    const overlay = `${r.roleOverlay.present ? '✓' : '✗'}${r.roleOverlay.subOverlays.length ? ` +${r.roleOverlay.subOverlays.length}` : ''}`;
    lines.push(
      `| \`${r.specialistId}\` | ${r.role} | ${r.skills.count} | ${overlay} | ${guard} | ${r.guidance.focusAreas}/${r.guidance.riskSignals} | ${r.pass ? '✅' : '❌ ' + r.fails.join('; ')} |`,
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const check = process.argv.includes('--check');
  const write = process.argv.includes('--write');
  if (!check && !write) {
    console.error('usage: node scripts/generate-capability-matrix.mjs --write|--check');
    process.exit(2);
  }

  const matrix = buildMatrix();
  const json = `${JSON.stringify(matrix, null, 2)}\n`;
  const md = renderMarkdown(matrix);

  if (check) {
    const failing = matrix.specialists.filter((r) => !r.pass);
    if (failing.length) {
      console.error('specialists below the capability robustness floor:');
      for (const r of failing) console.error(`  ${r.specialistId}: ${r.fails.join('; ')}`);
      process.exit(1);
    }
    const currentJson = fs.existsSync(JSON_PATH) ? fs.readFileSync(JSON_PATH, 'utf8') : '';
    const currentMd = fs.existsSync(MD_PATH) ? fs.readFileSync(MD_PATH, 'utf8') : '';
    if (currentJson !== json || currentMd !== md) {
      console.error('specialist coverage matrix is out of date — run: npm run specialists:coverage -- --write');
      process.exit(1);
    }
    console.log(`specialist coverage matrix up to date (${matrix.specialistCount} specialists, all pass)`);
    return;
  }

  fs.writeFileSync(JSON_PATH, json);
  fs.writeFileSync(MD_PATH, md);
  console.log(`wrote specialist coverage matrix (${matrix.specialistCount} specialists, allPass=${matrix.allPass})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
