/**
 * tests/fixtures/artifacts/golden-fixtures.test.mjs — golden artifact fixtures per manifest type.
 *
 * @capability artifact.release-gate
 */

import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactTypes } from '../../../lib/artifact-manifest.mjs';
import { validateArtifactRelease } from '../../../lib/artifact-release-gate.mjs';
import { goldenFixturePath, listGoldenFixturePaths } from '../../../lib/certification/artifact-fixtures.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('every manifest type has a golden fixture on disk', () => {
  const fixtures = listGoldenFixturePaths({ rootDir: REPO });
  assert.equal(fixtures.length, artifactTypes({ rootDir: REPO }).length);
  for (const fixture of fixtures) {
    assert.equal(fixture.exists, true, `missing golden fixture for ${fixture.type}`);
    assert.match(fixture.path, new RegExp(`^tests/fixtures/artifacts/${fixture.type}/golden\\.md$`));
  }
});

test('golden fixtures pass release validation for their declared type', () => {
  for (const type of artifactTypes({ rootDir: REPO })) {
    const filePath = goldenFixturePath(type, { rootDir: REPO });
    const result = validateArtifactRelease({ filePath, type, rootDir: REPO });
    assert.equal(result.ok, true, `${type}: ${result.errors.join('; ')}`);
  }
});

test('golden fixtures trace to manifest template sources', () => {
  const sample = goldenFixturePath('prd', { rootDir: REPO });
  const content = fs.readFileSync(sample, 'utf8');
  assert.match(content, /cx_fixture_source: templates\/docs\/prd\.md/);
});
