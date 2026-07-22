/**
 * workspace-control-plane-nav.test.mjs — archive + deadcode ratchet after quarantine.
 *
 * construct-ok0oo / construct-d23f3: WCP research lives under docs/obsolete/ and must
 * stay outside live guides nav; postgres-store stays off the deadcode finding set via
 * ACCEPTED_TEST_ONLY (construct-jx21v).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { docsFindings } from '../../scripts/audit/03-docs.mjs';
import { deadcodeFindings } from '../../scripts/audit/02-deadcode.mjs';
import { makeId } from '../../scripts/audit/lib/findings.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

const ARCHIVE_ROOT = 'docs/obsolete/research/workspace-control-plane';
const SYNTHESIS_META = path.join(REPO, ARCHIVE_ROOT, 'synthesis/meta.json');

const CLEARED_IDS = [
  `03-docs:unnavigated-doc-dir:${ARCHIVE_ROOT}/synthesis`,
  `03-docs:unnavigated-doc-dir:${ARCHIVE_ROOT}`,
  `03-docs:unnavigated-doc-dir:${ARCHIVE_ROOT}/spikes/b-parallel-research/worker`,
  '02-deadcode:module-test-only:lib/graph/relational/postgres-store.mjs',
];

test('workspace control plane archive keeps synthesis meta under obsolete/', () => {
  assert.ok(fs.existsSync(SYNTHESIS_META), `${ARCHIVE_ROOT}/synthesis/meta.json must exist`);
  const meta = JSON.parse(fs.readFileSync(SYNTHESIS_META, 'utf8'));
  assert.ok(Array.isArray(meta.pages) && meta.pages.length > 0, 'synthesis meta must list pages');
  assert.ok(meta.pages.includes('spike-b-parallel-research'), 'spike-b synthesis page must remain listed');
  assert.equal(
    fs.existsSync(path.join(REPO, 'docs/notes/research/workspace-control-plane')),
    false,
    'live docs/notes path must stay removed after quarantine',
  );
});

test('construct-ok0oo alignment regressions stay cleared after obsolete quarantine', () => {
  const current = [
    ...docsFindings().map((r) => makeId('03-docs', r.type, r.target)),
    ...deadcodeFindings().map((r) => makeId('02-deadcode', r.type, r.target)),
  ];
  for (const id of CLEARED_IDS) {
    assert.ok(!current.includes(id), `${id} must not regress`);
  }
});
