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
  const { dir, full } = makeTempFile('skills/perspectives/example.md', '# No header\n\nbody');
  const result = lintFile(full, { rootDir: dir });
  assert.ok(result.errors.some((e) => e.label.includes('missing file header')));
});

// --- artifact-prose lint (no-fabrication) ---

function artifactBody(extra) {
  return [
    '<!--',
    'docs/specs/prd/fixture.md — test fixture.',
    '-->',
    '',
    '# Fixture PRD',
    '',
    extra,
  ].join('\n');
}

test('artifact lint: manufactured confidence in PRD prose is flagged', () => {
  const { dir, full } = makeTempFile('docs/specs/prd/fixture.md', artifactBody('Clearly the dashboard is the bottleneck.'));
  delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  const result = lintFile(full, { rootDir: dir });
  assert.ok(
    result.warnings.some((w) => w.kind === 'artifact' && w.label.includes('manufactured confidence')),
    `expected manufactured-confidence warning; got ${JSON.stringify(result.warnings)}`,
  );
});

test('artifact lint: same banned phrase in docs/cookbook is NOT flagged (out of scope)', () => {
  const { dir, full } = makeTempFile('docs/guides/cookbook/fixture.md', artifactBody('Clearly this is intentional content for cookbook prose.'));
  delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  const result = lintFile(full, { rootDir: dir });
  assert.ok(
    !result.warnings.some((w) => w.kind === 'artifact'),
    `cookbook should not trigger artifact lint; got ${JSON.stringify(result.warnings)}`,
  );
});

test('artifact lint: percentage with citation does NOT trigger', () => {
  const { dir, full } = makeTempFile('docs/specs/prd/fixture.md', artifactBody('Dashboard latency dropped 30% under load [source: bench-2026-04-12].'));
  delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  const result = lintFile(full, { rootDir: dir });
  assert.ok(
    !result.warnings.some((w) => w.kind === 'artifact' && w.label.includes('unattributed percentage')),
    `cited percentage should pass; got ${JSON.stringify(result.warnings)}`,
  );
});

test('artifact lint: percentage without citation IS flagged', () => {
  const { dir, full } = makeTempFile('docs/specs/prd/fixture.md', artifactBody('Dashboard latency dropped 30% under load.'));
  delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  const result = lintFile(full, { rootDir: dir });
  assert.ok(
    result.warnings.some((w) => w.kind === 'artifact' && w.label.includes('unattributed percentage')),
    `uncited percentage should fail; got ${JSON.stringify(result.warnings)}`,
  );
});

test('artifact lint: customer mind-reading requires citation', () => {
  const { dir, full } = makeTempFile('docs/specs/prd/fixture.md', artifactBody('Users want faster dashboards.'));
  delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  const result = lintFile(full, { rootDir: dir });
  assert.ok(
    result.warnings.some((w) => w.kind === 'artifact' && w.label.includes('customer mind-reading')),
    `uncited customer claim should fail; got ${JSON.stringify(result.warnings)}`,
  );
});

test('artifact lint: speculative projection requires source', () => {
  const { dir, full } = makeTempFile('docs/specs/prd/fixture.md', artifactBody('Latency will likely drop after rollout.'));
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
    'docs/specs/prd/fixture.md — fixture.',
    '-->',
    '',
    '# Fixture',
    '',
    '```',
    'Clearly this is sample code, not narrative prose.',
    '```',
  ].join('\n');
  const { dir, full } = makeTempFile('docs/specs/prd/fixture.md', body);
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
    'docs/specs/prd/fixture.md — fixture.',
    '-->',
    '',
    '# Metrics',
    '',
    '| Metric | Target |',
    '|---|---|',
    '| Dashboard latency | <200ms p95 30% improvement |',
  ].join('\n');
  const { dir, full } = makeTempFile('docs/specs/prd/fixture.md', body);
  delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  const result = lintFile(full, { rootDir: dir });
  assert.ok(
    !result.warnings.some((w) => w.kind === 'artifact'),
    `table rows should be skipped; got ${JSON.stringify(result.warnings)}`,
  );
});

