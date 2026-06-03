/**
 * tests/table-schema.test.mjs — table schema postcondition.
 *
 * @enforces ADR-0015
 *
 * Bead construct-wvbf.12: a declared table must carry the required columns and at
 * least one data row. These pin artifact-table-has-columns against the
 * validateArtifactPostconditions path, including the missing-column and
 * empty-table failure cases.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateArtifactPostconditions } from '../lib/contracts/validate.mjs';

function run(markdown, columns) {
  const dir = mkdtempSync(join(tmpdir(), 'cx-tbl-'));
  try {
    const file = join(dir, 'a.md');
    writeFileSync(file, markdown);
    return validateArtifactPostconditions({
      contract: { postconditions: [{ id: 't', check: 'artifact-table-has-columns', columns }] },
      artifactPath: file,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a table with the required columns and a data row passes', () => {
  const md = '# Incident\n\n| Time | Event |\n|------|-------|\n| 09:00 | alert fired |\n';
  assert.deepEqual(run(md, ['Time', 'Event']), []);
});

test('a table missing a required column fails', () => {
  const md = '# Incident\n\n| Time | Note |\n|------|------|\n| 09:00 | x |\n';
  assert.equal(run(md, ['Time', 'Event']).length, 1);
});

test('a header-only table with no data rows fails', () => {
  const md = '# Incident\n\n| Time | Event |\n|------|-------|\n';
  const errs = run(md, ['Time', 'Event']);
  assert.equal(errs.length, 1);
  assert.ok(/no data rows/.test(errs[0]));
});
