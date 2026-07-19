/**
 * Draft, archive, and health operations for Workspace Presets.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configPath } from '../config-dir.mjs';
import { emitBestEffort as emitRoleEvent } from '../roles/event-bus.mjs';
import { listWorkspacePresets } from './loader.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..');

function draftDir(cwd, id) {
  return configPath(cwd, 'workspace-presets', `draft-${id}`);
}

function archiveDir(id) {
  return path.join(REPO_ROOT, 'archive', 'workspace-presets', id);
}

function emitWorkspacePresetUpdated(context) {
  emitRoleEvent('workspace-preset.updated', {
    summary: `Workspace Preset ${context.stage}: ${context.id}`,
    context,
  });
}

export function createDraftWorkspacePreset({ cwd, id, displayName }) {
  if (!cwd || !id) throw new Error('createDraftWorkspacePreset: cwd and id are required');
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(id)) {
    throw new Error('createDraftWorkspacePreset: id must match ^[a-z][a-z0-9-]{1,30}$');
  }
  if (listWorkspacePresets().includes(id)) {
    throw new Error(`createDraftWorkspacePreset: ${id} already exists in the catalog`);
  }
  const dir = draftDir(cwd, id);
  if (fs.existsSync(dir)) throw new Error(`createDraftWorkspacePreset: draft already exists at ${dir}`);
  fs.mkdirSync(dir, { recursive: true });

  const draftPath = path.join(dir, 'workspace-preset.json');
  const briefPath = path.join(dir, 'requirements.md');
  const draft = {
    $schema: '../../../schemas/workspace-preset.schema.json',
    id,
    displayName: displayName || id,
    tagline: 'Draft. Replace with a concise statement of the workspace-wide defaults.',
    skills: [],
    procedures: [],
    intake: { types: [], stages: [], classificationTable: null },
    artifactClasses: [],
    hooks: { sessionReflect: 'on', sessionOptimize: 'on' },
  };
  fs.writeFileSync(draftPath, `${JSON.stringify(draft, null, 2)}\n`);
  fs.writeFileSync(briefPath, [
    `# Workspace Preset requirements: ${displayName || id}`,
    '',
    'Define the reusable intake taxonomy, artifact classes, skills, procedures, tone defaults, and research profiles.',
    'Every selection must trace to observed workspace needs and resolve to an existing canonical catalog record.',
    '',
  ].join('\n'));
  emitWorkspacePresetUpdated({ id, stage: 'draft', dir });
  return { dir, briefPath, draftPath };
}

export function listDrafts(cwd) {
  const root = configPath(cwd, 'workspace-presets');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('draft-'))
    .map((entry) => {
      const dir = path.join(root, entry.name);
      return {
        id: entry.name.slice('draft-'.length),
        dir,
        hasWorkspacePreset: fs.existsSync(path.join(dir, 'workspace-preset.json')),
        hasBrief: fs.existsSync(path.join(dir, 'requirements.md')),
      };
    });
}

export function archiveWorkspacePreset({ id, reason }) {
  if (!id) throw new Error('archiveWorkspacePreset: id is required');
  if (!reason || reason.trim().length < 8) {
    throw new Error('archiveWorkspacePreset: a substantive reason (>= 8 chars) is required');
  }
  const source = path.join(REPO_ROOT, 'registry', 'workspace-presets', `${id}.json`);
  if (!fs.existsSync(source)) throw new Error(`archiveWorkspacePreset: ${id} not found`);
  const destination = archiveDir(id);
  fs.mkdirSync(destination, { recursive: true });
  fs.renameSync(source, path.join(destination, `${id}.json`));
  fs.writeFileSync(path.join(destination, 'archive-note.md'), [
    `# Archive: ${id}`,
    '',
    `Archived at ${new Date().toISOString()}.`,
    '',
    '## Reason',
    '',
    reason.trim(),
    '',
  ].join('\n'));
  emitWorkspacePresetUpdated({ id, stage: 'archived', dir: destination, reason: reason.trim() });
  return { archived: destination };
}

export function workspacePresetHealth(cwd, workspacePresetId, { windowDays = 30 } = {}) {
  const cutoff = Date.now() - windowDays * 86_400_000;
  const outcomesDir = configPath(cwd, 'outcomes');
  const workerHealth = {};
  if (fs.existsSync(outcomesDir)) {
    for (const name of fs.readdirSync(outcomesDir)) {
      if (!name.endsWith('.jsonl')) continue;
      const worker = name.replace(/\.\d+\.jsonl$|\.jsonl$/, '');
      for (const line of fs.readFileSync(path.join(outcomesDir, name), 'utf8').split('\n').filter(Boolean)) {
        try {
          const entry = JSON.parse(line);
          if (entry.workspacePreset !== workspacePresetId || Date.parse(entry.timestamp || entry.createdAt) < cutoff) continue;
          workerHealth[worker] ||= { runs: 0, successes: 0, successRate: null };
          workerHealth[worker].runs += 1;
          if (entry.success === true) workerHealth[worker].successes += 1;
        } catch { /* ignore malformed historical lines */ }
      }
    }
  }
  for (const health of Object.values(workerHealth)) {
    health.successRate = health.runs ? health.successes / health.runs : null;
  }
  return { workspacePresetId, windowDays, workerHealth };
}
