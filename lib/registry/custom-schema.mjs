/**
 * lib/registry/custom-schema.mjs — validation contract for user-authored custom
 * specialists and teams (construct-rf26.13).
 *
 * Hand-rolled validator, matching the style already established by
 * lib/specialists/schema.mjs and lib/config/schema.mjs, rather than pulling in
 * a schema-validation dependency: every error names the offending field and
 * says what to do about it, so a scaffold failure is actionable without
 * cross-referencing a generic validator dump. Reuses lib/specialists/schema.mjs's
 * ALLOWED_TOOLS allowlist so a custom specialist is held to the same
 * claudeTools contract as a built-in one.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ALLOWED_TOOLS } from '../specialists/schema.mjs';

export const MODEL_TIERS = ['fast', 'standard', 'reasoning'];
const SKILL_REF_RE = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;
const ID_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Validate one custom specialist record. Returns an array of actionable error
 * strings; empty means the record passes.
 */
export function validateCustomSpecialist(record, { rootDir, checkPromptFileExists = true } = {}) {
  const errors = [];
  const id = record?.name || '(unnamed)';

  if (!record || typeof record !== 'object') {
    return [`custom specialist: record must be an object`];
  }

  if (!record.name || !ID_RE.test(record.name)) {
    errors.push(`${id}: "name" must be lowercase kebab-case (e.g. "widget-specialist"), got ${JSON.stringify(record.name)}`);
  }

  if (!record.description || String(record.description).trim().length < 20) {
    errors.push(`${id}: "description" is required and must be at least 20 characters — it is load-bearing for orchestration routing`);
  } else if (String(record.description).length > 500) {
    errors.push(`${id}: "description" is too long (>500 chars) — keep it scannable`);
  }

  if (!record.role || typeof record.role !== 'string') {
    errors.push(`${id}: "role" is required (e.g. "widget-specialist") — a team's "owner" field must match a specialist's "role" for the team to validate`);
  }

  if (!record.modelTier || !MODEL_TIERS.includes(record.modelTier)) {
    errors.push(`${id}: "modelTier" must be one of ${MODEL_TIERS.join(' | ')}, got ${JSON.stringify(record.modelTier)}`);
  }

  const team = record.team || record.teamId;
  if (!team || typeof team !== 'string') {
    errors.push(`${id}: "team" (or "teamId") is required — reference an existing team id, or create one first with \`construct team create <id> --owner=${record.role || '<role>'}\``);
  }

  if (!Array.isArray(record.skills) || record.skills.length === 0) {
    errors.push(`${id}: "skills" must be a non-empty array of skill bundle references (e.g. ["frontend-design/accessibility"])`);
  } else {
    record.skills.forEach((skill, i) => {
      if (typeof skill !== 'string' || !SKILL_REF_RE.test(skill)) {
        errors.push(`${id}: skills[${i}] "${skill}" is not a valid skill bundle reference — expected "<bundle>/<skill>" (e.g. "frontend-design/accessibility")`);
      }
    });
  }

  if (!record.fence || typeof record.fence !== 'object' || Array.isArray(record.fence)) {
    errors.push(`${id}: "fence" is required — at minimum { "allowedPaths": [...] } to declare the permission boundary`);
  } else if (!Array.isArray(record.fence.allowedPaths) || record.fence.allowedPaths.length === 0) {
    errors.push(`${id}: "fence.allowedPaths" must be a non-empty array of path globs this specialist may touch`);
  }

  if (record.handoffCandidates !== undefined && !Array.isArray(record.handoffCandidates)) {
    errors.push(`${id}: "handoffCandidates" must be an array of role ids (the delegation spec — who this specialist hands off to)`);
  }

  if (record.claudeTools) {
    const tools = String(record.claudeTools).split(',').map((t) => t.trim()).filter(Boolean);
    for (const tool of tools) {
      if (!ALLOWED_TOOLS.has(tool)) {
        errors.push(`${id}: unknown tool "${tool}" in claudeTools — host platforms silently drop unknown tool names, causing this specialist to appear to work without it`);
      }
    }
  }

  if (checkPromptFileExists && record.promptFile && rootDir) {
    const promptPath = path.join(rootDir, record.promptFile);
    if (!fs.existsSync(promptPath)) {
      errors.push(`${id}: promptFile "${record.promptFile}" does not exist under ${rootDir}`);
    }
  }

  return errors;
}

/**
 * Validate one custom team record. Returns an array of actionable error
 * strings; empty means the record passes.
 */
export function validateCustomTeam(record) {
  const errors = [];
  const id = record?.id || record?.name || '(unnamed)';

  if (!record || typeof record !== 'object') {
    return [`custom team: record must be an object`];
  }

  if (!record.name || typeof record.name !== 'string') {
    errors.push(`${id}: "name" is required (human-readable team name, e.g. "Widget Team")`);
  }

  if (!record.owner || typeof record.owner !== 'string') {
    errors.push(`${id}: "owner" is required — the role id that holds primary accountability (must match a specialist's "role" field)`);
  }

  if (!Array.isArray(record.roles) || record.roles.length === 0) {
    errors.push(`${id}: "roles" must be a non-empty array of role ids that constitute this team`);
  } else if (record.owner && !record.roles.includes(record.owner)) {
    errors.push(`${id}: "roles" must include the owner role "${record.owner}"`);
  }

  if (!record.charter || String(record.charter).trim().length < 20) {
    errors.push(`${id}: "charter" is required and must be at least 20 characters — a one-paragraph mission statement for what this team owns`);
  }

  for (const field of ['decisionRights', 'forbiddenDecisions', 'escalationPath', 'specialists']) {
    if (record[field] !== undefined && !Array.isArray(record[field])) {
      errors.push(`${id}: "${field}" must be an array of strings when present`);
    }
  }

  if (record.contact !== undefined && (typeof record.contact !== 'object' || Array.isArray(record.contact))) {
    errors.push(`${id}: "contact" must be an object when present (e.g. { "slack": "#team", "owner": "role-id" })`);
  }

  return errors;
}
