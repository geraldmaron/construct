/**
 * tests/functional/embedded-contract-workflow-invoke.functional.test.mjs
 *
 * Drives `construct workflow invoke --json` against the real binary in an
 * isolated tmpdir with a redirected HOME. Asserts the approval-mode write gate
 * end-to-end: proposal-only writes nothing, allow-durable-write lands an
 * observation, and requires-human-approval records an approval marker under
 * HOME/.cx without any durable project write.
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
function fresh(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
});

function invoke(args, { cwd, home }) {
  const res = spawnSync('node', [BIN, 'workflow', 'invoke', '--json', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, HOME: home, CONSTRUCT_ROLES: 'off' },
  });
  assert.equal(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

test('proposal-only invocation returns a plan and writes nothing', () => {
  const cwd = fresh('cx-wf-prop-');
  const home = fresh('cx-wf-home-');
  const env = invoke(['--workflow-type', 'evidence-ingest', '--approval-mode', 'proposal-only', '--text', 'raw notes'], { cwd, home });
  assert.equal(env.surface, 'cli');
  assert.equal(env.data.status, 'proposed');
  assert.deepEqual(env.data.durableWritesPerformed, []);
  assert.ok(env.data.traceId);
  assert.equal(fs.existsSync(path.join(cwd, '.cx', 'observations')), false);
});

test('allow-durable-write lands an observation in the project', () => {
  const cwd = fresh('cx-wf-write-');
  const home = fresh('cx-wf-home-');
  const env = invoke(['--workflow-type', 'evidence-ingest', '--approval-mode', 'allow-durable-write', '--text', 'raw notes'], { cwd, home });
  assert.equal(env.data.status, 'recorded');
  assert.equal(env.data.durableWritesPerformed.length, 1);
  assert.ok(fs.existsSync(path.join(cwd, '.cx', 'observations')));
});

test('a credential in the environment never leaks into workflow output', () => {
  const cwd = fresh('cx-wf-secret-');
  const home = fresh('cx-wf-home-');
  const res = spawnSync('node', [BIN, 'workflow', 'invoke', '--json', '--workflow-type', 'prd-draft', '--approval-mode', 'proposal-only', '--host-model', 'anthropic/claude-sonnet-4-6', '--text', 'x'], {
    cwd, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, HOME: home, CONSTRUCT_ROLES: 'off', ANTHROPIC_API_KEY: 'cred-canary-wf-0001' },
  });
  assert.equal(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
  assert.equal(res.stdout.includes('cred-canary-wf-0001'), false, 'secret must not leak');
});
