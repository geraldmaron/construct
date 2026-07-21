/**
 * Worker Profile card fixtures for certification.
 *
 * Builds one JSON card per registry Worker Profile and prompt frontmatter.
 * posture audits — fields cite registry/prompt only, never fabricated outputs.
 */

import fs from 'node:fs';
import { loadRegistry } from '../registry/loader.mjs';
import path from 'node:path';

import { splitFrontmatter } from '../worker-profiles/prompt-schema.mjs';

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'registry', 'worker-profiles'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

export function workerProfileCardsDir(rootDir = process.cwd()) {
  return path.join(findConstructRoot(rootDir), 'tests', 'certification', 'worker-profiles');
}

export function workerProfileCardRelPath(workerProfileId) {
  return path.join('tests', 'certification', 'worker-profiles', `${workerProfileId}.role-card.json`);
}

export function buildWorkerProfileCard(profile, { rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const workerProfileId = profile.id;
  const promptPath = path.join(root, 'registry', 'worker-profiles', 'prompts', `${workerProfileId}.md`);
  let tone = null;
  let refusalBoundaries = null;
  let openingQuestion = null;
  if (fs.existsSync(promptPath)) {
    const { frontmatter } = splitFrontmatter(fs.readFileSync(promptPath, 'utf8'));
    if (frontmatter?.perspective) {
      tone = frontmatter.perspective.bias ?? null;
      refusalBoundaries = frontmatter.perspective.failureMode ?? null;
      openingQuestion = frontmatter.perspective.openingQuestion ?? null;
    }
  }
  return {
    schemaVersion: 1,
    workerProfileId,
    displayName: profile.displayName ?? null,
    description: profile.description ?? null,
    artifactClasses: profile.artifactClasses ?? [],
    skillEmphasis: profile.skillEmphasis ?? [],
    tone,
    openingQuestion,
    escalationPath: {
      collaborators: profile.collaborators ?? [],
      subscriptions: profile.subscriptions ?? [],
    },
    refusalBoundaries,
    modelTier: profile.modelTier ?? null,
    sources: {
      registry: 'registry/worker-profiles',
      prompt: path.relative(root, promptPath),
    },
  };
}

export function writeWorkerProfileCards({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const registry = loadRegistry({ rootDir: root, skipValidation: true });
  const dir = workerProfileCardsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const profile of Object.values(registry.workerProfiles ?? {})) {
    const card = buildWorkerProfileCard(profile, { rootDir: root });
    const file = path.join(dir, `${card.workerProfileId}.role-card.json`);
    fs.writeFileSync(file, `${JSON.stringify(card, null, 2)}\n`);
    written.push(card.workerProfileId);
  }
  return { dir, count: written.length, workerProfileIds: written.sort() };
}

export function validateWorkerProfileCards({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const registry = loadRegistry({ rootDir: root, skipValidation: true });
  const errors = [];
  const cards = [];
  for (const profile of Object.values(registry.workerProfiles ?? {})) {
    const workerProfileId = profile.id;
    const file = path.join(workerProfileCardsDir(root), `${workerProfileId}.role-card.json`);
    if (!fs.existsSync(file)) {
      errors.push(`missing Worker Profile card: ${workerProfileCardRelPath(workerProfileId)}`);
      continue;
    }
    const card = JSON.parse(fs.readFileSync(file, 'utf8'));
    cards.push(card);
    if (card.workerProfileId !== workerProfileId) errors.push(`${workerProfileId}: workerProfileId mismatch`);
    if (!card.description) errors.push(`${workerProfileId}: description required`);
    if (!Array.isArray(card.skillEmphasis)) errors.push(`${workerProfileId}: skillEmphasis must be array`);
    if (!card.sources?.registry) errors.push(`${workerProfileId}: sources.registry required`);
    const skillSet = new Set(profile.skillEmphasis ?? []);
    for (const skill of card.skillEmphasis ?? []) {
      if (!skillSet.has(skill)) errors.push(`${workerProfileId}: skill ${skill} not in registry`);
    }
    for (const doc of card.artifactClasses ?? []) {
      if (!(profile.artifactClasses ?? []).includes(doc)) {
        errors.push(`${workerProfileId}: artifact class ${doc} not in registry`);
      }
    }
  }
  return { pass: errors.length === 0, errors, count: cards.length };
}
