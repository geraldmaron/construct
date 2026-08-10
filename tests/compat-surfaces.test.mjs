/**
 * tests/compat-surfaces.test.mjs — Compat-surface registry integrity gate.
 *
 * Verifies:
 *   1. The expiration-check logic itself, against fixtures: a past-expiration
 *      entry fails and names the entry; a within-window entry passes. Covers
 *      both expiration shapes (date, releaseCount).
 *   2. Every entry in the real compat/surfaces.json is structurally valid.
 *   3. Removed surfaces are honest tombstones (status:removed) and do not
 * claim live module paths or handlers; the matrix entry keeps
 *      its documented extension history.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { checkSurfaces, countReleasesSince, isExpired, parseChangelogVersions, validateSurfaceShape } from '../lib/compat/surfaces.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SURFACES_PATH = resolve(ROOT, 'compat', 'surfaces.json');
const CHANGELOG_PATH = resolve(ROOT, 'CHANGELOG.md');

function loadJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const surfaces = loadJSON(SURFACES_PATH);
const changelogVersions = parseChangelogVersions(fs.readFileSync(CHANGELOG_PATH, 'utf8'));

test('compat/surfaces.json exists and is a non-empty array', () => {
  assert.ok(Array.isArray(surfaces), 'compat/surfaces.json must be a JSON array');
  assert.ok(surfaces.length > 0, 'compat/surfaces.json must have at least one entry');
});

test('registry retains the five truth-21 surfaces as honest tombstones', () => {
  const byId = new Map(surfaces.map((entry) => [entry.id, entry]));
  const expectedIds = [
    'cli-matrix-graph-alias',
    'install-scope-footprint-alias',
    'cli-models-legacy-flags',
    'legacy-config-migration-module',
    'legacy-global-cleanup-module',
  ];
  for (const id of expectedIds) {
    const entry = byId.get(id);
    assert.ok(entry, `missing registry entry ${id}`);
    assert.equal(entry.status, 'removed', `${id} must be status:removed`);
    assert.match(entry.location, /^tombstone:/, `${id} location must be a tombstone, not a live path`);
  }
  assert.equal(
    fs.existsSync(resolve(ROOT, 'lib/config/legacy-config-migration.mjs')),
    false,
    'legacy-config-migration.mjs must stay deleted',
  );
  assert.equal(
    fs.existsSync(resolve(ROOT, 'lib/install/legacy-global-cleanup.mjs')),
    false,
    'legacy-global-cleanup.mjs must stay deleted',
  );
  assert.ok(byId.size === surfaces.length, 'entry ids must be unique');
});

test('every registry entry has all required fields and a valid shape', () => {
  const violations = [];
  for (const entry of surfaces) {
    const { valid, reason } = validateSurfaceShape(entry);
    if (!valid) violations.push(`${entry.id}: ${reason}`);
  }
  assert.deepEqual(violations, [], `Invalid compat-surface entries: ${violations.join('; ')}`);
});

test('date-type fixture entry in the past is reported expired', () => {
  const entry = { id: 'fixture-past', location: 'fixture', expiration: { type: 'date', date: '2020-01-01' }, extensionHistory: [] };
  const { expired, detail } = isExpired(entry, { today: '2026-07-17', changelogVersions: [] });
  assert.equal(expired, true);
  assert.match(detail, /has passed/);
});

test('date-type fixture entry in the future is not expired', () => {
  const entry = { id: 'fixture-future', location: 'fixture', expiration: { type: 'date', date: '2099-01-01' }, extensionHistory: [] };
  const { expired, detail } = isExpired(entry, { today: '2026-07-17', changelogVersions: [] });
  assert.equal(expired, false);
  assert.match(detail, /not yet reached/);
});

test('status:removed tombstones are never unresolved-expired', () => {
  const entry = {
    id: 'fixture-removed',
    status: 'removed',
    location: 'tombstone:fixture',
    expiration: { type: 'date', date: '2020-01-01' },
    extensionHistory: [],
  };
  const { expired, detail } = isExpired(entry, { today: '2026-07-21', changelogVersions: [] });
  assert.equal(expired, false);
  assert.match(detail, /tombstone/i);
});

test('releaseCount fixture entry past its cycle window is reported expired', () => {
  const fixtureVersions = [
    { version: '1.0.0', date: '2026-01-01' },
    { version: '1.1.0', date: '2026-02-01' },
    { version: '1.2.0', date: '2026-03-01' },
  ];
  const entry = { id: 'fixture-release-expired', location: 'fixture', expiration: { type: 'releaseCount', sinceVersion: '1.0.0', cycles: 2 }, extensionHistory: [] };
  const { expired, detail } = isExpired(entry, { today: '2026-07-17', changelogVersions: fixtureVersions });
  assert.equal(expired, true, detail);
});

test('releaseCount fixture entry within its cycle window is not expired', () => {
  const fixtureVersions = [
    { version: '1.0.0', date: '2026-01-01' },
    { version: '1.1.0', date: '2026-02-01' },
  ];
  const entry = { id: 'fixture-release-ok', location: 'fixture', expiration: { type: 'releaseCount', sinceVersion: '1.0.0', cycles: 2 }, extensionHistory: [] };
  const { expired, detail } = isExpired(entry, { today: '2026-07-17', changelogVersions: fixtureVersions });
  assert.equal(expired, false, detail);
});

test('checkSurfaces separates a mixed fixture registry into violations and ok, naming each entry', () => {
  const fixtureRegistry = [
    { id: 'expired-one', location: 'fixture:1', expiration: { type: 'date', date: '2020-01-01' }, extensionHistory: [] },
    { id: 'ok-one', location: 'fixture:2', expiration: { type: 'date', date: '2099-01-01' }, extensionHistory: [] },
  ];
  const { violations, ok } = checkSurfaces(fixtureRegistry, { today: '2026-07-17', changelogVersions: [] });
  assert.deepEqual(violations.map((v) => v.id), ['expired-one']);
  assert.deepEqual(ok.map((v) => v.id), ['ok-one']);
});

test('countReleasesSince counts only strictly-newer versions', () => {
  const versions = [
    { version: '1.0.0', date: '2026-01-01' },
    { version: '1.1.0', date: '2026-02-01' },
    { version: '1.2.0', date: '2026-03-01' },
  ];
  assert.equal(countReleasesSince(versions, '1.0.0'), 2);
  assert.equal(countReleasesSince(versions, '1.2.0'), 0);
  assert.equal(countReleasesSince(versions, '0.9.0'), 3);
});

test('real registry has zero unresolved-expired entries as of today', () => {
  const today = new Date().toISOString().slice(0, 10);
  const { violations } = checkSurfaces(surfaces, { today, changelogVersions });
  assert.deepEqual(
    violations.map((v) => `${v.id}: ${v.detail}`),
    [],
    'every compat-surface entry must either be within its expiration window, be status:removed, or carry a documented extension moving that window forward',
  );
});

test('the construct-matrix ADR-0053 tombstone documents its expired-and-extended history', () => {
  const matrixEntry = surfaces.find((entry) => entry.id === 'cli-matrix-graph-alias');
  assert.ok(matrixEntry, 'construct matrix entry must be present in the registry');
  assert.equal(matrixEntry.status, 'removed');
  assert.ok(matrixEntry.extensionHistory.length > 0, 'construct matrix entry must record its expired ADR-0053 window as an extension, not silently move the field');
  const firstExtension = matrixEntry.extensionHistory.find((ext) => ext.previousExpiration?.type === 'releaseCount');
  assert.ok(firstExtension, 'first releaseCount→date extension must remain on the tombstone');
  assert.ok(firstExtension.reason && firstExtension.reason.length > 0);
});
