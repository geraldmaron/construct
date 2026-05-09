/**
 * beads-client.test.mjs — Beads wrapper process safety.
 *
 * Covers timeout behavior for bd children launched through Construct.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runBd } from '../lib/beads-client.mjs';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('runBd times out long-running bd children and releases construct lock', async () => {
  const cwd = tempDir('construct-beads-client-');
  const binDir = tempDir('construct-beads-bin-');
  fs.mkdirSync(path.join(cwd, '.beads', 'embeddeddolt'), { recursive: true });

  const fakeBd = path.join(binDir, 'bd');
  fs.writeFileSync(fakeBd, [
    '#!/usr/bin/env node',
    'setTimeout(() => {}, 1000);',
    '',
  ].join('\n'), 'utf8');
  fs.chmodSync(fakeBd, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath || ''}`;

  try {
    const result = await runBd(['ready'], {
      actor: 'test',
      cwd,
      commandTimeoutSeconds: 0.05,
      silent: true,
    });

    assert.equal(result.success, false);
    assert.match(result.error, /timed out after 0\.05s/);
    assert.equal(fs.existsSync(path.join(cwd, '.beads', 'embeddeddolt', '.lock-meta.json')), false);
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  }
});
