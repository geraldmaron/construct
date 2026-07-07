/**
 * lib/registry/custom-scaffold.mjs — CLI-facing scaffolding for user-authored
 * custom specialists and teams (construct-rf26.13).
 *
 * Writes into one of two extension tiers, both read back by
 * lib/registry/assemble.mjs at the same precedence ADR-0052 establishes for
 * provider manifests (builtin -> user -> project):
 *   - "user"    ~/.construct/org/**   — usable across every project on the machine
 *   - "project" <rootDir>/.cx/org/**  — git-tracked, highest precedence, scoped
 *                                       to one project (the existing overlay
 *                                       introduced by ADR-0046)
 *
 * Refuses to overwrite an existing file unless { force: true }, mirroring
 * lib/specialists/scaffold.mjs's createSpecialistDraft convention. Validates
 * with lib/registry/custom-schema.mjs before writing anything, so a scaffolded
 * record is guaranteed registry-loadable the moment it lands on disk.
 */

import fs from 'node:fs';
import path from 'node:path';
import { homeDir } from '../paths.mjs';
import { assembleRegistry } from './assemble.mjs';
import { validateCustomSpecialist, validateCustomTeam } from './custom-schema.mjs';

const ID_RE = /^[a-z][a-z0-9-]*$/;

export function customOrgDir(scope, { rootDir = process.cwd() } = {}) {
  if (scope === 'user') return path.join(homeDir(), '.construct', 'org');
  return path.join(rootDir, '.cx', 'org');
}

function existingTeamIds(rootDir) {
  try {
    return Object.keys(assembleRegistry(rootDir).teams);
  } catch {
    return null;
  }
}

function renderPromptStub({ id, role, description }) {
  return [
    `# cx-${id}`,
    '',
    `Role: ${role}`,
    '',
    description || 'TODO: describe this specialist\'s perspective and output format.',
    '',
    '## Anti-fabrication contract',
    '',
    'Every load-bearing claim cites a source the reader can re-verify. When a fact is not in the source, write `unknown` or `[unverified]`. See `rules/common/no-fabrication.md`.',
    '',
  ].join('\n');
}

/**
 * Scaffold a custom specialist JSON record (+ a minimal prompt stub) into the
 * requested tier. Throws with actionable, field-named errors on any failure.
 * @returns {{ path: string, relPath: string, promptPath: string, record: object, scope: string }}
 */
export function createCustomSpecialist({
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
    throw new Error(`invalid specialist id "${id}" — use lowercase kebab-case (e.g. "widget-specialist")`);
  }
  if (scope !== 'user' && scope !== 'project') {
    throw new Error(`invalid scope "${scope}" — use "user" or "project"`);
  }

  const orgDir = customOrgDir(scope, { rootDir });
  const specialistsDir = path.join(orgDir, 'specialists');
  const filePath = path.join(specialistsDir, `cx-${id}.json`);
  if (fs.existsSync(filePath) && !force) {
    throw new Error(`${filePath} already exists — pass force to overwrite`);
  }

  const resolvedTeam = team || teamId;
  const knownTeams = existingTeamIds(rootDir);
  if (resolvedTeam && knownTeams && !knownTeams.includes(resolvedTeam)) {
    throw new Error(
      `team "${resolvedTeam}" does not exist — create it first with \`construct team create ${resolvedTeam} --owner=${role || id}\`, ` +
      `or reference one of: ${knownTeams.slice(0, 10).join(', ')}${knownTeams.length > 10 ? ', …' : ''}`,
    );
  }

  const promptRelPath = path.posix.join(
    path.relative(rootDir, orgDir).split(path.sep).join('/'),
    'prompts',
    `cx-${id}.md`,
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
    team: resolvedTeam,
    teamId: resolvedTeam,
    internal: true,
    custom: true,
  };

  const errors = validateCustomSpecialist(record, { rootDir, checkPromptFileExists: false });
  if (errors.length) {
    throw new Error(`custom specialist "${id}" failed validation:\n  ${errors.join('\n  ')}`);
  }

  const promptDir = path.join(orgDir, 'prompts');
  const promptPath = path.join(rootDir, promptRelPath);
  fs.mkdirSync(promptDir, { recursive: true });
  if (!fs.existsSync(promptPath) || force) {
    fs.writeFileSync(promptPath, renderPromptStub({ id, role: record.role, description }));
  }

  fs.mkdirSync(specialistsDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2) + '\n');

  return { path: filePath, relPath: path.relative(rootDir, filePath), promptPath, record, scope };
}

/**
 * Scaffold a custom team JSON record into the requested tier. Throws with
 * actionable, field-named errors on any failure.
 * @returns {{ path: string, relPath: string, record: object, scope: string }}
 */
export function createCustomTeam({
  rootDir = process.cwd(),
  scope = 'project',
  id,
  name,
  owner,
  roles,
  specialists = [],
  charter,
  decisionRights = [],
  forbiddenDecisions = [],
  escalationPath,
  contact = {},
  groupId,
  force = false,
} = {}) {
  if (!id || !ID_RE.test(id)) {
    throw new Error(`invalid team id "${id}" — use lowercase kebab-case (e.g. "widget-team")`);
  }
  if (scope !== 'user' && scope !== 'project') {
    throw new Error(`invalid scope "${scope}" — use "user" or "project"`);
  }

  const orgDir = customOrgDir(scope, { rootDir });
  const teamsDir = path.join(orgDir, 'teams');
  const filePath = path.join(teamsDir, `${id}.json`);
  if (fs.existsSync(filePath) && !force) {
    throw new Error(`${filePath} already exists — pass force to overwrite`);
  }

  const resolvedRoles = roles && roles.length ? roles : (owner ? [owner] : []);
  const record = {
    name: name || id,
    owner,
    roles: resolvedRoles,
    specialists,
    decisionRights,
    forbiddenDecisions,
    escalationPath: escalationPath && escalationPath.length ? escalationPath : [owner, 'orchestrator'].filter(Boolean),
    charter,
    contact,
    ...(groupId ? { groupId } : {}),
  };

  const errors = validateCustomTeam({ id, ...record });
  if (errors.length) {
    throw new Error(`custom team "${id}" failed validation:\n  ${errors.join('\n  ')}`);
  }

  fs.mkdirSync(teamsDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2) + '\n');

  return { path: filePath, relPath: path.relative(rootDir, filePath), record, scope };
}
