/**
 * tests/comment-lint.test.mjs — tests for lib/comment-lint.mjs policy enforcement.
 *
 * Covers: missing-header detection, banned-pattern detection, clean-file pass,
 * --fix stub insertion, and repo-wide linting of the lib/ directory.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { lintFile, lintRepo, formatResults } from '../lib/comment-lint.mjs';

function makeTempFile(relPath, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-clint-'));
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return { dir, full };
}

test('lintFile: reports missing header for scoped .mjs file', () => {
  const { dir, full } = makeTempFile('lib/my-util.mjs', 'export function foo() {}');
  const result = lintFile(full, { rootDir: dir });
  assert.ok(result.errors.some(e => e.label.includes('missing file header')), 'should report missing header');
});

test('lintFile: no error when valid JS header present', () => {
  const { dir, full } = makeTempFile('lib/my-util.mjs', [
    '/**',
    ' * lib/my-util.mjs — utility for testing.',
    ' *',
    ' * Does a thing.',
    ' */',
    'export function foo() {}',
  ].join('\n'));
  const result = lintFile(full, { rootDir: dir });
  assert.equal(result.errors.length, 0, 'clean file should have no errors');
});

test('lintFile: no error for file outside scoped paths', () => {
  const { dir, full } = makeTempFile('untracked/foo.mjs', 'const x = 1;');
  const result = lintFile(full, { rootDir: dir });
  assert.equal(result.errors.length, 0, 'unscoped file should not require header');
});

test('lintFile: warns on "added for" pattern', () => {
  const { dir, full } = makeTempFile('lib/hook.mjs', [
    '/**\n * lib/hook.mjs — test.\n *\n * Summary.\n */',
    '// added for the login flow',
    'export const x = 1;',
  ].join('\n'));
  const result = lintFile(full, { rootDir: dir });
  assert.ok(result.warnings.some(w => w.label.includes('point-in-time')), 'should warn on banned pattern');
});

test('lintFile: warns on caller reference "used by"', () => {
  const { dir, full } = makeTempFile('lib/thing.mjs', [
    '/**\n * lib/thing.mjs — does something.\n *\n * Summary.\n */',
    '// used by the auth module',
    'export const y = 2;',
  ].join('\n'));
  const result = lintFile(full, { rootDir: dir });
  assert.ok(result.warnings.some(w => w.label.includes('caller reference')), 'should warn on caller ref');
});

test('lintFile --fix: inserts stub header', () => {
  const { dir, full } = makeTempFile('lib/stub.mjs', 'export const z = 3;');
  lintFile(full, { rootDir: dir, fix: true });
  const content = fs.readFileSync(full, 'utf8');
  assert.ok(content.startsWith('/**'), 'fix should prepend a JS header stub');
  assert.ok(content.includes('<one-line purpose>'), 'stub should contain placeholder text');
});

test('lintFile --fix: inserts markdown header stub', () => {
  const { dir, full } = makeTempFile('skills/my-skill.md', '# Skill\n\nContent.\n');
  lintFile(full, { rootDir: dir, fix: true });
  const content = fs.readFileSync(full, 'utf8');
  assert.ok(content.startsWith('<!--'), 'fix should prepend an HTML comment header');
});

test('formatResults: returns exit 0 for empty results', () => {
  const { exitCode } = formatResults([]);
  assert.equal(exitCode, 0);
});

test('formatResults: returns exit 1 when errors present', () => {
  const { exitCode } = formatResults([{ path: 'lib/x.mjs', errors: [{ line: 1, label: 'missing header' }], warnings: [] }]);
  assert.equal(exitCode, 1);
});

test('formatResults: returns exit 0 for warnings only', () => {
  const { exitCode } = formatResults([{ path: 'lib/x.mjs', errors: [], warnings: [{ line: 5, label: 'some warning' }] }]);
  assert.equal(exitCode, 0);
});

test('lintRepo: finds violations across multiple files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-clint-repo-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.writeFileSync(path.join(dir, 'lib/a.mjs'), 'export const a = 1;');
  fs.writeFileSync(path.join(dir, 'lib/b.mjs'), 'export const b = 2;');

  const results = lintRepo({ rootDir: dir });
  assert.ok(results.length >= 2, 'should find violations in both files');
  assert.ok(results.every(r => r.errors.length > 0), 'both should have header errors');
});
