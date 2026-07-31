/**
 * tests/functional/self-hosting-cert.functional.test.mjs
 *
 * Intentional anti-deletion tripwire, not a code-behavior test: this file never imports a
 * lib/*.mjs module and never spawns a binary. It only checks fs.existsSync/readFileSync
 * against fixed paths under docs/notes/research/construct-self-audit (baseline.md, the six
 * synthesis/*.md docs, the ten subagents/*.md reports, and meta.json at each level), so that
 * those one-time audit deliverables cannot be silently deleted or moved.
 * No code in lib/, bin/, or scripts/ reads or regenerates this content — do not treat a
 * failure here as a regression in production behavior, and do not remove this file without
 * maintainer sign-off.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = path.join(repoRoot, 'docs/notes/research/construct-self-audit');
const exists = (rel) => fs.existsSync(path.join(root, rel));

test('the self-audit baseline and synthesis artifacts exist', (t) => {
  if (!exists('baseline.md')) {
    return t.skip('construct-self-audit workspace not present on this branch');
  }
  assert.ok(exists('baseline.md'), 'baseline captured');
  for (const doc of ['consolidated-findings', 'risk-register', 'execution-matrix', 'final-bead-tree', 'self-hosting-certification', 'best-practice-alignment']) {
    assert.ok(exists(`synthesis/${doc}.md`), `synthesis/${doc}.md exists`);
  }
});

test('all ten subagent evidence reports are present', (t) => {
  if (!exists('subagents/adr-drift.md')) {
    return t.skip('construct-self-audit workspace not present on this branch');
  }
  const reports = ['adr-drift', 'registry-hardcoding', 'host-parity', 'mcp-tools', 'research-search', 'install-init-sync-upgrade', 'orchestration-truth', 'document-intelligence', 'learning-loops', 'test-coverage'];
  for (const r of reports) {
    assert.ok(exists(`subagents/${r}.md`), `subagents/${r}.md exists`);
  }
});

test('the audit workspace is navigable (meta.json at each level)', (t) => {
  if (!exists('meta.json')) {
    return t.skip('construct-self-audit workspace not present on this branch');
  }
  for (const dir of ['', 'subagents', 'synthesis']) {
    const metaPath = path.join(root, dir, 'meta.json');
    assert.ok(fs.existsSync(metaPath), `${dir || '.'}/meta.json exists`);
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    assert.ok(Array.isArray(meta.pages) && meta.pages.length > 0, `${dir || '.'}/meta.json lists pages`);
  }
});
