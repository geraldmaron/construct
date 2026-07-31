/**
 * lib/registry/custom-scaffold.mjs — CLI-facing scaffolding for user-authored
 * custom Worker Profiles.
 *
 * Writes into one of two extension tiers, both read back by
 * lib/registry/assemble.mjs at the same precedence established for
 * provider manifests (builtin -> user -> project):
 *   - "user"    ~/.construct/org/**   — usable across every project on the machine
 *   - "project" <rootDir>/.construct/org/**  — git-tracked, highest precedence, scoped
 *                                       to one project (the existing overlay
 * for a single project)
 *
 * Refuses to overwrite an existing file unless { force: true }, mirroring the
 * canonical Worker Profile scaffold convention. Validates
 * with lib/registry/custom-schema.mjs before writing anything, so a scaffolded
 * record is guaranteed registry-loadable the moment it lands on disk.
 */

import fs from 'node:fs';
import path from 'node:path';
import { homeDir } from '../paths.mjs';
import { validateCustomWorkerProfile } from './custom-schema.mjs';
import { configPath } from '../config-dir.mjs';

const ID_RE = /^[a-z][a-z0-9-]*$/;

export function customOrgDir(scope, { rootDir = process.cwd() } = {}) {
  if (scope === 'user') return path.join(homeDir(), '.construct', 'org');
  return configPath(rootDir, 'org');
}


function renderPromptStub({ id, role, description }) {
  return [
    `# ${id}`,
    '',
    `Role: ${role}`,
    '',
    description || 'TODO: describe this Worker Profile\'s perspective and output format.',
    '',
    '## Anti-fabrication contract',
    '',
    'Every load-bearing claim cites a source the reader can re-verify. When a fact is not in the source, write `unknown` or `[unverified]`. See `rules/common/no-fabrication.md`.',
    '',
  ].join('\n');
}

/**
 * Scaffold a custom Worker Profile JSON record (+ a minimal prompt stub) into the
 * requested tier. Throws with actionable, field-named errors on any failure.
 * @returns {{ path: string, relPath: string, promptPath: string, record: object, scope: string }}
 */
export function createCustomWorkerProfile({
  rootDir = process.cwd(),
  scope = 'project',
  id,
  role,
  description,
  modelTier = 'standard',
  reasoningEffort,
  skills = [],
  fence,
  team,
  teamId,
  handoffCandidates = [],
  claudeTools = 'Read,Grep,Glob,LS',
  displayName,
  force = false,
} = {}) {
  if (!id || !ID_RE.test(id)) {
    throw new Error(`invalid worker-profile id "${id}" — use lowercase kebab-case (e.g. "widget-worker")`);
  }
  if (scope !== 'user' && scope !== 'project') {
    throw new Error(`invalid scope "${scope}" — use "user" or "project"`);
  }

  const orgDir = customOrgDir(scope, { rootDir });
  const workerProfilesDir = path.join(orgDir, 'worker-profiles');
  const filePath = path.join(workerProfilesDir, `${id}.json`);
  if (fs.existsSync(filePath) && !force) {
    throw new Error(`${filePath} already exists — pass force to overwrite`);
  }

  const resolvedTeam = team || teamId || null;

  const promptRelPath = path.posix.join(
    path.relative(rootDir, orgDir).split(path.sep).join('/'),
    'prompts',
    `${id}.md`,
  );

  const record = {
    name: id,
    displayName: displayName || description,
    description,
    role: role || id,
    modelTier,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    skills,
    fence: fence || { allowedPaths: [] },
    claudeTools,
    promptFile: promptRelPath,
    handoffCandidates,
    ...(resolvedTeam ? { team: resolvedTeam, teamId: resolvedTeam } : {}),
    internal: true,
    custom: true,
  };

  const errors = validateCustomWorkerProfile(record, { rootDir, checkPromptFileExists: false });
  if (errors.length) {
    throw new Error(`custom worker-profile "${id}" failed validation:\n  ${errors.join('\n  ')}`);
  }

  const promptDir = path.join(orgDir, 'prompts');
  const promptPath = path.join(rootDir, promptRelPath);
  fs.mkdirSync(promptDir, { recursive: true });
  if (!fs.existsSync(promptPath) || force) {
    fs.writeFileSync(promptPath, renderPromptStub({ id, role: record.role, description }));
  }

  fs.mkdirSync(workerProfilesDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2) + '\n');

  return { path: filePath, relPath: path.relative(rootDir, filePath), promptPath, record, scope };
}
