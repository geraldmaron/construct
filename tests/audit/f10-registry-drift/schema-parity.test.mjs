import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { DEFAULT_PROJECT_CONFIG, FIELD_RULES } from '../../../lib/config/schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const jsonSchema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'project-config.schema.json'), 'utf8'));

test('[R15] Workspace Preset config vocabulary is identical across validators', () => {
  assert.ok(Object.hasOwn(jsonSchema.properties, 'workspacePreset'));
  assert.ok(Object.hasOwn(FIELD_RULES, 'workspacePreset'));
  assert.equal(DEFAULT_PROJECT_CONFIG.workspacePreset, jsonSchema.properties.workspacePreset.default);
  assert.deepEqual(
    [...FIELD_RULES.workspacePreset.enum].sort(),
    [...jsonSchema.properties.workspacePreset.enum].sort(),
  );
});
