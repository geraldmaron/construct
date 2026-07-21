/**
 * workspace-control-plane-nav.test.mjs — docs nav ratchet for the program archive.
 *
 * construct-ok0oo: synthesis must sit in the meta.json nav tree; spike-b worker
 * artifacts must stay link-reachable from synthesis pages; postgres-store stays
 * off the deadcode finding set via ACCEPTED_TEST_ONLY (construct-jx21v).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { docsFindings } from '../../scripts/audit/03-docs.mjs';
import { deadcodeFindings } from '../../scripts/audit/02-deadcode.mjs';
import { makeId } from '../../scripts/audit/lib/findings.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

const CLEARED_IDS = [
  '03-docs:unnavigated-doc-dir:docs/notes/research/workspace-control-plane/synthesis',
  '03-docs:unnavigated-doc-dir:docs/notes/research/workspace-control-plane/spikes/b-parallel-research/workers',
  '02-deadcode:module-test-only:lib/graph/relational/postgres-store.mjs',
];

test('workspace control plane synthesis is registered in docs nav', () => {
  const metaPath = path.join(REPO, 'docs/notes/research/workspace-control-plane/synthesis/meta.json');
  assert.ok(fs.existsSync(metaPath), 'synthesis/meta.json must exist');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  assert.ok(Array.isArray(meta.pages) && meta.pages.length > 0, 'synthesis meta must list pages');
  assert.ok(meta.pages.includes('spike-b-parallel-research'), 'spike-b synthesis page must be navigable');
});

test('construct-ok0oo alignment regressions stay cleared', () => {
  const current = [
    ...docsFindings().map((r) => makeId('03-docs', r.type, r.target)),
    ...deadcodeFindings().map((r) => makeId('02-deadcode', r.type, r.target)),
  ];
  for (const id of CLEARED_IDS) {
    assert.ok(!current.includes(id), `${id} must not regress`);
  }
});
