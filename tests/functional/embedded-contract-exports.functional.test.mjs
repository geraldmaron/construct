/**
 * tests/functional/embedded-contract-exports.functional.test.mjs
 *
 * construct-tsyfe.9.6: proves the published package exports map exposes only the
 * ECL entrypoints (no ./lib/* wildcard) and that resolveEmbeddedModel and
 * recommendPlan work end-to-end through the installed tarball.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-ecl-pack-'));

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...opts });
}

test('package exports map has no ./lib/* wildcard', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const exportKeys = Object.keys(pkg.exports ?? {});
  assert.ok(!exportKeys.includes('./lib/*'), `wildcard export still present: ${exportKeys.join(', ')}`);
  assert.equal(pkg.exports['.'], './lib/embedded-contract/index.mjs');
  assert.equal(pkg.exports['./embedded-contract'], './lib/embedded-contract/index.mjs');
});

test('packed tarball resolves ECL exports and runs core SDK functions', { timeout: 120_000 }, async () => {
  const pack = run('npm', ['pack', '--json', '--pack-destination', PACK_DIR], { cwd: REPO });
  assert.equal(pack.status, 0, pack.stderr || pack.stdout);
  const tarballName = JSON.parse(pack.stdout)[0].filename;
  const tarballPath = path.join(PACK_DIR, tarballName);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-ecl-consumer-'));
  const init = run('npm', ['init', '-y'], { cwd: work });
  assert.equal(init.status, 0, init.stderr);

  const install = run('npm', ['install', tarballPath, '--ignore-scripts'], { cwd: work });
  assert.equal(install.status, 0, install.stderr || install.stdout);

  const probePath = path.join(work, 'probe.mjs');
  fs.writeFileSync(probePath, `
import { resolveEmbeddedModel, recommendPlan, CONTRACT_VERSION } from '@geraldmaron/construct';
import assert from 'node:assert/strict';

const model = resolveEmbeddedModel({ tier: 'fast' }, { env: { ...process.env, HOME: process.cwd(), CONSTRUCT_MODEL_FAST: '' }, cwd: process.cwd() });
assert.equal(typeof model.contractVersion, 'string');
assert.equal(model.contractVersion, CONTRACT_VERSION);

const plan = recommendPlan({ text: 'Review the billing module for security gaps.' }, { env: { ...process.env, HOME: process.cwd() }, cwd: process.cwd() });
assert.equal(typeof plan.contractVersion, 'string');
assert.ok(plan.data || plan.error, 'recommendPlan returned an envelope');
console.log('ok');
`);

  const probe = run(process.execPath, [probePath], {
    cwd: work,
    env: {
      ...process.env,
      HOME: work,
      CONSTRUCT_HOME_OVERRIDE: work,
      CONSTRUCT_MODEL_REASONING: '',
      CONSTRUCT_MODEL_STANDARD: '',
      CONSTRUCT_MODEL_FAST: '',
      OPENROUTER_API_KEY: '',
      ANTHROPIC_API_KEY: '',
    },
  });
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
  assert.match(probe.stdout, /ok/);

  rmTmpDir(work);
});

after(() => {
  try { rmTmpDir(PACK_DIR); } catch { /* ignore */ }
});
