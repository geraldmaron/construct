/**
 * tests/oracle-invariants-cross-process-state-has-one-authoritative-location.test.mjs —
 * the `cross-process-state-has-one-authoritative-location` Layer 1 invariant:
 * derivation-site scanning and the known-set/tracking-marker checks, against real and
 * fixture lib/ trees.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  id,
  layer,
  KNOWN_DERIVATION_SITES,
  scanForDerivationSites,
  check,
} from '../lib/oracle/invariants/cross-process-state-has-one-authoritative-location.mjs';

function makeFixtureRepo(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-invariant-project-identity-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.mkdirSync(path.join(cwd, 'lib', 'orchestration'), { recursive: true });
  fs.mkdirSync(path.join(cwd, 'lib', 'embed'), { recursive: true });

  fs.writeFileSync(
    path.join(cwd, 'lib', 'state-root.mjs'),
    "// one of several project-identity derivations\nexport function deriveProjectKey(projectRoot) { return projectRoot; }\n",
  );
  fs.writeFileSync(
    path.join(cwd, 'lib', 'orchestration', 'store.mjs'),
    "// one of several project-identity derivations\nexport function projectKey(config, cwd) { return cwd; }\n",
  );
  fs.writeFileSync(
    path.join(cwd, 'lib', 'embed', 'daemon.mjs'),
    "export function resolveRootDir(env, cwd) { return cwd; }\n",
  );

  return cwd;
}

const FIXTURE_KNOWN_SITES = [
  { file: 'lib/state-root.mjs', functionName: 'deriveProjectKey' },
  { file: 'lib/orchestration/store.mjs', functionName: 'projectKey' },
  { file: 'lib/embed/daemon.mjs', functionName: 'resolveRootDir' },
];

test('invariant module exports id/layer per the registry contract', () => {
  assert.equal(id, 'cross-process-state-has-one-authoritative-location');
  assert.equal(layer, 1);
});

test('KNOWN_DERIVATION_SITES names exactly the three real derivation sites', () => {
  assert.deepEqual(KNOWN_DERIVATION_SITES, [
    { file: 'lib/state-root.mjs', functionName: 'deriveProjectKey' },
    { file: 'lib/orchestration/store.mjs', functionName: 'projectKey' },
    { file: 'lib/embed/daemon.mjs', functionName: 'resolveRootDir' },
  ]);
});

test('scanForDerivationSites finds every allowlisted exported function name across the tree', (t) => {
  const cwd = makeFixtureRepo(t);
  const found = scanForDerivationSites(path.join(cwd, 'lib'));
  const keys = found.map((s) => `${s.file}::${s.functionName}`);
  assert.ok(keys.includes('lib/state-root.mjs::deriveProjectKey'));
  assert.ok(keys.includes('lib/orchestration/store.mjs::projectKey'));
  assert.ok(keys.includes('lib/embed/daemon.mjs::resolveRootDir'));
});

test('check(): all known sites present and documented rolls up to passed', async (t) => {
  const cwd = makeFixtureRepo(t);
  fs.writeFileSync(
    path.join(cwd, 'lib', 'embed', 'daemon.mjs'),
    "// one of several project-identity derivations\nexport function resolveRootDir(env, cwd) { return cwd; }\n",
  );
  const result = await check({ cwd, knownSites: FIXTURE_KNOWN_SITES });
  assert.equal(result.status, 'passed');
  assert.equal(result.violations.length, 0);
});

test('check(): a known site that stops documenting the divergence regresses to a violation', async (t) => {
  const cwd = makeFixtureRepo(t);
  fs.writeFileSync(
    path.join(cwd, 'lib', 'state-root.mjs'),
    "export function deriveProjectKey(projectRoot) { return projectRoot; }\n",
  );
  const result = await check({ cwd, knownSites: FIXTURE_KNOWN_SITES });
  assert.equal(result.status, 'failed');
  assert.ok(result.violations.some((v) => v.site === 'lib/state-root.mjs::deriveProjectKey'));
});

test('check(): an undocumented fourth derivation site is a violation (proliferation)', async (t) => {
  const cwd = makeFixtureRepo(t);
  fs.mkdirSync(path.join(cwd, 'lib', 'rogue'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, 'lib', 'rogue', 'identity.mjs'),
    "export function deriveProjectId(cwd) { return cwd; }\n",
  );
  const result = await check({ cwd, knownSites: FIXTURE_KNOWN_SITES });
  assert.equal(result.status, 'failed');
  assert.ok(result.violations.some((v) => /undocumented project-identity derivation site/.test(v.detail)));
});

test('check(): a known site whose export disappeared is unknown, not a false failed', async (t) => {
  const cwd = makeFixtureRepo(t);
  fs.writeFileSync(path.join(cwd, 'lib', 'embed', 'daemon.mjs'), "// resolveRootDir removed\n");
  const result = await check({ cwd, knownSites: FIXTURE_KNOWN_SITES });
  assert.equal(result.status, 'unknown');
  assert.equal(result.unresolved.length, 1);
});

test('check(): the real repo on feat/workspace-control-plane has resolveRootDir moved to lib/project-root.mjs (four scanned sites, one new violation, daemon site unresolved)', async () => {
  const result = await check({});
  assert.equal(result.status, 'failed');
  assert.equal(result.evaluated, 4);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].site, 'lib/project-root.mjs::resolveRootDir');
  assert.ok(result.unresolved.some((u) => u.site === 'lib/embed/daemon.mjs::resolveRootDir'));
  const passing = result.results.filter((r) => r.status === 'passed');
  assert.equal(passing.length, 2);
});
