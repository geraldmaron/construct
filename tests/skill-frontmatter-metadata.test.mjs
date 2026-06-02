/**
 * tests/skill-frontmatter-metadata.test.mjs — optional embedded-contract metadata.
 *
 * The skill frontmatter convention carries optional inputs (list of strings) and
 * artifactType (string) for capability discovery. These tests pin that the
 * validator accepts well-formed metadata, rejects malformed metadata, and stays
 * silent when the fields are absent (the fields are opt-in).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { validateSkills } from '../lib/validators/skills.mjs';

const tmpDirs = [];
function skillFixture(frontmatter) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-skill-meta-'));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'sample.md'), `---\n${frontmatter}\n---\n# Sample\nUse this skill when testing metadata.\n`);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

const BASE = 'name: sample-skill\ndescription: Use this skill when testing optional metadata fields.';

test('absent optional metadata produces no error', () => {
  const r = validateSkills([skillFixture(BASE)]);
  assert.equal(r.errors.length, 0, r.errors.join('; '));
});

test('well-formed inputs/artifactType pass validation', () => {
  const r = validateSkills([skillFixture(`${BASE}\ninputs: [a, b]\nartifactType: review-report`)]);
  assert.equal(r.errors.length, 0, r.errors.join('; '));
});

test('non-string artifactType is rejected', () => {
  const r = validateSkills([skillFixture(`${BASE}\nartifactType: 42`)]);
  assert.ok(r.errors.some((e) => e.includes('artifactType must be a string')), r.errors.join('; '));
});

test('inputs that is not a list of strings is rejected', () => {
  const r = validateSkills([skillFixture(`${BASE}\ninputs: not-a-list`)]);
  assert.ok(r.errors.some((e) => e.includes('inputs must be a list of strings')), r.errors.join('; '));
});
