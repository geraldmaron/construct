import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const lint = new URL('../../scripts/lint-docs-index.mjs', import.meta.url).pathname;
function fixture(guide: string, extra: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'construct-doc-links-'));
  const files = { 'docs/README.md': '[Guide](guide.md)', 'docs/guide.md': guide, ...extra };
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return { root, run: () => execFileSync(process.execPath, [lint], { cwd: root, encoding: 'utf8', stdio: 'pipe' }), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
test('docsite links resolve to real paths and GitHub heading anchors, including duplicate headings', () => {
  const f = fixture('# Guide\n## Use `it`\n## Use `it`\n[Again](#use-it-1)\n[Root](../README.md#hello-world)\n', { 'README.md': '# Hello world\n[Guide](docs/guide.md#use-it)' });
  try { assert.match(f.run(), /local links checked/); } finally { f.cleanup(); }
});
test('a missing public documentation target fails even when the index is complete', () => {
  const f = fixture('[Missing](removed.md)');
  try { assert.throws(f.run, /names no repository path/); } finally { f.cleanup(); }
});
test('a stale heading anchor fails instead of silently linking to the top of a page', () => {
  const f = fixture('# Guide\n[Stale](#old-section)');
  try { assert.throws(f.run, /names no heading anchor/); } finally { f.cleanup(); }
});
test('code examples and historical records are not recursively treated as current documentation', () => {
  const f = fixture('```md\n[Example](missing.md)\n```\n[History](internal/record.md)', { 'docs/internal/record.md': '# History\n[Old](missing.md)' });
  try { assert.match(f.run(), /clean/); } finally { f.cleanup(); }
});
test('reference links and method-resource links are checked outside the top-level guide index', () => {
  const f = fixture('# Guide', { 'skills/method/SKILL.md': '[Resource][r]\n\n[r]: references/removed.md' });
  try { assert.throws(f.run, /names no repository path/); } finally { f.cleanup(); }
});
