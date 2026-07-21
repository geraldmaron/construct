/**
 * skills-apply.test.mjs — Regression coverage for per-host skill sidecar writers.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { writeOpenCodeHostConfig } from '../lib/skills-apply.mjs';

import { tempDir } from './helpers.mjs';

test('writeOpenCodeHostConfig writes a sidecar instead of project-root opencode.json', () => {
  const cwd = tempDir('construct-skills-apply-');
  const sidecarPath = writeOpenCodeHostConfig(cwd, {
    irrelevant: ['frontend-patterns', 'python-testing'],
    protected: ['engineer'],
  });

  assert.equal(sidecarPath, path.join(cwd, '.opencode', 'construct-skills.json'));
  assert.equal(fs.existsSync(path.join(cwd, 'opencode.json')), false);

  const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  assert.equal(sidecar.version, 1);
  assert.equal(sidecar.source, '.construct/skills-profile.json');
  assert.deepEqual(sidecar.disabledSkills, ['frontend-patterns', 'python-testing']);
  assert.deepEqual(sidecar.protected, ['engineer']);
  assert.match(sidecar.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('writeOpenCodeHostConfig merges disabled skills from an existing sidecar', () => {
  const cwd = tempDir('construct-skills-apply-merge-');
  const sidecarPath = path.join(cwd, '.opencode', 'construct-skills.json');
  fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
  fs.writeFileSync(sidecarPath, JSON.stringify({
    version: 1,
    disabledSkills: ['python-testing'],
    protected: [],
  }, null, 2));

  writeOpenCodeHostConfig(cwd, {
    irrelevant: ['frontend-patterns', 'python-testing'],
    protected: [],
  });

  const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  assert.deepEqual(sidecar.disabledSkills, ['frontend-patterns', 'python-testing']);
});
