/**
 * tests/functional/protocol-surface-rollup.functional.test.mjs
 *
 * construct-tsyfe.9.7: release-blocking packed-artifact rollup. Passes against
 * current HEAD and detects injected deprecated-surface regressions.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runProtocolSurfaceRollup,
  packedFileSet,
} from '../../lib/certification/protocol-surface-rollup.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('protocol surface rollup passes on current HEAD pack list', () => {
  const report = runProtocolSurfaceRollup({ rootDir: REPO });
  assert.equal(report.ok, true, report.errors.join('; '));
  assert.ok(report.checks.length >= 4);
  assert.ok(report.packedFileCount > 100);
});

test('protocol surface rollup fails when ./lib/* wildcard is reintroduced', () => {
  const exportsMap = {
    '.': './lib/embedded-contract/index.mjs',
    './embedded-contract': './lib/embedded-contract/index.mjs',
    './lib/*': './lib/*',
  };
  const report = runProtocolSurfaceRollup({
    rootDir: REPO,
    exportsMap,
    skipPackedPaths: true,
  });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.includes('./lib/*')));
});

test('protocol surface rollup fails when retired CLI surface appears in help corpus', () => {
  const report = runProtocolSurfaceRollup({
    rootDir: REPO,
    helpCorpus: 'Usage: construct matrix build\n',
    skipPackedPaths: true,
  });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.includes('retired CLI')));
});

test('protocol surface rollup fails when a required protocol module is missing from pack', () => {
  const files = packedFileSet({ cwd: REPO });
  files.delete('lib/acp/server.mjs');
  const report = runProtocolSurfaceRollup({
    rootDir: REPO,
    packedFiles: files,
  });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.includes('lib/acp/server.mjs')));
});
