/**
 * tests/functional/doc-intake-approval.functional.test.mjs
 *
 * Characterization tests for the document-intake approval gap (self-audit construct-rr63.8.1, under
 * the migration-gate / risk R9 — silent restructuring of user docs). The intake promotion path
 * (lib/embed/inbox.mjs:276 + :440) calls maybePromoteToDocs unconditionally: when
 * suggestDocsLaneForFile returns a real lane (anything but `intake`) and the lane dir exists, the
 * document is written into that docs lane with NO approval gate and NO confidence signal. The
 * routing-only tests below pin that the routing decision feeding promotion is a bare lane with no
 * approval/confidence metadata and that ADR/PRD/RFC content auto-routes to a promotable lane. The
 * end-to-end test drives InboxWatcher.poll() over a real inbox fixture, exercising maybePromoteToDocs
 * itself at its call site (inbox.mjs:440) and asserting the promoted file lands on disk unreviewed —
 * a durable artifact, not just a routing return value — so the Wave-4 change that adds an
 * `approvalRequired` gate before any user-doc-affecting write is deliberate and visible. The
 * alias-collision half of this epic (incidents/ + postmortems/) is pinned in
 * tests/registry-characterization.test.mjs.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { suggestDocsLaneForFile } from '../../lib/docs-routing.mjs';
import { LANE_ORDER } from '../../lib/init/doc-lanes.mjs';
import { InboxWatcher } from '../../lib/embed/inbox.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const FIXTURES = {
  adr: ['decisions/adr-auth.md', '# ADR: Auth\n## Status\nproposed\n## Decision\nWe will adopt OIDC.'],
  prd: ['product/prd-checkout.md', '# PRD: Checkout\n## Problem\n## Requirements\n## Success metrics'],
  rfc: ['rfcs/rfc-api.md', '# RFC: API\n## Motivation\n## Proposal'],
  generic: ['scratch/notes.txt', 'just some scratch notes about nothing in particular'],
};

const tmpDirs = [];

after(() => {
  for (const dir of tmpDirs) rmTmpDir(dir);
});

// InboxWatcher.poll() resolves its state file through the machine-scoped
// state root (ADR-0066), which reads CONSTRUCT_HOME_OVERRIDE from real process.env
// directly, not any constructor `env` options bag. Pin it for the whole file
// so polling never writes into the real developer machine's
// ~/.construct/projects/.

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-doc-intake-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
after(() => {
  try { rmTmpDir(homeOverride); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

test('ADR/PRD/RFC intake content auto-routes to a promotable lane (would promote with no approval)', () => {
  for (const key of ['adr', 'prd', 'rfc']) {
    const lane = suggestDocsLaneForFile(...FIXTURES[key]);
    assert.equal(typeof lane, 'string', `${key} routes to a lane`);
    assert.notEqual(lane, 'intake', `${key} is not held in intake — maybePromoteToDocs would write it`);
    assert.ok(LANE_ORDER.includes(lane), `${key} routes to a real docs lane (${lane})`);
  }
});

test('the routing decision carries no approval or confidence signal today', () => {
  for (const [key, args] of Object.entries(FIXTURES)) {
    const result = suggestDocsLaneForFile(...args);
    assert.ok(result === null || typeof result === 'string', `${key} routing is a bare lane or null`);
    assert.notEqual(typeof result, 'object', `${key} routing exposes no { approvalRequired, confidence } object`);
  }
});

test('even generic content auto-routes — there is no hold-for-human-decision outcome', () => {
  const lane = suggestDocsLaneForFile(...FIXTURES.generic);
  assert.equal(typeof lane, 'string', 'generic content still resolves to a lane');
  assert.ok(LANE_ORDER.includes(lane) || lane === 'intake', 'routing never returns an explicit approval-needed state');
});

test('end-to-end: InboxWatcher.poll() promotes a dropped ADR into docs/adr with no approval gate', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-shtp-'));
  tmpDirs.push(project);
  fs.mkdirSync(path.join(project, 'inbox'), { recursive: true });
  fs.mkdirSync(path.join(project, 'docs', 'adr'), { recursive: true });
  const [, adrContent] = FIXTURES.adr;
  fs.writeFileSync(path.join(project, 'inbox', 'adr-auth.md'), adrContent, 'utf8');

  const watcher = new InboxWatcher({
    rootDir: project,
    cwd: project,
    env: { ...process.env, HOME: project, CONSTRUCT_EMBEDDING_MODEL: 'hashing' },
  });
  const result = await watcher.poll();

  assert.equal(result.errors?.length ?? 0, 0, `unexpected errors: ${JSON.stringify(result.errors)}`);
  assert.equal(result.processed.length, 1, 'the dropped ADR was ingested');

  const { docsPath } = result.processed[0];
  assert.ok(docsPath, 'maybePromoteToDocs (inbox.mjs:440) promoted the file with no approval step');
  assert.equal(path.dirname(docsPath), path.join(project, 'docs', 'adr'), 'promoted straight into the adrs lane dir');
  assert.ok(fs.existsSync(docsPath), 'the promotion is a durable artifact on disk, not just a return value');

  const written = fs.readFileSync(docsPath, 'utf8');
  assert.match(written, /Promoted from intake for review/, 'lands unreviewed — no approvalRequired gate exists yet (inbox.mjs:274-276)');
  assert.match(written, /We will adopt OIDC/, 'original ADR content is carried through verbatim');
});
