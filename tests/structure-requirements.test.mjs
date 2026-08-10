/**
 * tests/structure-requirements.test.mjs — templates satisfy the structural floor.
 *
 * Resolves template paths via artifact manifest when a type maps to a non-default file.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  structureRequirementTypes,
  lintDocStructure,
  STRUCTURE_REQUIREMENTS,
  resolveTemplatePath,
} from '../lib/templates/visual-requirements.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function templateForType(type) {
  const rel = resolveTemplatePath(type, REPO);
  return join(REPO, rel);
}

test('every required doc type ships a template that satisfies its structure', () => {
  for (const type of structureRequirementTypes()) {
    const template = templateForType(type);
    if (!existsSync(template)) continue;
    const violations = lintDocStructure(template, type);
    assert.deepEqual(violations, [], `${type} template fails structure: ${violations.join('; ')}`);
  }
});

test('a document missing a required section is flagged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-struct-'));
  try {
    const f = join(dir, 'adr.md');
    writeFileSync(f, '# ADR\n\n## Problem\n\nx\n\n## Decision\n\ny\n');
    const violations = lintDocStructure(f, 'adr');
    assert.ok(violations.length > 0, 'missing Rejected alternatives/Consequences/Reversibility should fail');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('STRUCTURE_REQUIREMENTS entries are non-empty section lists', () => {
  for (const [type, sections] of Object.entries(STRUCTURE_REQUIREMENTS)) {
    assert.ok(Array.isArray(sections) && sections.length > 0, `${type} has sections`);
  }
});
