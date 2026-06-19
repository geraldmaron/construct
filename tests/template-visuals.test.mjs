/**
 * tests/template-visuals.test.mjs — templates satisfy the visual matrix.
 *
 * @enforces ADR-0015
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  VISUAL_REQUIREMENTS,
  visualRequirementTypes,
  lintDocVisuals,
  resolveTemplatePath,
} from '../lib/templates/visual-requirements.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('every required doc type has a template that satisfies its visuals', () => {
  for (const type of visualRequirementTypes()) {
    const template = join(REPO, resolveTemplatePath(type, REPO));
    if (!existsSync(template)) {
      assert.fail(`${type}: template missing at ${template}`);
    }
    const violations = lintDocVisuals(template, type);
    assert.deepEqual(violations, [], `${type} template missing required visual: ${violations.join('; ')}`);
  }
});

test('a doc missing the required visual is flagged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-tv-'));
  try {
    const f = join(dir, 'runbook.md');
    writeFileSync(f, '# Runbook\n\n## Diagnostic steps\n\njust prose, no flowchart\n');
    const violations = lintDocVisuals(f, 'runbook');
    assert.equal(violations.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a type with no declared requirements lints clean', () => {
  assert.deepEqual(lintDocVisuals('/nonexistent.md', 'memo'), []);
  assert.ok(!('memo' in VISUAL_REQUIREMENTS));
});
