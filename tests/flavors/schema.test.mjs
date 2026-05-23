/**
 * tests/flavors/schema.test.mjs — Every flavor overlay conforms to the schema.
 *
 * After scripts/migrate-flavors.mjs runs, every file in skills/roles/ must:
 *   - Have parseable frontmatter
 *   - Declare profiles: [...] (non-empty)
 *   - Declare cap: 1
 *   - Pass the validator with no errors
 *
 * Also enforces the per-role per-profile flavor cap.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { FLAVOR_CAP_PER_ROLE_PER_PROFILE, listAllFlavors, perRoleFlavorCount, validateFlavor } from '../../lib/flavors/loader.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FLAVORS_DIR = path.join(REPO_ROOT, 'skills', 'roles');

test('every overlay in skills/roles/ passes validateFlavor', () => {
  const files = fs.readdirSync(FLAVORS_DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md');
  assert.ok(files.length > 0);
  const allErrors = [];
  for (const f of files) {
    const errors = validateFlavor(path.join(FLAVORS_DIR, f));
    if (errors.length > 0) allErrors.push(...errors);
  }
  assert.deepEqual(allErrors, [], `validation errors:\n${allErrors.join('\n')}`);
});

test('per-role flavor count under the cap of 6 for the rnd profile', () => {
  const counts = perRoleFlavorCount('rnd');
  for (const [role, count] of Object.entries(counts)) {
    assert.ok(
      count <= FLAVOR_CAP_PER_ROLE_PER_PROFILE,
      `role ${role} has ${count} flavors (cap ${FLAVOR_CAP_PER_ROLE_PER_PROFILE})`,
    );
  }
});

test('listAllFlavors returns 50+ entries after migration', () => {
  const all = listAllFlavors();
  assert.ok(all.length >= 50, `only ${all.length} overlays parseable`);
});

test('every overlay declares profiles and cap', () => {
  for (const entry of listAllFlavors()) {
    assert.ok(
      Array.isArray(entry.frontmatter.profiles) && entry.frontmatter.profiles.length > 0,
      `${entry.file} missing profiles`,
    );
    assert.equal(entry.frontmatter.cap, 1, `${entry.file} cap != 1`);
  }
});
