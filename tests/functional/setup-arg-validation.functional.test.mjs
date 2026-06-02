/**
 * tests/functional/setup-arg-validation.functional.test.mjs
 *
 * `construct install` must reject an unknown flag loudly and exit non-zero
 * BEFORE doing any machine setup, so a typo (e.g. --reconfig) fails fast
 * instead of silently running defaults or half-configuring the machine.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '..', '..', 'bin', 'construct');

const tmpDirs = [];
function freshHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-setup-arg-'));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

test('install rejects an unknown flag with exit 1 and no machine setup', () => {
  const home = freshHome();
  const res = spawnSync('node', [BIN, 'install', '--reconfig'], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, HOME: home },
  });
  assert.equal(res.status, 1, `expected exit 1, got ${res.status} — stderr: ${res.stderr}`);
  assert.match(`${res.stdout}${res.stderr}`, /Unknown flag/i);
  assert.equal(fs.existsSync(path.join(home, '.construct', 'config.env')), false, 'must not write config before validating flags');
});
