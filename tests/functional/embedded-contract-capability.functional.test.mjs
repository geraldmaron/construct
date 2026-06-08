/**
 * tests/functional/embedded-contract-capability.functional.test.mjs
 *
 * Drives `construct capability describe --json` against the real binary and
 * asserts the versioned envelope, the presence of every section, and the
 * load-bearing guarantee that a credential in the environment never appears in
 * the discovery output.
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
function freshCwd() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-ecl-cap-'));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
});

test('capability describe --json returns a complete versioned contract', () => {
  const res = spawnSync('node', [BIN, 'capability', 'describe', '--json'], { cwd: freshCwd(), encoding: 'utf8', timeout: 30_000 });
  assert.equal(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
  const env = JSON.parse(res.stdout);
  assert.equal(env.surface, 'cli');
  assert.match(env.contractVersion, /^\d+\.\d+\.\d+$/);
  assert.ok(env.data.roles.length >= 28);
  assert.ok(env.data.workflows.length >= 6, `expected at least the base workflow set, got ${env.data.workflows.length}`);
  assert.ok(env.data.skills.length > 0);
  assert.ok(env.data.policies.length > 0);
});

test('a credential in the environment never leaks into the capability contract', () => {
  const res = spawnSync('node', [BIN, 'capability', 'describe', '--json'], {
    cwd: freshCwd(),
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, OPENAI_API_KEY: 'cred-canary-capability-fn-0001' },
  });
  assert.equal(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
  assert.equal(res.stdout.includes('cred-canary-capability-fn-0001'), false, 'secret must not appear in output');
});
