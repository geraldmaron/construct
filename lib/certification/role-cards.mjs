/**
 * lib/certification/role-cards.mjs — specialist role card fixtures for certification.
 *
 * Builds one JSON role card per registry specialist from registry.json and prompt
 * frontmatter. Cards are the certification fixture source of truth for specialist
 * posture audits — fields cite registry/prompt only, never fabricated outputs.
 */

import fs from 'node:fs';
import { loadRegistry } from '../registry/loader.mjs';
import path from 'node:path';

import { splitFrontmatter } from '../specialists/prompt-schema.mjs';

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'specialists', 'org'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

export function roleCardsDir(rootDir = process.cwd()) {
  return path.join(findConstructRoot(rootDir), 'tests', 'certification', 'specialists');
}

export function roleCardRelPath(specialistName) {
  return path.join('tests', 'certification', 'specialists', `cx-${specialistName}.role-card.json`);
}

export function buildRoleCard(agent, { rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const specialistId = `cx-${agent.name}`;
  const promptPath = path.join(root, agent.promptFile ?? '');
  let tone = null;
  let refusalBoundaries = null;
  let openingQuestion = null;
  if (agent.promptFile && fs.existsSync(promptPath)) {
    const { frontmatter } = splitFrontmatter(fs.readFileSync(promptPath, 'utf8'));
    if (frontmatter?.perspective) {
      tone = frontmatter.perspective.bias ?? null;
      refusalBoundaries = frontmatter.perspective.failureMode ?? null;
      openingQuestion = frontmatter.perspective.openingQuestion ?? null;
    }
  }
  return {
    schemaVersion: 1,
    specialistId,
    registryName: agent.name,
    humanEquivalent: agent.description ?? null,
    outputs: agent.docArtifacts ?? [],
    skills: agent.skills ?? [],
    tone,
    openingQuestion,
    escalationPath: {
      collaborators: agent.collaborators ?? [],
      subscriptions: agent.subscriptions ?? [],
    },
    refusalBoundaries,
    modelTier: agent.modelTier ?? null,
    sources: {
      registry: 'specialists/org',
      promptFile: agent.promptFile ?? null,
    },
  };
}

export function writeRoleCards({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const registry = loadRegistry({ rootDir: root });
  const dir = roleCardsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const agent of Object.values(registry.specialists ?? {})) {
    const card = buildRoleCard(agent, { rootDir: root });
    const file = path.join(dir, `${card.specialistId}.role-card.json`);
    fs.writeFileSync(file, `${JSON.stringify(card, null, 2)}\n`);
    written.push(card.specialistId);
  }
  return { dir, count: written.length, specialistIds: written.sort() };
}

export function validateRoleCards({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const registry = loadRegistry({ rootDir: root });
  const errors = [];
  const cards = [];
  for (const agent of Object.values(registry.specialists ?? {})) {
    const specialistId = `cx-${agent.name}`;
    const file = path.join(roleCardsDir(root), `${specialistId}.role-card.json`);
    if (!fs.existsSync(file)) {
      errors.push(`missing role card: ${roleCardRelPath(agent.name)}`);
      continue;
    }
    const card = JSON.parse(fs.readFileSync(file, 'utf8'));
    cards.push(card);
    if (card.specialistId !== specialistId) errors.push(`${specialistId}: specialistId mismatch`);
    if (!card.humanEquivalent) errors.push(`${specialistId}: humanEquivalent required`);
    if (!Array.isArray(card.skills)) errors.push(`${specialistId}: skills must be array`);
    if (!card.sources?.registry) errors.push(`${specialistId}: sources.registry required`);
    const skillSet = new Set(agent.skills ?? []);
    for (const skill of card.skills ?? []) {
      if (!skillSet.has(skill)) errors.push(`${specialistId}: skill ${skill} not in registry`);
    }
    for (const doc of card.outputs ?? []) {
      if (!(agent.docArtifacts ?? []).includes(doc)) {
        errors.push(`${specialistId}: output ${doc} not in registry docArtifacts`);
      }
    }
  }
  return { pass: errors.length === 0, errors, count: cards.length };
}
