/**
 * tests/registry/custom-loader.test.mjs — merge precedence for custom Worker Profiles.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { mergeWorkerProfiles } from '../../lib/registry/custom-loader.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');

function mkProject(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-loader-'));
  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });
  return dir;
}

test('mergeWorkerProfiles includes project tier and wins over registry on id collision', (t) => {
  const cwd = mkProject(t);
  const profileDir = path.join(cwd, '.construct/org/worker-profiles');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'engineer.json'), `${JSON.stringify({
    name: 'engineer',
    displayName: 'Custom engineer overlay',
    description: 'Project-local engineer overlay for merge precedence checks',
    role: 'engineer',
    modelTier: 'standard',
    skills: ['development/typescript'],
    fence: { allowedPaths: ['src/**'] },
    team: 'engineer',
    teamId: 'engineer',
    promptFile: '.construct/org/prompts/engineer.md',
  }, null, 2)}\n`);
  fs.mkdirSync(path.join(cwd, '.construct/org/prompts'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.construct/org/prompts/engineer.md'), '# engineer\n');

  const { records, byId } = mergeWorkerProfiles({ rootDir: ROOT, cwd });
  assert.equal(byId.engineer.source, 'project');
  assert.match(byId.engineer.displayName, /Custom engineer overlay/);
  assert.ok(records.some((record) => record.id === 'engineer' && record.source === 'project'));
});
