/**
 * tests/functional/docs-site-check.functional.test.mjs — Generated reference drift gate.
 *
 * Asserts construct docs:site --check passes so docs/reference/ stays aligned
 * with lib/cli-commands.mjs, lib/hooks/, and specialists/registry.json.
 */

import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

test('release gate: construct docs:site --check reports no drift', () => {
  const result = spawnSync(process.execPath, [BIN, 'docs:site', '--check'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  });
  assert.equal(result.status, 0, `docs:site --check exited ${result.status}; stdout: ${result.stdout}`);
});
