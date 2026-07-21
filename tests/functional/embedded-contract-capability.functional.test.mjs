/**
 * tests/functional/embedded-contract-capability.functional.test.mjs
 *
 * Drives canonical `construct capability list|show` discovery against the real
 * binary. Asserts list/show parity for a known record and the load-bearing
 * guarantee that credentials never appear in discovery output.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

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
    try { rmTmpDir(dir); } catch {}
  }
});

test('capability list and show expose the same canonical registry record', () => {
  const cwd = freshCwd();
  const list = spawnSync('node', [BIN, 'capability', 'list', '--json'], { cwd, encoding: 'utf8', timeout: 30_000 });
  assert.equal(list.status, 0, `list exits 0 — stderr: ${list.stderr}`);
  const records = JSON.parse(list.stdout);
  assert.ok(Array.isArray(records));
  assert.ok(records.length > 0);

  const listed = records.find((record) => record.id === 'orchestration.routing');
  assert.ok(listed, 'canonical orchestration capability is listed');
  assert.equal(listed.state, 'active');
  assert.ok(listed.ownerWorkerProfiles.includes('orchestrator'));

  const show = spawnSync('node', [BIN, 'capability', 'show', listed.id, '--json'], { cwd, encoding: 'utf8', timeout: 30_000 });
  assert.equal(show.status, 0, `show exits 0 — stderr: ${show.stderr}`);
  assert.deepEqual(JSON.parse(show.stdout), listed);
});

test('a credential in the environment never leaks from capability list or show', () => {
  const env = { ...process.env, OPENAI_API_KEY: 'cred-canary-capability-fn-0001' };
  const cwd = freshCwd();
  for (const args of [['list', '--json'], ['show', 'orchestration.routing', '--json']]) {
    const res = spawnSync('node', [BIN, 'capability', ...args], { cwd, encoding: 'utf8', timeout: 30_000, env });
    assert.equal(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assert.equal(res.stdout.includes(env.OPENAI_API_KEY), false, 'secret must not appear in output');
  }
});
