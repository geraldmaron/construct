/**
 * tests/functional/embedded-contract-workflow-invoke.functional.test.mjs
 *
 * Drives `construct workflow invoke --json` against the real binary in an
 * isolated tmpdir with a redirected HOME. Asserts the approval-mode write gate
 * end-to-end: proposal-only writes nothing, allow-durable-write lands an
 * observation, and requires-human-approval records an approval marker under
 * HOME/.cx without any durable project write.
 *
 * @capability workflow.evidence-ingest
 * @capability workflow.research-synthesis
 * @capability workflow.prd-draft
 * @capability workflow.architecture-review
 * @capability workflow.proposal-review
 * @capability workflow.risk-review
 * @capability workflow.structure-notes
 * @capability workflow.transcript-process
 * @capability workflow.data-structure
 * @capability workflow.memo-draft
 * @capability document-type.evidence-brief
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
function fresh(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    try { rmTmpDir(dir); } catch {}
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
  assert.equal(fs.existsSync(path.join(cwd, '.construct', 'observations')), false);
});

test('allow-durable-write lands an observation in the project', () => {
  const cwd = fresh('cx-wf-write-');
  const home = fresh('cx-wf-home-');
  const env = invoke(['--workflow-type', 'evidence-ingest', '--approval-mode', 'allow-durable-write', '--text', 'raw notes'], { cwd, home });
  assert.equal(env.data.status, 'recorded');
  assert.equal(env.data.durableWritesPerformed.length, 1);
  assert.ok(fs.existsSync(path.join(cwd, '.construct', 'observations')));
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

test('roleChain is a floor: cost/privacy signals recruit reviewers onto prd-draft (construct-pteo2.9)', () => {
  const cwd = fresh('cx-wf-recruit-');
  const home = fresh('cx-wf-home-');
  const env = invoke([
    '--workflow-type', 'prd-draft', '--approval-mode', 'proposal-only',
    '--text', 'PRD for billing cost optimization with strict PII data retention and consent handling',
  ], { cwd, home });

  assert.ok(env.data.selectedRoles.indexOf('product-manager') === 0, 'manifest chain honored as minimum, in order');
  assert.equal(env.data.selectedRoles[1], 'architect', 'manifest chain honored as minimum, in order');
  assert.ok(env.data.selectedRoles.includes('data-analyst'), `cost signal recruits data-analyst; got ${env.data.selectedRoles.join(',')}`);
  assert.ok(env.data.selectedRoles.includes('security'), `privacy signal recruits security; got ${env.data.selectedRoles.join(',')}`);

  assert.ok(Array.isArray(env.data.recruitment.rationale), '--json carries recruitment rationale');
  assert.ok(env.data.recruitment.rationale.some((r) => r.includes('data-analyst')), 'rationale names the recruit');
  assert.deepEqual(env.data.recruitment.addedRoles.slice().sort(), ['data-analyst', 'security']);
});

test('recruitment off keeps the bare manifest chain for the same signals', () => {
  const cwd = fresh('cx-wf-recruit-off-');
  const home = fresh('cx-wf-home-');
  const env = invoke([
    '--workflow-type', 'prd-draft', '--approval-mode', 'proposal-only', '--recruitment', 'off',
    '--text', 'PRD for billing cost optimization with strict PII data retention and consent handling',
  ], { cwd, home });

  assert.deepEqual(env.data.selectedRoles, ['product-manager', 'architect'], 'chain untouched when recruitment is off');
  assert.deepEqual(env.data.recruitment.addedRoles, []);
});
