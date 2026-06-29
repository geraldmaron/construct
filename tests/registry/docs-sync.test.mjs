/**
 * tests/registry/docs-sync.test.mjs — Catalog-driven docs AUTO region sync.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { syncCatalogDocs } from '../../lib/registry/docs-sync.mjs';

test('syncCatalogDocs regenerates catalog-sync without dashboard references', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-sync-'));
  t.after(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  fs.cpSync(path.join(process.cwd(), 'registry'), path.join(tmp, 'registry'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'docs'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'docs', 'README.md'),
    '# docs\n\n<!-- AUTO:catalog-sync -->\n<!-- /AUTO:catalog-sync -->\n',
    'utf8',
  );

  const result = syncCatalogDocs({ rootDir: tmp });
  assert.equal(result.ok, true);
  const body = fs.readFileSync(path.join(tmp, 'docs', 'README.md'), 'utf8');
  assert.match(body, /Capability catalog \(generated\)/);
  assert.ok(!/dashboard/i.test(body), 'generated region must not reference dashboard');
});
