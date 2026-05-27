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
import test, { after } from 'node:test';

import { lintFile, lintRepo, formatResults } from '../lib/comment-lint.mjs';

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function makeTempFile(relPath, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-clint-'));
  tmpDirs.push(dir);
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
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.writeFileSync(path.join(dir, 'lib/a.mjs'), 'export const a = 1;');
  fs.writeFileSync(path.join(dir, 'lib/b.mjs'), 'export const b = 2;');

  const results = lintRepo({ rootDir: dir });
  assert.ok(results.length >= 2, 'should find violations in both files');
  assert.ok(results.every(r => r.errors.length > 0), 'both should have header errors');
});

test('lintFile: .md under tests/ uses markdown header rule (regression for tests/ glob)', () => {
  // Pre-fix bug: JS_HEADER_GLOBS includes /^tests\// so a .md file under
  // tests/ was mis-classified as JS and required /** */ format. The fix
  // routes .md extensions to markdown header detection regardless of the
  // directory glob match.
  const { dir, full } = makeTempFile('tests/functional/README.md', [
    '<!--',
    'tests/functional/README.md. Discipline doc.',
    '-->',
    '',
    '# Functional tests',
    'body',
  ].join('\n'));
  const result = lintFile(full, { rootDir: dir });
  assert.equal(result.errors.length, 0, `unexpected errors: ${JSON.stringify(result.errors)}`);
});

test('lintFile: .md without markdown header still reports the error', () => {
  const { dir, full } = makeTempFile('skills/roles/example.md', '# No header\n\nbody');
  const result = lintFile(full, { rootDir: dir });
  assert.ok(result.errors.some((e) => e.label.includes('missing file header')));
});

// --- artifact-prose lint (no-fabrication) ---

function artifactBody(extra) {
  return [
    '<!--',
    'docs/prd/fixture.md — test fixture.',
    '-->',
    '',
    '# Fixture PRD',
    '',
    extra,
  ].join('\n');
}

test('artifact lint: manufactured confidence in PRD prose is flagged', () => {
  const { dir, full } = makeTempFile('docs/prd/fixture.md', artifactBody('Clearly the dashboard is the bottleneck.'));
  delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  const result = lintFile(full, { rootDir: dir });
  assert.ok(
    result.warnings.some((w) => w.kind === 'artifact' && w.label.includes('manufactured confidence')),
    `expected manufactured-confidence warning; got ${JSON.stringify(result.warnings)}`,
  );
});

test('artifact lint: same banned phrase in docs/cookbook is NOT flagged (out of scope)', () => {
  const { dir, full } = makeTempFile('docs/cookbook/fixture.md', artifactBody('Clearly this is intentional content for cookbook prose.'));
  delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  const result = lintFile(full, { rootDir: dir });
  assert.ok(
    !result.warnings.some((w) => w.kind === 'artifact'),
    `cookbook should not trigger artifact lint; got ${JSON.stringify(result.warnings)}`,
  );
});

test('artifact lint: percentage with citation does NOT trigger', () => {
  const { dir, full } = makeTempFile('docs/prd/fixture.md', artifactBody('Dashboard latency dropped 30% under load [source: bench-2026-04-12].'));
  delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  const result = lintFile(full, { rootDir: dir });
  assert.ok(
    !result.warnings.some((w) => w.kind === 'artifact' && w.label.includes('unattributed percentage')),
    `cited percentage should pass; got ${JSON.stringify(result.warnings)}`,
  );
});

test('artifact lint: percentage without citation IS flagged', () => {
  const { dir, full } = makeTempFile('docs/prd/fixture.md', artifactBody('Dashboard latency dropped 30% under load.'));
  delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  const result = lintFile(full, { rootDir: dir });
  assert.ok(
    result.warnings.some((w) => w.kind === 'artifact' && w.label.includes('unattributed percentage')),
    `uncited percentage should fail; got ${JSON.stringify(result.warnings)}`,
  );
});

test('artifact lint: customer mind-reading requires citation', () => {
  const { dir, full } = makeTempFile('docs/prd/fixture.md', artifactBody('Users want faster dashboards.'));
  delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  const result = lintFile(full, { rootDir: dir });
  assert.ok(
    result.warnings.some((w) => w.kind === 'artifact' && w.label.includes('customer mind-reading')),
    `uncited customer claim should fail; got ${JSON.stringify(result.warnings)}`,
  );
});

test('artifact lint: speculative projection requires source', () => {
  const { dir, full } = makeTempFile('docs/prd/fixture.md', artifactBody('Latency will likely drop after rollout.'));
  delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  const result = lintFile(full, { rootDir: dir });
  assert.ok(
    result.warnings.some((w) => w.kind === 'artifact' && w.label.includes('speculative projection')),
    `speculative projection should fail; got ${JSON.stringify(result.warnings)}`,
  );
});

test('artifact lint: code block content is skipped', () => {
  const body = [
    '<!--',
    'docs/prd/fixture.md — fixture.',
    '-->',
    '',
    '# Fixture',
    '',
    '```',
    'Clearly this is sample code, not narrative prose.',
    '```',
  ].join('\n');
  const { dir, full } = makeTempFile('docs/prd/fixture.md', body);
  delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  const result = lintFile(full, { rootDir: dir });
  assert.ok(
    !result.warnings.some((w) => w.kind === 'artifact'),
    `code blocks should be skipped; got ${JSON.stringify(result.warnings)}`,
  );
});

test('artifact lint: table rows are skipped (targets, not narrative)', () => {
  const body = [
    '<!--',
    'docs/prd/fixture.md — fixture.',
    '-->',
    '',
    '# Metrics',
    '',
    '| Metric | Target |',
    '|---|---|',
    '| Dashboard latency | <200ms p95 30% improvement |',
  ].join('\n');
  const { dir, full } = makeTempFile('docs/prd/fixture.md', body);
  delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  const result = lintFile(full, { rootDir: dir });
  assert.ok(
    !result.warnings.some((w) => w.kind === 'artifact'),
    `table rows should be skipped; got ${JSON.stringify(result.warnings)}`,
  );
});

test('artifact lint: block mode routes hits to errors instead of warnings', () => {
  const { dir, full } = makeTempFile('docs/prd/fixture.md', artifactBody('Clearly this works.'));
  process.env.CONSTRUCT_ARTIFACT_LINT_MODE = 'block';
  try {
    const result = lintFile(full, { rootDir: dir });
    assert.ok(
      result.errors.some((e) => e.label.includes('manufactured confidence')),
      `block mode should put hits in errors[]; got ${JSON.stringify(result)}`,
    );
    assert.ok(
      !result.warnings.some((w) => w.kind === 'artifact'),
      `block mode should not put hits in warnings[]; got ${JSON.stringify(result.warnings)}`,
    );
  } finally {
    delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  }
});

test('artifact lint: construct-lint-ignore marker suppresses the hit on that line', () => {
  const { dir, full } = makeTempFile('docs/prd/fixture.md', artifactBody('Clearly intentional. construct-lint-ignore'));
  delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  const result = lintFile(full, { rootDir: dir });
  assert.ok(
    !result.warnings.some((w) => w.kind === 'artifact'),
    `construct-lint-ignore should suppress hit; got ${JSON.stringify(result.warnings)}`,
  );
});
