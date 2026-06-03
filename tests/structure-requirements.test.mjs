/**
 * tests/structure-requirements.test.mjs — templates satisfy the structural floor.
 *
 * @enforces ADR-0018
 *
 * Beads construct-7zrh.4 / .5: every doc type with declared structure requirements
 * ships a template that already contains the required sections (and visuals), so a
 * template cannot quietly drop a section the quality rubric requires. Includes a
 * failure case proving the gate bites.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { structureRequirementTypes, lintDocStructure, STRUCTURE_REQUIREMENTS } from '../lib/templates/visual-requirements.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('every required doc type ships a template that satisfies its structure', () => {
  for (const type of structureRequirementTypes()) {
    const template = join(REPO, 'templates', 'docs', `${type}.md`);
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
