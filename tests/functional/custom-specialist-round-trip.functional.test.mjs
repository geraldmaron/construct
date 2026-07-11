/**
 * tests/functional/custom-specialist-round-trip.functional.test.mjs —
 * authoring round trip for user-authored custom specialists
 * (construct-rf26.22, extending construct-rf26.13's scaffold/validate/resolve
 * coverage in tests/functional/custom-specialist-authoring.functional.test.mjs).
 *
 * Three pins the existing coverage leaves open:
 *   1. Hot-load: a specialist scaffolded by the real CLI resolves through an
 *      ALREADY-WARM loader cache with no clearCache() call between scaffold
 *      and lookup — lib/registry/loader.mjs's orgDirMtime cache key must
 *      notice the new .construct/org file by mtime alone (rf26.13's "no daemon
 *      restart" claim; the existing test clears the cache explicitly, so a
 *      broken mtime walk would still pass it).
 *   2. Edit round trip: re-scaffolding an existing id fails without --force,
 *      succeeds with --force, and the edited field is what a subsequent
 *      lookup resolves — author, edit, re-resolve, end to end via the CLI.
 *   3. Tier precedence on id collision: a project-tier (.construct/org) drop-in that
 *      overrides one field of a built-in specialist wins on that field while
 *      inheriting the rest of the built-in record (assemble.mjs's documented
 *      builtin -> user -> project merge), and the merged registry still
 *      validates.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-custom-round-trip-'));
  fs.mkdirSync(path.join(dir, 'specialists'), { recursive: true });
  fs.cpSync(path.join(REPO, 'specialists', 'org'), path.join(dir, 'specialists', 'org'), { recursive: true });
  return dir;
}

function run(args, env) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      ...env,
      CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
      BOOTSTRAP_CHECKED: '1',
    },
  });
}

// The in-process loader resolves the user tier via homeDir(), which reads
// CX_HOME_OVERRIDE from process.env directly — every in-process registry call
// runs under the same override the spawned CLI sees.

async function withHomeOverride(homeDir, fn) {
  const prev = process.env.CX_HOME_OVERRIDE;
  process.env.CX_HOME_OVERRIDE = homeDir;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.CX_HOME_OVERRIDE;
    else process.env.CX_HOME_OVERRIDE = prev;
  }
}

function scaffoldArgs(projectDir, { description, force = false } = {}) {
  return [
    'specialist', 'create', 'hotload-specialist', '--custom',
    '--role=hotload-specialist',
    '--team=hotload-team',
    `--description=${description}`,
    '--skills=frontend-design/accessibility',
    '--fence-paths=docs/hotload/**',
    ...(force ? ['--force'] : []),
    `--root=${projectDir}`,
  ];
}

test('a CLI-scaffolded specialist resolves through an already-warm loader cache without clearCache', async (t) => {
  const projectDir = makeProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-custom-round-trip-home-'));
  t.after(() => {
    rmTmpDir(projectDir);
    rmTmpDir(homeDir);
  });
  const env = { HOME: homeDir, CX_HOME_OVERRIDE: homeDir };

  const { loadRegistry, getSpecialist, getTeam, clearCache } = await import('../../lib/registry/loader.mjs');

  // Warm the cache once for this rootDir, before anything custom exists. One
  // clearCache here only isolates from other tests in this process; the pin
  // is that NO clearCache happens between the scaffold and the re-lookup.
  await withHomeOverride(homeDir, async () => {
    clearCache();
    loadRegistry({ rootDir: projectDir });
    assert.equal(getSpecialist('hotload-specialist', { rootDir: projectDir }), null, 'baseline: the custom specialist does not exist yet');
    assert.equal(getTeam('hotload-team', { rootDir: projectDir }), null, 'baseline: the custom team does not exist yet');
  });

  const teamResult = run([
    'team', 'create', 'hotload-team',
    '--owner=hotload-specialist',
    '--charter=Owns the hot-load verification surface for this test project.',
    `--root=${projectDir}`,
  ], env);
  assert.equal(teamResult.status, 0, teamResult.stderr || teamResult.stdout);

  const specResult = run(scaffoldArgs(projectDir, { description: 'Verifies loader hot-load end to end.' }), env);
  assert.equal(specResult.status, 0, specResult.stderr || specResult.stdout);

  await withHomeOverride(homeDir, async () => {
    const spec = getSpecialist('hotload-specialist', { rootDir: projectDir });
    assert.ok(spec, 'the freshly scaffolded specialist must resolve with no clearCache — orgDirMtime alone invalidates the warm cache');
    assert.equal(spec.role, 'hotload-specialist');
    assert.ok(getTeam('hotload-team', { rootDir: projectDir }), 'the freshly scaffolded team must hot-load the same way');
  });
});

test('edit round trip: re-scaffold refuses without --force, succeeds with it, and the edit is what resolves', async (t) => {
  const projectDir = makeProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-custom-round-trip-edit-home-'));
  t.after(() => {
    rmTmpDir(projectDir);
    rmTmpDir(homeDir);
  });
  const env = { HOME: homeDir, CX_HOME_OVERRIDE: homeDir };

  const teamResult = run([
    'team', 'create', 'hotload-team',
    '--owner=hotload-specialist',
    '--charter=Owns the hot-load verification surface for this test project.',
    `--root=${projectDir}`,
  ], env);
  assert.equal(teamResult.status, 0, teamResult.stderr || teamResult.stdout);

  const first = run(scaffoldArgs(projectDir, { description: 'Original description, first authoring pass.' }), env);
  assert.equal(first.status, 0, first.stderr || first.stdout);

  const refused = run(scaffoldArgs(projectDir, { description: 'Accidental second pass that must not clobber.' }), env);
  assert.equal(refused.status, 1, 'a second create for the same id must refuse without --force');
  assert.match(refused.stderr, /already exists/, 'the refusal names the collision');

  const specFile = path.join(projectDir, '.construct', 'org', 'specialists', 'cx-hotload-specialist.json');
  assert.match(
    JSON.parse(fs.readFileSync(specFile, 'utf8')).description,
    /Original description/,
    'the refused pass left the original record untouched on disk',
  );

  const forced = run(scaffoldArgs(projectDir, { description: 'Edited description, deliberate second pass.', force: true }), env);
  assert.equal(forced.status, 0, forced.stderr || forced.stdout);

  const { loadRegistry, getSpecialist, clearCache } = await import('../../lib/registry/loader.mjs');
  await withHomeOverride(homeDir, async () => {
    clearCache();
    loadRegistry({ rootDir: projectDir });
    const spec = getSpecialist('hotload-specialist', { rootDir: projectDir });
    assert.match(spec.description, /Edited description/, 'the resolved record carries the forced edit, not the original');
  });
});

test('a project-tier drop-in overriding one field of a built-in specialist wins on that field and inherits the rest', async (t) => {
  const projectDir = makeProject();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-custom-round-trip-precedence-home-'));
  t.after(() => {
    rmTmpDir(projectDir);
    rmTmpDir(homeDir);
  });

  const { loadRegistry, getSpecialist, clearCache } = await import('../../lib/registry/loader.mjs');
  const { validate } = await import('../../lib/registry/validator.mjs');

  const baseline = await withHomeOverride(homeDir, async () => {
    clearCache();
    loadRegistry({ rootDir: projectDir });
    return getSpecialist('engineer', { rootDir: projectDir });
  });
  assert.ok(baseline, 'the built-in engineer resolves before any overlay exists');
  assert.notEqual(baseline.modelTier, 'reasoning', 'the field this test overrides must differ from the built-in value, or the pin is vacuous');

  const overlayDir = path.join(projectDir, '.construct', 'org', 'specialists');
  fs.mkdirSync(overlayDir, { recursive: true });
  fs.writeFileSync(
    path.join(overlayDir, 'cx-engineer.json'),
    `${JSON.stringify({ id: 'cx-engineer', modelTier: 'reasoning' }, null, 2)}\n`,
  );

  await withHomeOverride(homeDir, async () => {
    const registry = loadRegistry({ rootDir: projectDir });
    const merged = getSpecialist('engineer', { rootDir: projectDir });
    assert.equal(merged.modelTier, 'reasoning', 'the project-tier field wins on id collision');
    assert.equal(merged.promptFile, baseline.promptFile, 'fields the overlay omits are inherited from the built-in record, not dropped');
    assert.equal(merged.role, baseline.role, 'the overlay is a field-level merge, not a record replacement');

    const result = validate(registry);
    assert.equal(result.ok, true, `the merged registry must still validate:\n${JSON.stringify(result.errors, null, 2)}`);
  });
});
