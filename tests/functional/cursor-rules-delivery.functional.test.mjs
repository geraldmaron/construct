/**
 * cursor-rules-delivery.functional.test.mjs — project-evidence rule delivery (construct-bwis).
 *
 * Glob-scoped rules land as managed per-rule .mdc files in .cursor/rules/ only
 * when the project's own files match their globs; a rule that stops matching is
 * swept; user-authored .mdc files and the construct.mdc front-door pointer are
 * never touched. Drives the real emitter against a fixture rules dir + project.
 */
import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitCursorRules, globToRegExp } from '../../lib/rules-delivery.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cx-rulesdeliv-'));
  const rulesDir = join(root, 'rules');
  const project = join(root, 'project');
  const w = (rel, body) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), body); };
  w('rules/golang/coding-style.md', '---\ndescription: Go style\npaths:\n  - "**/*.go"\n  - "**/go.mod"\n---\n# Go Style\nrule body');
  w('rules/web/testing.md', '---\ndescription: Web testing\npaths:\n  - "**/*.tsx"\n---\n# Web Testing\nrule body');
  w('rules/common/no-fabrication.md', '---\ndescription: no globs here\n---\nreference-only rule');
  w('project/main.go', 'package main');
  w('project/.cursor/rules/construct.mdc', 'front-door pointer');
  w('project/.cursor/rules/my-own.mdc', 'user rule');
  return { rulesDir, project, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('emits only the rules whose globs match project files, with Cursor frontmatter', () => {
  const { rulesDir, project, cleanup } = fixture();
  try {
    const r = emitCursorRules({ rulesDir, targetDir: project });
    assert.deepEqual(r.matched, ['construct-golang-coding-style.mdc'], 'go matches, web does not, reference-only never');
    const mdc = readFileSync(join(project, '.cursor', 'rules', 'construct-golang-coding-style.mdc'), 'utf8');
    assert.match(mdc, /^---\ndescription: Go style\nglobs: \*\*\/\*\.go, \*\*\/go\.mod\nalwaysApply: false\n---/);
    assert.match(mdc, /# Go Style/);
  } finally { cleanup(); }
});

test('sweeps a managed rule when it stops matching; never touches user files or the pointer', () => {
  const { rulesDir, project, cleanup } = fixture();
  try {
    emitCursorRules({ rulesDir, targetDir: project });
    unlinkSync(join(project, 'main.go'));
    const r2 = emitCursorRules({ rulesDir, targetDir: project });
    assert.deepEqual(r2.swept, ['construct-golang-coding-style.mdc']);
    assert.ok(!existsSync(join(project, '.cursor', 'rules', 'construct-golang-coding-style.mdc')));
    assert.ok(existsSync(join(project, '.cursor', 'rules', 'construct.mdc')), 'front-door pointer untouched');
    assert.ok(existsSync(join(project, '.cursor', 'rules', 'my-own.mdc')), 'user rule untouched');
  } finally { cleanup(); }
});

test('second run is a no-op (idempotent)', () => {
  const { rulesDir, project, cleanup } = fixture();
  try {
    emitCursorRules({ rulesDir, targetDir: project });
    const r2 = emitCursorRules({ rulesDir, targetDir: project });
    assert.deepEqual(r2.emitted, [], 'unchanged content is not rewritten');
    assert.deepEqual(r2.swept, []);
  } finally { cleanup(); }
});

test('dryRun reports matches without writing', () => {
  const { rulesDir, project, cleanup } = fixture();
  try {
    const r = emitCursorRules({ rulesDir, targetDir: project, dryRun: true });
    assert.equal(r.matched.length, 1);
    assert.ok(!existsSync(join(project, '.cursor', 'rules', 'construct-golang-coding-style.mdc')));
  } finally { cleanup(); }
});

test('glob translation covers the corpus shapes', () => {
  assert.ok(globToRegExp('**/*.go').test('a/b/c.go'));
  assert.ok(globToRegExp('**/go.sum').test('go.sum'));
  assert.ok(!globToRegExp('*.md').test('docs/x.md'));
});
