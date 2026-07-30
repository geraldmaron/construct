/**
 * tests/functional/config-invalid-surfaces-warning.functional.test.mjs
 *
 * lib/config/project-config.mjs reverts the entire construct.config.json to
 * defaults on any validation error (the fail-safe stance), and
 * lib/orchestration/runtime.mjs discarded the errors/source that reversion
 * carries. A single typo (e.g. orchestration.store: "sqllite") silently
 * flipped workerBackend back to the "inline" default with zero user-visible
 * signal. This locks in that planRun surfaces a warning naming the invalid
 * key and stating defaults were applied, that construct doctor reports the
 * same invalid config, and that a valid config produces no new warning.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { planRun } from '../../lib/orchestration/runtime.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '..', '..', 'bin', 'construct');

const dirs = [];
function project(configObj) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-config-invalid-'));
  dirs.push(cwd);
  fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify(configObj));
  return cwd;
}
test.after(() => { for (const d of dirs) { try { rmTmpDir(d); } catch {} } });

// planRun (called in-process below) resolves the run store through the
// machine-scoped state root, which reads CONSTRUCT_HOME_OVERRIDE from
// real process.env directly — the ENV bag below only feeds model-tier
// lookups. Pin it for the whole file so these runs never write into the
// real developer machine's ~/.construct/projects/. (The spawned `construct
// doctor` test below already isolates correctly via its own HOME override
// in the child's env.)

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-config-invalid-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { rmTmpDir(homeOverride); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

const ENV = { CONSTRUCT_MODEL_REASONING: 'anthropic/claude-sonnet-4-6', CONSTRUCT_MODEL_STANDARD: 'anthropic/claude-sonnet-4-6', CONSTRUCT_MODEL_FAST: 'anthropic/claude-sonnet-4-6' };

test('an invalid config surfaces a planRun warning naming the bad key and stating defaults were applied', async () => {
  const cwd = project({ version: 1, orchestration: { workerBackend: 'provider', store: 'sqllite' } });
  const run = await planRun({ request: 'x' }, { env: ENV, cwd });
  assert.ok(
    run.warnings.some((w) => /sqllite|store/i.test(w) && /default/i.test(w)),
    'invalid config must surface a run warning naming the bad key and the default fallback',
  );
  // Reversion behavior itself is unchanged: the invalid file's workerBackend
  // override never took effect, so the run planned against the inline default.
  assert.equal(run.workerBackend, 'inline');
});

test('construct doctor reports the same invalid config', () => {
  const cwd = project({ version: 1, orchestration: { workerBackend: 'provider', store: 'sqllite' } });
  const res = spawnSync('node', [BIN, 'doctor'], { cwd, encoding: 'utf8', timeout: 30_000, env: { ...process.env, HOME: cwd, USERPROFILE: cwd } });
  assert.match(res.stdout, /construct\.config\.json invalid.*sqllite/i);
});

test('a valid config produces no new planRun warnings', async () => {
  const cwd = project({ version: 1, orchestration: { workerBackend: 'inline', store: 'filesystem' } });
  const run = await planRun({ request: 'x' }, { env: ENV, cwd });
  assert.ok(
    !run.warnings.some((w) => /config/i.test(w) && /default/i.test(w)),
    'a valid config must not add a config-reversion warning',
  );
});
