/**
 * tests/functional/docs-redirect-stubs.functional.test.mjs — legacy URL redirects.
 *
 * The docs site is a static Next export, so pre-taxonomy bookmarks (`/cookbook/*`,
 * `/adr/*`, …) can only be salvaged by stub HTML written into `out/`. This drives
 * the real generator (apps/docs/scripts/gen-redirect-stubs.mjs) over a synthetic
 * `out/` tree and asserts: representative stubs exist at the OLD path, each
 * meta-refreshes and canonicalizes to the correct NEW trailing-slash URL, basePath
 * is honored, and a legacy path that collides with a real exported page is left
 * untouched.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const GENERATOR = path.join(REPO, 'apps', 'docs', 'scripts', 'gen-redirect-stubs.mjs');

function writePage(outDir, slug) {
  const dir = path.join(outDir, ...slug.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), `<html><body>${slug}</body></html>`, 'utf8');
}

function readStub(outDir, oldSlug) {
  return fs.readFileSync(path.join(outDir, ...oldSlug.split('/'), 'index.html'), 'utf8');
}

// Synthetic export tree: one page per moved bucket, a non-moved operations page
// that must never get a stub, and a real legacy page that the generator must not
// clobber.

function buildFixtureOut() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-redirect-'));
  writePage(outDir, 'guides/cookbook/add-a-custom-agent');
  writePage(outDir, 'guides/concepts/architecture');
  writePage(outDir, 'guides/reference/cli/core');
  writePage(outDir, 'decisions/adr/0001-zero-npm-core');
  writePage(outDir, 'operations/maintenance/release-policy');
  writePage(outDir, 'operations/deploy/aws');
  writePage(outDir, 'operations/backup-restore');
  return outDir;
}

test('redirect stubs: representative legacy paths meta-refresh to new URLs', async (t) => {
  delete process.env.DOCS_BASE_PATH;
  const { generateRedirectStubs } = await import(GENERATOR);
  const outDir = buildFixtureOut();
  t.after(() => rmTmpDir(outDir));

  const written = generateRedirectStubs(outDir);
  assert.ok(written >= 6, `expected at least 6 stubs, wrote ${written}`);

  const cookbook = readStub(outDir, 'cookbook/add-a-custom-agent');
  assert.match(cookbook, /<meta http-equiv="refresh" content="0; url=\/guides\/cookbook\/add-a-custom-agent\/">/);
  assert.match(cookbook, /<link rel="canonical" href="\/guides\/cookbook\/add-a-custom-agent\/">/);
  assert.match(cookbook, /location\.replace\("\/guides\/cookbook\/add-a-custom-agent\/"\)/);
  assert.match(cookbook, /<a href="\/guides\/cookbook\/add-a-custom-agent\/">/);

  assert.match(
    readStub(outDir, 'adr/0001-zero-npm-core'),
    /content="0; url=\/decisions\/adr\/0001-zero-npm-core\/"/,
  );
  assert.match(
    readStub(outDir, 'concepts/architecture'),
    /content="0; url=\/guides\/concepts\/architecture\/"/,
  );
  assert.match(
    readStub(outDir, 'maintenance/release-policy'),
    /content="0; url=\/operations\/maintenance\/release-policy\/"/,
  );
  assert.match(
    readStub(outDir, 'deploy/aws'),
    /content="0; url=\/operations\/deploy\/aws\/"/,
  );
});

test('redirect stubs: nested lane paths keep their sub-segments', async (t) => {
  delete process.env.DOCS_BASE_PATH;
  const { generateRedirectStubs } = await import(GENERATOR);
  const outDir = buildFixtureOut();
  t.after(() => rmTmpDir(outDir));

  generateRedirectStubs(outDir);
  assert.match(
    readStub(outDir, 'reference/cli/core'),
    /content="0; url=\/guides\/reference\/cli\/core\/"/,
  );
});

test('redirect stubs: non-moved operations pages get no stub', async (t) => {
  delete process.env.DOCS_BASE_PATH;
  const { generateRedirectStubs } = await import(GENERATOR);
  const outDir = buildFixtureOut();
  t.after(() => rmTmpDir(outDir));

  generateRedirectStubs(outDir);
  const stray = path.join(outDir, 'backup-restore', 'index.html');
  assert.equal(fs.existsSync(stray), false, 'page that never moved must not get a legacy stub');
});

test('redirect stubs: a real legacy page is never overwritten', async (t) => {
  delete process.env.DOCS_BASE_PATH;
  const { generateRedirectStubs } = await import(GENERATOR);
  const outDir = buildFixtureOut();
  t.after(() => rmTmpDir(outDir));

  const realLegacy = path.join(outDir, 'cookbook', 'add-a-custom-agent');
  fs.mkdirSync(realLegacy, { recursive: true });
  const sentinel = '<html><body>REAL LEGACY PAGE</body></html>';
  fs.writeFileSync(path.join(realLegacy, 'index.html'), sentinel, 'utf8');

  generateRedirectStubs(outDir);
  assert.equal(readStub(outDir, 'cookbook/add-a-custom-agent'), sentinel);
});

test('redirect stubs: NEW_URL honors DOCS_BASE_PATH', async (t) => {
  process.env.DOCS_BASE_PATH = '/docs';
  t.after(() => { delete process.env.DOCS_BASE_PATH; });
  const { generateRedirectStubs } = await import(GENERATOR);
  const outDir = buildFixtureOut();
  t.after(() => rmTmpDir(outDir));

  generateRedirectStubs(outDir);
  assert.match(
    readStub(outDir, 'cookbook/add-a-custom-agent'),
    /content="0; url=\/docs\/guides\/cookbook\/add-a-custom-agent\/"/,
  );
});
