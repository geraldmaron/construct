/**
 * tests/functional/self-hosting-cert.functional.test.mjs
 *
 * Self-hosting certification check (construct-rr63.11): asserts that a Construct-on-Construct run
 * leaves its durable, navigable evidence — the baseline, the four-plus synthesis documents, the ten
 * subagent evidence reports, and the meta.json navigation that keeps them reachable. Closes the
 * "self-hosting: 0 tests" gap Agent J flagged; the standing proof of the run's correctness is the
 * green release gate itself, which this complements rather than replaces.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = path.join(repoRoot, 'docs/notes/research/construct-self-audit');
const exists = (rel) => fs.existsSync(path.join(root, rel));

test('the self-audit baseline and synthesis artifacts exist', () => {
  assert.ok(exists('baseline.md'), 'baseline captured');
  for (const doc of ['consolidated-findings', 'risk-register', 'execution-matrix', 'final-bead-tree', 'self-hosting-certification', 'best-practice-alignment']) {
    assert.ok(exists(`synthesis/${doc}.md`), `synthesis/${doc}.md exists`);
  }
});

test('all ten subagent evidence reports are present', () => {
  const reports = ['adr-drift', 'registry-hardcoding', 'host-parity', 'mcp-tools', 'research-search', 'install-init-sync-upgrade', 'orchestration-truth', 'document-intelligence', 'learning-loops', 'test-coverage'];
  for (const r of reports) {
    assert.ok(exists(`subagents/${r}.md`), `subagents/${r}.md exists`);
  }
});

test('the audit workspace is navigable (meta.json at each level)', () => {
  for (const dir of ['', 'subagents', 'synthesis']) {
    const metaPath = path.join(root, dir, 'meta.json');
    assert.ok(fs.existsSync(metaPath), `${dir || '.'}/meta.json exists`);
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    assert.ok(Array.isArray(meta.pages) && meta.pages.length > 0, `${dir || '.'}/meta.json lists pages`);
  }
});
