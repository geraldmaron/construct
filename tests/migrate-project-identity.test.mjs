/**
 * tests/migrate-project-identity.test.mjs — lib/project-identity/migrate.mjs.
 *
 * Isolates HOME via CONSTRUCT_HOME_OVERRIDE so migration never touches the
 * developer machine's real ~/.construct/projects/ tree.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  applyProjectIdentityMigration,
  planProjectIdentityMigration,
} from '../lib/project-identity/migrate.mjs';
import { deriveProjectKey, derivePathOnlyProjectKey } from '../lib/state-root.mjs';

const dirs = [];
function mkTmp(prefix = 'cx-migrate-') {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(d);
  return d;
}

const homeOverride = mkTmp('cx-migrate-home-');
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;

test.after(() => {
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

function initRemoteRepo(dir, remote) {
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir });
}

test('dry-run plans a path-hash to remote-hash merge when a legacy bucket exists', () => {
  const repo = mkTmp();
  initRemoteRepo(repo, 'https://github.com/example/migrate-plan.git');

  const pathKey = derivePathOnlyProjectKey(repo);
  const canonicalKey = deriveProjectKey(repo);
  assert.notEqual(pathKey, canonicalKey);

  const legacyDir = path.join(homeOverride, '.construct', 'projects', pathKey, 'traces');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'legacy.jsonl'), '{"source":"test"}\n');

  const plan = planProjectIdentityMigration(repo, { home: homeOverride });
  assert.equal(plan.canonicalKey, canonicalKey);
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].fromKey, pathKey);
  assert.equal(plan.actions[0].toKey, canonicalKey);
});

test('--apply copies legacy files into the canonical bucket without deleting the source', () => {
  const repo = mkTmp();
  initRemoteRepo(repo, 'https://github.com/example/migrate-apply.git');

  const pathKey = derivePathOnlyProjectKey(repo);
  const canonicalKey = deriveProjectKey(repo);
  const legacyFile = path.join(homeOverride, '.construct', 'projects', pathKey, 'runtime', 'marker.txt');
  fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
  fs.writeFileSync(legacyFile, 'legacy-state');

  const { results } = applyProjectIdentityMigration(repo, { home: homeOverride });
  assert.equal(results.length, 1);
  assert.equal(results[0].merged, 1);

  const canonicalFile = path.join(homeOverride, '.construct', 'projects', canonicalKey, 'runtime', 'marker.txt');
  assert.equal(fs.readFileSync(canonicalFile, 'utf8'), 'legacy-state');
  assert.ok(fs.existsSync(legacyFile), 'source bucket must survive apply');
});

test('flags homedir()-fallback buckets without scheduling an automatic merge', () => {
  const repo = mkTmp();
  initRemoteRepo(repo, 'https://github.com/example/migrate-flag.git');

  const homedirKey = deriveProjectKey(os.homedir());
  const homedirDir = path.join(homeOverride, '.construct', 'projects', homedirKey);
  fs.mkdirSync(path.join(homedirDir, 'lancedb'), { recursive: true });

  const plan = planProjectIdentityMigration(repo, { home: homeOverride });
  assert.equal(plan.flagged.length, 1);
  assert.match(plan.flagged[0].reason, /review manually/);
  assert.equal(plan.actions.some((a) => a.fromKey === homedirKey), false);
});
