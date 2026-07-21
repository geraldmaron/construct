/**
 * tests/scripts/ci-repro-drift.test.mjs — drift gate between ci.yml's `test`
 * job and its local Docker replica (scripts/ci-repro/).
 *
 * The replica is only useful while it runs what CI runs. This test parses the
 * workflow, extracts the test job's run: commands, and asserts every core
 * invocation has a counterpart in the replica: setup-toolchain.sh is baked
 * into the image (Dockerfile), everything else runs in job-test.sh in the
 * same relative order as the workflow steps. Matching is on core invocations
 * only, deliberately tolerant of argument differences (CI passes matrix shard
 * args; the replica forwards an optional $SHARD).
 *
 * Also asserts hang-safety contracts on the test job (timeout-minutes) and on
 * setup-toolchain.sh (apt Acquire timeouts + curl connect/max-time) so a
 * stuck Ubuntu mirror cannot burn a runner for an hour undetected.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const ci = yaml.load(fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'));
const release = yaml.load(fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'release.yml'), 'utf8'));
const runCommands = (ci.jobs?.test?.steps ?? []).map((s) => s.run).filter(Boolean);
const dockerfile = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'ci-repro', 'Dockerfile'), 'utf8');
const jobScript = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'ci-repro', 'job-test.sh'), 'utf8');
const setupToolchain = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'ci', 'setup-toolchain.sh'), 'utf8');

// Comment lines in job-test.sh must not satisfy a command-presence assertion.

const jobScriptCommands = jobScript
  .split('\n')
  .filter((line) => !/^\s*#/.test(line) && line.trim() !== '')
  .join('\n');

const IMAGE_CORE = ['scripts/ci/setup-toolchain.sh'];
const JOB_CORE = [
  'npm ci --ignore-scripts',
  'scripts/ci/setup-mermaid-cli.sh',
  'scripts/ci/build-test-fixtures.sh',
  'npm test',
  'npm run doctor',
  'npm run docs:verify',
];

test('ci.yml test job still runs every core invocation the replica mirrors', () => {
  for (const core of [...IMAGE_CORE, ...JOB_CORE]) {
    assert.ok(
      runCommands.some((cmd) => cmd.includes(core)),
      `ci.yml test job no longer runs "${core}" — update scripts/ci-repro/ to match, then this test's core list`,
    );
  }
});

test('setup-toolchain.sh is baked into the replica image', () => {
  for (const core of IMAGE_CORE) {
    assert.ok(
      dockerfile.includes(path.basename(core)),
      `Dockerfile must run ${core} (same file CI runs) so the toolchain cannot drift`,
    );
  }
});

test('job-test.sh runs the core commands in the same order as ci.yml', () => {
  const ciOrder = [];
  for (const cmd of runCommands) {
    for (const core of JOB_CORE) {
      if (cmd.includes(core) && !ciOrder.includes(core)) ciOrder.push(core);
    }
  }
  assert.deepEqual(ciOrder, JOB_CORE, 'ci.yml core command order changed — update JOB_CORE and job-test.sh');

  let cursor = -1;
  for (const core of ciOrder) {
    const idx = jobScriptCommands.indexOf(core);
    assert.ok(idx !== -1, `job-test.sh must run "${core}"`);
    assert.ok(idx > cursor, `job-test.sh runs "${core}" out of order relative to ci.yml`);
    cursor = idx;
  }
});

test('ci.yml test job declares timeout-minutes so stuck toolchain cannot hang forever', () => {
  const minutes = ci.jobs?.test?.['timeout-minutes'];
  assert.equal(typeof minutes, 'number', 'ci.yml test job must set timeout-minutes');
  assert.ok(minutes > 0 && minutes <= 45, `ci.yml test timeout-minutes should be a tight bound (got ${minutes})`);

  const toolchainStep = (ci.jobs?.test?.steps ?? []).find(
    (s) => typeof s.run === 'string' && s.run.includes('scripts/ci/setup-toolchain.sh'),
  );
  assert.ok(toolchainStep, 'ci.yml test job must run setup-toolchain.sh');
  assert.equal(
    typeof toolchainStep['timeout-minutes'],
    'number',
    'install test toolchain step must set timeout-minutes',
  );
  assert.ok(
    toolchainStep['timeout-minutes'] > 0 && toolchainStep['timeout-minutes'] < minutes,
    'toolchain step timeout must be shorter than the job timeout',
  );
});

test('release.yml gate declares timeout-minutes around setup-toolchain', () => {
  const minutes = release.jobs?.gate?.['timeout-minutes'];
  assert.equal(typeof minutes, 'number', 'release.yml gate job must set timeout-minutes');
  assert.ok(minutes > 0, `release.yml gate timeout-minutes must be positive (got ${minutes})`);

  const toolchainStep = (release.jobs?.gate?.steps ?? []).find(
    (s) => typeof s.run === 'string' && s.run.includes('scripts/ci/setup-toolchain.sh'),
  );
  assert.ok(toolchainStep, 'release.yml gate must run setup-toolchain.sh');
  assert.equal(
    typeof toolchainStep['timeout-minutes'],
    'number',
    'release gate toolchain step must set timeout-minutes',
  );
});

test('setup-toolchain.sh bounds apt and curl so mirror hangs fail closed', () => {
  assert.match(setupToolchain, /Acquire::http::Timeout=30/);
  assert.match(setupToolchain, /Acquire::https::Timeout=30/);
  assert.match(setupToolchain, /Acquire::Retries=3/);
  assert.match(setupToolchain, /--connect-timeout 15/);
  assert.match(setupToolchain, /--max-time 180/);
});