test('artifact lint: block mode routes hits to errors instead of warnings', () => {
  const { dir, full } = makeTempFile('docs/specs/prd/fixture.md', artifactBody('Clearly this works.'));
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
  const { dir, full } = makeTempFile('docs/specs/prd/fixture.md', artifactBody('Clearly intentional. construct-lint-ignore'));
  delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  const result = lintFile(full, { rootDir: dir });
  assert.ok(
    !result.warnings.some((w) => w.kind === 'artifact'),
    `construct-lint-ignore should suppress hit; got ${JSON.stringify(result.warnings)}`,
  );
});

// A guide or operations doc claiming staged/not-yet-shipped behavior must cite
// an id from the linted project's own tracker within two lines.

test('future-state marker: flags "staged/experimental" in a guide doc with no bead id nearby', () => {
  const body = '# Guide\n\nBrokered MCP dispatch is staged/experimental in this release.\n';
  const { dir, full } = makeTempFile('docs/guides/concepts/fixture.md', body);
  process.env.CONSTRUCT_ARTIFACT_LINT_MODE = 'block';
  try {
    const result = lintFile(full, { rootDir: dir });
    assert.ok(
      result.errors.some((e) => e.label.includes('future-state doc marker')),
      `expected a future-state marker error; got ${JSON.stringify(result)}`,
    );
  } finally {
    delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  }
});

test('future-state marker: passes when a construct-* bead id is within two lines', () => {
  const body = '# Guide\n\nBrokered MCP dispatch is staged/experimental (tracked: construct-9oi4.10).\n';
  const { dir, full } = makeTempFile('docs/guides/concepts/fixture.md', body);
  process.env.CONSTRUCT_ARTIFACT_LINT_MODE = 'block';
  try {
    const result = lintFile(full, { rootDir: dir });
    assert.ok(
      !result.errors.some((e) => e.label.includes('future-state doc marker')),
      `bead id nearby should suppress the hit; got ${JSON.stringify(result)}`,
    );
  } finally {
    delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  }
});

test('future-state marker: "not yet implemented" inside a markdown table row is skipped (table cells, not prose)', () => {
  const body = [
    '# Guide',
    '',
    '| Capability | Status |',
    '|---|---|',
    '| watch | not yet implemented |',
  ].join('\n');
  const { dir, full } = makeTempFile('docs/guides/reference/fixture.md', body);
  process.env.CONSTRUCT_ARTIFACT_LINT_MODE = 'block';
  try {
    const result = lintFile(full, { rootDir: dir });
    assert.ok(
      !result.errors.some((e) => e.label.includes('future-state doc marker')),
      `table rows should be skipped; got ${JSON.stringify(result)}`,
    );
  } finally {
    delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  }
});

test('future-state marker: out-of-scope docs paths (research notes) are not checked', () => {
  const body = '# Note\n\nThis feature is staged/experimental with no tracker id.\n';
  const { dir, full } = makeTempFile('docs/notes/research/fixture.md', body);
  process.env.CONSTRUCT_ARTIFACT_LINT_MODE = 'block';
  try {
    const result = lintFile(full, { rootDir: dir });
    assert.ok(
      !result.errors.some((e) => e.label.includes('future-state doc marker')),
      `research notes are out of scope; got ${JSON.stringify(result)}`,
    );
  } finally {
    delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  }
});

test('future-state marker: hooks-deprecated.md ledger is excluded', () => {
  const body = '# Deprecated hooks\n\nThe replacement is not yet implemented in policy-engine.\n';
  const { dir, full } = makeTempFile('docs/guides/reference/hooks-deprecated.md', body);
  process.env.CONSTRUCT_ARTIFACT_LINT_MODE = 'block';
  try {
    const result = lintFile(full, { rootDir: dir });
    assert.ok(
      !result.errors.some((e) => e.label.includes('future-state doc marker')),
      `hooks-deprecated.md is its own ledger convention; got ${JSON.stringify(result)}`,
    );
  } finally {
    delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  }
});

