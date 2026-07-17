/**
 * tests/compat-surfaces.test.mjs — Compat-surface registry integrity gate.
 *
 * Verifies:
 *   1. The expiration-check logic itself, against fixtures: a past-expiration
 *      entry fails and names the entry; a within-window entry passes. Covers
 *      both expiration shapes (date, releaseCount).
 *   2. Every entry in the real compat/surfaces.json is structurally valid.
 *   3. The real registry's construct-matrix entry (ADR-0053, past its
 *      original 2-release-cycle window) carries a documented extension
 *      rather than being silently past-expiration.
 *
 * @enforces construct-tsyfe.10.6
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

test('registry contains the five truth-21 surfaces named in construct-tsyfe.10.6', () => {
  const ids = new Set(surfaces.map((entry) => entry.id));
  const expectedLocations = [
    'lib/setup.mjs',
    'bin/construct:4719-4768',
    'bin/construct:7798-7806',
    'lib/config/legacy-config-migration.mjs',
    'lib/install/legacy-global-cleanup.mjs',
  ];
  const locations = surfaces.map((entry) => entry.location);
  for (const expected of expectedLocations) {
    assert.ok(
      locations.some((loc) => loc.includes(expected) || expected.includes(loc)),
      `no registry entry covers ${expected}`,
    );
  }
  assert.ok(ids.size === surfaces.length, 'entry ids must be unique');
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
    'every compat-surface entry must either be within its expiration window or carry a documented extension moving that window forward',
  );
});

test('the construct-matrix ADR-0053 surface documents its expired-and-extended history rather than hiding it', () => {
  const matrixEntry = surfaces.find((entry) => entry.location.startsWith('bin/construct:7798'));
  assert.ok(matrixEntry, 'construct matrix entry must be present in the registry');
  assert.ok(matrixEntry.extensionHistory.length > 0, 'construct matrix entry must record its expired ADR-0053 window as an extension, not silently move the field');
  const [firstExtension] = matrixEntry.extensionHistory;
  assert.equal(firstExtension.previousExpiration.type, 'releaseCount');
  assert.ok(firstExtension.reason && firstExtension.reason.length > 0);
});
