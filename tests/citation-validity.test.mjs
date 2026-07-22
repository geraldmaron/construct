/**
 * tests/citation-validity.test.mjs — citation resolution, not just marker presence.
 *
 * @enforces rule:common/no-fabrication
 *
 * Closes ADR-0015 gap 1 / bead construct-wvbf.6: a marker near a claim must
 * resolve, not merely exist. These pin that a footnote reference without a
 * definition, and a [source: repo/path] pointing at a missing file, are
 * flagged — while URLs and free-text sources are left alone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { findDanglingCitations, lintFile } from '../lib/comment-lint.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('a footnote reference with a matching definition is clean', () => {
  const md = 'Claim about scale.[^1]\n\n[^1]: Internal load test, 2026-05.\n';
  assert.equal(findDanglingCitations(md, { rootDir: REPO }).length, 0);
});

test('a footnote reference without a definition is dangling', () => {
  const md = 'Claim about scale.[^9]\n';
  const v = findDanglingCitations(md, { rootDir: REPO });
  assert.ok(v.some((x) => /dangling footnote/.test(x.label)));
});

test('a [source: repo-path] that exists is clean', () => {
  const md = 'See the decision. [source: docs/decisions/adr/0015-affirm-hybrid-architecture.md]\n';
  assert.equal(findDanglingCitations(md, { rootDir: REPO }).length, 0);
});

test('a [source: repo-path] that does not exist is flagged', () => {
  const md = 'Per the study. [source: docs/notes/research/does-not-exist.md]\n';
  const v = findDanglingCitations(md, { rootDir: REPO });
  assert.ok(v.some((x) => /source path not found/.test(x.label)));
});

test('URLs and free-text sources are not flagged', () => {
  const md = 'A. [source: https://example.com/report]\nB. [source: internal user interviews]\n';
  assert.equal(findDanglingCitations(md, { rootDir: REPO }).length, 0);
});

test('citations inside code fences are ignored', () => {
  const md = '```\nconst re = /\\[\\^\\d+\\]/; // [^99]\n```\n';
  assert.equal(findDanglingCitations(md, { rootDir: REPO }).length, 0);
});

test('a regex character class in a non-markdown file under an artifact path is not a dangling citation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-cite-'));
  try {
    mkdirSync(join(dir, 'docs', 'notes', 'research'), { recursive: true });
    const f = join(dir, 'docs', 'notes', 'research', 'harness.mjs');
    writeFileSync(f, "/**\n * harness.mjs\n */\nconst RE = /^[^@/]+@[^:]+:(.+?)$/;\n");
    const { errors, warnings } = lintFile(f, { rootDir: dir });
    assert.ok(!errors.some((e) => /dangling footnote/.test(e.label)));
    assert.ok(!warnings.some((w) => /dangling footnote/.test(w.label)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('lintFile routes dangling citations to errors in block mode for artifact paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-cite-'));
  const prev = process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
  try {
    mkdirSync(join(dir, 'docs', 'research'), { recursive: true });
    const f = join(dir, 'docs', 'research', 'note.md');
    writeFileSync(f, '<!--\ndocs/notes/research/note.md — test note.\n\nA test research note.\n-->\n\n# Note\n\nFinding.[^7]\n');
    process.env.CONSTRUCT_ARTIFACT_LINT_MODE = 'block';
    const { errors } = lintFile(f, { rootDir: dir });
    assert.ok(errors.some((e) => /dangling footnote/.test(e.label)), 'dangling footnote is a blocking error');
  } finally {
    if (prev === undefined) delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
    else process.env.CONSTRUCT_ARTIFACT_LINT_MODE = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