test('future-state marker: .mdx guide docs are checked (architecture.mdx / deployment-model.mdx use .mdx)', () => {
  const body = '# Guide\n\nMCP dispatch is staged/experimental with no citation.\n';
  const { dir, full } = makeTempFile('docs/guides/concepts/fixture.mdx', body);
  process.env.CONSTRUCT_ARTIFACT_LINT_MODE = 'block';
  try {
    const result = lintFile(full, { rootDir: dir });
    assert.ok(
      result.errors.some((e) => e.label.includes('future-state doc marker')),
      `.mdx docs must be scanned; got ${JSON.stringify(result)}`,
    );
  } finally {
    delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  }
});

// The required id belongs to the project being linted. A downstream repo cites
// its own tracker, so these fixtures declare a prefix that is not this one's and
// assert the check follows it.

function withTracker(dir, prefix) {
  fs.mkdirSync(path.join(dir, '.beads'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.beads', 'config.yaml'), `issue-prefix: "${prefix}"\n`);
}

function futureStateErrors(dir, full) {
  process.env.CONSTRUCT_ARTIFACT_LINT_MODE = 'block';
  try {
    return lintFile(full, { rootDir: dir }).errors.filter((e) => e.label.includes('future-state doc marker'));
  } finally {
    delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  }
}

test('future-state marker: a declared tracker prefix is what the doc must cite', () => {
  const body = '# Guide\n\nBrokered dispatch is staged/experimental (tracked: acme-4821).\n';
  const { dir, full } = makeTempFile('docs/guides/concepts/fixture.md', body);
  withTracker(dir, 'acme');
  assert.equal(futureStateErrors(dir, full).length, 0, 'an id in the project\'s own prefix satisfies the marker');
});

test('future-state marker: an id from a different tracker does not satisfy the check', () => {
  const body = '# Guide\n\nBrokered dispatch is staged/experimental (tracked: construct-9oi4.10).\n';
  const { dir, full } = makeTempFile('docs/guides/concepts/fixture.md', body);
  withTracker(dir, 'acme');
  const errors = futureStateErrors(dir, full);
  assert.equal(errors.length, 1, `a foreign prefix must not satisfy the marker; got ${JSON.stringify(errors)}`);
  assert.ok(errors[0].label.includes('acme-*'), `the message must name the project's own prefix; got ${errors[0].label}`);
});

test('future-state marker: with no tracker configured, a citation anchors the claim', () => {
  const body = '# Guide\n\nBrokered dispatch is staged/experimental.\n\nSee https://example.invalid/roadmap for status.\n';
  const { dir, full } = makeTempFile('docs/guides/concepts/fixture.md', body);
  assert.equal(futureStateErrors(dir, full).length, 0, 'a citation is a valid anchor when no tracker exists');
});

test('future-state marker: hyphenated prose is not mistaken for a work-item id', () => {
  const body = '# Guide\n\nThe end-to-end path is staged/experimental for now.\n';
  const { dir, full } = makeTempFile('docs/guides/concepts/fixture.md', body);
  assert.equal(futureStateErrors(dir, full).length, 1, 'ordinary hyphenated words must not read as a tracker id');
});

test('external reference: the linted project\'s own tracker prefix is banned too', () => {
  const body = [
    '/**',
    ' * lib/fixture.mjs — test.',
    ' */',
    '// the queue drains before the lease expires (acme-4821)',
    'export const x = 1;',
  ].join('\n');
  const { dir, full } = makeTempFile('lib/fixture.mjs', body);
  withTracker(dir, 'acme');
  const labels = lintFile(full, { rootDir: dir }).warnings.map((w) => w.label);
  assert.ok(labels.some((l) => l.includes('tracker id')), `a downstream tracker id must be flagged; got ${JSON.stringify(labels)}`);
});

test('external reference: a project-prefixed word without a work-item shape is not a tracker id', () => {
  const body = [
    '/**',
    ' * lib/fixture.mjs — test.',
    ' */',
    '// the acme-widget cache is invalidated on write',
    'export const x = 1;',
  ].join('\n');
  const { dir, full } = makeTempFile('lib/fixture.mjs', body);
  withTracker(dir, 'acme');
  const labels = lintFile(full, { rootDir: dir }).warnings.map((w) => w.label);
  assert.ok(!labels.some((l) => l.includes('tracker id')), `a hyphenated name is not an id; got ${JSON.stringify(labels)}`);
});

// --- external project name in a code comment ---
//
// Comparisons against other software projects belong in decision documents
// with citations, not in code narration describing what this codebase does.

test('external project name: flags a banned project name in a code comment', () => {
  const body = [
    '/**',
    ' * lib/fixture.mjs — test.',
    ' */',
    '// per the LangGraph thread-vs-store split, this module keeps a boundary',
    'export const x = 1;',
  ].join('\n');
  const { dir, full } = makeTempFile('lib/fixture.mjs', body);
  process.env.CONSTRUCT_ARTIFACT_LINT_MODE = 'block';
  try {
    const result = lintFile(full, { rootDir: dir });
    assert.ok(
      result.errors.some((e) => e.label.includes('external project name in a code comment')),
      `expected an external-project-name error; got ${JSON.stringify(result)}`,
    );
  } finally {
    delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  }
});

test('external project name: a comment describing behavior on its own terms passes', () => {
  const body = [
    '/**',
    ' * lib/fixture.mjs — test.',
    ' */',
    '// a record only reaches the shared store when it opts in explicitly',
    'export const x = 1;',
  ].join('\n');
  const { dir, full } = makeTempFile('lib/fixture.mjs', body);
  process.env.CONSTRUCT_ARTIFACT_LINT_MODE = 'block';
  try {
    const result = lintFile(full, { rootDir: dir });
    assert.ok(
      !result.errors.some((e) => e.label.includes('external project name in a code comment')),
      `plain behavior description should not trigger; got ${JSON.stringify(result)}`,
    );
  } finally {
    delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  }
});

test('external project name: docs/decisions/** is exempt (citations are required there)', () => {
  const body = [
    '/**',
    ' * docs/decisions/adr/fixture.mjs — test.',
    ' */',
    '// per the LangGraph thread-vs-store split, see ADR-0064 for the comparison',
    'export const x = 1;',
  ].join('\n');
  const { dir, full } = makeTempFile('docs/decisions/adr/fixture.mjs', body);
  process.env.CONSTRUCT_ARTIFACT_LINT_MODE = 'block';
  try {
    const result = lintFile(full, { rootDir: dir });
    assert.ok(
      !result.errors.some((e) => e.label.includes('external project name in a code comment')),
      `docs/decisions/** should be exempt; got ${JSON.stringify(result)}`,
    );
  } finally {
    delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  }
});

// External-reference bans. Each case is a single comment line inside an
// otherwise clean file, so any warning that comes back is attributable to it.

function warnsOn(commentLine) {
  const body = [
    '/**',
    ' * lib/fixture.mjs — test.',
    ' */',
    commentLine,
    'export const x = 1;',
  ].join('\n');
  const { dir, full } = makeTempFile('lib/fixture.mjs', body);
  return lintFile(full, { rootDir: dir }).warnings.map((w) => w.label);
}

test('external reference: bead id in a comment is flagged', () => {
  assert.ok(warnsOn('// the queue drains before the lease expires (construct-b0nny.25)').some((l) => l.includes('tracker id')));
});

test('external reference: program work-item ids are flagged', () => {
  assert.ok(warnsOn('// LMCP-A6: every approval-required call creates a durable record').some((l) => l.includes('tracker id')));
  assert.ok(warnsOn('// each remote fetch is bounded (ORCH-004)').some((l) => l.includes('tracker id')));
  assert.ok(warnsOn('// CX-AUDIT-LLMSEC-001 requires the wrapper to strip tool output').some((l) => l.includes('tracker id')));
});

test('external reference: a module name without a work-item shape is not a tracker id', () => {
  assert.equal(warnsOn('// construct-postinstall runs on the user machine, never in CI').length, 0);
});

test('external reference: decision-document ids are flagged', () => {
  assert.ok(warnsOn('// user-owned files are mutated only through replaceManagedBlock (ADR-0027 §2)').some((l) => l.includes('decision-document id')));
  assert.ok(warnsOn('// routing metadata carries the team id (RFC-0004 §2)').some((l) => l.includes('decision-document id')));
  assert.ok(warnsOn('// the acceptance criteria live in PRD-0002').some((l) => l.includes('decision-document id')));
});

test('external reference: a three-digit sample id in a format example is not a record id', () => {
  assert.equal(warnsOn(" *   - [x] Target resolver — PROJ-123 · ADR-005").length, 0);
  assert.equal(warnsOn(" * @property {string[]} docs - linked docs (e.g. 'ADR-005', 'PRD-012')").length, 0);
});

test('external reference: external standards are not decision documents', () => {
  assert.equal(warnsOn('// unfold continuation lines per RFC 5545 §3.1').length, 0);
  assert.equal(warnsOn('// time-ordered identity: UUIDv7, RFC 9562 §5.7').length, 0);
  assert.equal(warnsOn('// traceparent propagation follows SEP-414').length, 0);
});

test('external reference: a document citation is flagged, a path the code writes is not', () => {
  assert.ok(warnsOn('// the scope model is described in docs/guides/concepts/project-scopes.md').some((l) => l.includes('project document citation')));
  assert.equal(warnsOn('// regenerate the AUTO regions in README.md and docs/README.md').length, 0);
});

test('external reference: a URL on the line is not read as a comment leader', () => {
  const body = [
    '/**',
    ' * lib/fixture.mjs — test.',
    ' */',
    "export const src = 'https://example.com/docs (accessed 2026-06-22, per docs/usage.md)';",
  ].join('\n');
  const { dir, full } = makeTempFile('lib/fixture.mjs', body);
  assert.equal(lintFile(full, { rootDir: dir }).warnings.length, 0);
});

test('dated claim: a decision or observation stamped with a date is flagged', () => {
  assert.ok(warnsOn('// override semantics are full file replacement (decided 2026-05-14)').some((l) => l.includes('dated decision')));
  assert.ok(warnsOn('// no workflow uses that action as of 2026-07-16').some((l) => l.includes('dated decision')));
  assert.ok(warnsOn('// the 2026-05-13 UX audit covers these producers').some((l) => l.includes('dated decision')));
});

test('dated claim: a date used as a format example is not flagged', () => {
  assert.equal(warnsOn('// `2026-05-28.jsonl` splits into base=2026-05-28 and ext=.jsonl').length, 0);
});

test('@enforces marker alone on a line is machine-read metadata, not prose', () => {
  assert.equal(warnsOn(' * @enforces ADR-0015').length, 0);
  assert.equal(warnsOn('// @enforces construct-tsyfe.10.6').length, 0);
  assert.ok(warnsOn(' * @enforces ADR-0015 because the table shape is load-bearing').some((l) => l.includes('decision-document id')));
});

test('external reference: construct-lint-ignore suppresses the line', () => {
  assert.equal(warnsOn('// quoted commit subject: "fix the drain (construct-b0nny.25)" construct-lint-ignore').length, 0);
});
