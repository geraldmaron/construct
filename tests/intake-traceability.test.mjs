/**
 * tests/intake-traceability.test.mjs — coverage for lib/intake/traceability.mjs.
 *
 * Verifies stampIntakeProvenance writes intake_id / intake_confidence /
 * intake_rationale into artifact YAML frontmatter, refuses to overwrite a
 * different intake_id, preserves existing frontmatter fields, and creates a
 * frontmatter block when none exists.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import {
  stampIntakeProvenance,
  parseArtifactFrontmatter,
  hasIntakeReference,
} from '../lib/intake/traceability.mjs';

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function makeTempArtifact(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-intake-trace-'));
  tmpDirs.push(dir);
  const file = path.join(dir, 'fixture.md');
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

test('stamps intake_id into a file with no frontmatter (prepends block)', () => {
  const file = makeTempArtifact('# Fixture PRD\n\nbody content\n');
  const result = stampIntakeProvenance(file, {
    intakeId: 'construct-abc',
    confidence: 0.7,
    rationale: 'Matched 2 keywords',
  });
  assert.equal(result.intake_id, 'construct-abc');
  const content = fs.readFileSync(file, 'utf8');
  assert.ok(content.startsWith('---\n'));
  assert.ok(content.includes('intake_id: construct-abc'));
  assert.ok(content.includes('intake_confidence: 0.7'));
});

test('stamps intake_id into existing frontmatter (preserves other fields)', () => {
  const file = makeTempArtifact('---\ntitle: My PRD\nstatus: draft\n---\n\n# body\n');
  stampIntakeProvenance(file, {
    intakeId: 'construct-xyz',
    confidence: 0.9,
    rationale: 'Direct match',
  });
  const { frontmatter } = parseArtifactFrontmatter(fs.readFileSync(file, 'utf8'));
  assert.equal(frontmatter.title, 'My PRD');
  assert.equal(frontmatter.status, 'draft');
  assert.equal(frontmatter.intake_id, 'construct-xyz');
  assert.equal(frontmatter.intake_confidence, 0.9);
});

test('refuses to overwrite a different intake_id', () => {
  const file = makeTempArtifact('---\nintake_id: construct-first\n---\n\nbody\n');
  assert.throws(
    () => stampIntakeProvenance(file, { intakeId: 'construct-second' }),
    /Refusing to overwrite intake_id/,
  );
});

test('idempotent: re-stamping with the same intake_id succeeds', () => {
  const file = makeTempArtifact('# body\n');
  stampIntakeProvenance(file, { intakeId: 'construct-aaa', confidence: 0.6 });
  stampIntakeProvenance(file, { intakeId: 'construct-aaa', confidence: 0.8 });
  const { frontmatter } = parseArtifactFrontmatter(fs.readFileSync(file, 'utf8'));
  assert.equal(frontmatter.intake_id, 'construct-aaa');
  assert.equal(frontmatter.intake_confidence, 0.8);
});

test('throws when output artifact path does not exist', () => {
  assert.throws(
    () => stampIntakeProvenance('/nonexistent/path/foo.md', { intakeId: 'construct-x' }),
    /Output artifact not found/,
  );
});

test('hasIntakeReference detects intake_id', () => {
  const file = makeTempArtifact('---\nintake_id: construct-foo\n---\n');
  assert.equal(hasIntakeReference(file), true);
});

test('hasIntakeReference detects intake: none declaration', () => {
  const file = makeTempArtifact('---\nintake: none\n---\n');
  assert.equal(hasIntakeReference(file), true);
});

test('hasIntakeReference returns false when no intake declaration', () => {
  const file = makeTempArtifact('---\ntitle: My PRD\n---\n');
  assert.equal(hasIntakeReference(file), false);
});

test('hasIntakeReference returns false for missing file', () => {
  assert.equal(hasIntakeReference('/nonexistent/path/foo.md'), false);
});
