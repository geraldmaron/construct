#!/usr/bin/env node
/**
 * Validate the canonical Workspace Preset catalog and shared skill graph.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listWorkspacePresets, loadWorkspacePreset } from '../lib/workspace-presets/loader.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRESETS_DIR = path.join(REPO_ROOT, 'registry', 'workspace-presets');
const quiet = process.argv.includes('--quiet');
let failed = 0;

function fail(message) { failed += 1; console.error(`  ✗ ${message}`); }
function ok(message) { if (!quiet) console.log(`  ✓ ${message}`); }

function checkWorkspacePreset(id) {
  const file = path.join(PRESETS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return fail(`Workspace Preset ${id}: catalog file is missing`);
  const preset = loadWorkspacePreset(id, { rootDir: REPO_ROOT });
  if (!preset) return fail(`Workspace Preset ${id}: failed to load`);
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(preset.id ?? '')) fail(`Workspace Preset ${id}: invalid id`);
  if (!preset.displayName) fail(`Workspace Preset ${id}: displayName is required`);
  if (!Array.isArray(preset.skills)) fail(`Workspace Preset ${id}: skills must be an array`);
  if (!Array.isArray(preset.procedures)) fail(`Workspace Preset ${id}: procedures must be an array`);
  if (!Array.isArray(preset.artifactClasses)) fail(`Workspace Preset ${id}: artifactClasses must be an array`);
  if (!Array.isArray(preset.intake?.types) || preset.intake.types.length > 24) {
    fail(`Workspace Preset ${id}: intake.types must contain at most 24 entries`);
  }
  if (!Array.isArray(preset.intake?.stages) || preset.intake.stages.length > 12) {
    fail(`Workspace Preset ${id}: intake.stages must contain at most 12 entries`);
  }
  for (const retired of ['roles', 'teams', 'departments', 'extends', 'defaultSkills', 'docTemplates']) {
    if (Object.hasOwn(preset, retired)) fail(`Workspace Preset ${id}: retired field ${retired} is not allowed`);
  }
  ok(`Workspace Preset ${id}`);
}

console.log('lint:workspace-presets');
const ids = listWorkspacePresets({ rootDir: REPO_ROOT });
for (const id of ids) checkWorkspacePreset(id);

if (failed === 0) {
  console.log(`\nlint:workspace-presets — clean (${ids.length} presets)`);
  process.exit(0);
}
console.error(`\nlint:workspace-presets — ${failed} violation${failed === 1 ? '' : 's'}`);
process.exit(1);
