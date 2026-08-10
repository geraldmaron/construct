/**
 * tests/postcondition-checks.test.mjs — new executable postcondition checks.
 *
 * Bead construct-wvbf.7 extends the postcondition vocabulary beyond
 * has-section / claims-cited so prose expectations can become enforced ones.
 * These pin artifact-has-mermaid, artifact-has-table, and
 * artifact-section-nonempty against the validateArtifactPostconditions path.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateArtifactPostconditions } from '../lib/contracts/validate.mjs';

function runChecks(markdown, postconditions) {
  const dir = mkdtempSync(join(tmpdir(), 'cx-pc-'));
  try {
    const file = join(dir, 'artifact.md');
    writeFileSync(file, markdown);
    return validateArtifactPostconditions({ contract: { postconditions }, artifactPath: file });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('artifact-has-mermaid passes with a fenced mermaid block of the right kind', () => {
  const md = '# Doc\n\n```mermaid\nflowchart TD\n  A --> B\n```\n';
  assert.deepEqual(runChecks(md, [{ id: 'm', check: 'artifact-has-mermaid', diagram: 'flowchart' }]), []);
});

test('artifact-has-mermaid fails when the diagram is absent or the wrong kind', () => {
  const md = '# Doc\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n';
  const errs = runChecks(md, [{ id: 'm', check: 'artifact-has-mermaid', diagram: 'flowchart' }]);
  assert.equal(errs.length, 1);
  const none = runChecks('# Doc\n\nno diagram here\n', [{ id: 'm', check: 'artifact-has-mermaid' }]);
  assert.equal(none.length, 1);
});

test('artifact-has-table detects a GFM table and fails without one', () => {
  const withTable = '# Doc\n\n| A | B |\n|---|---|\n| 1 | 2 |\n';
  assert.deepEqual(runChecks(withTable, [{ id: 't', check: 'artifact-has-table' }]), []);
  const without = runChecks('# Doc\n\njust prose\n', [{ id: 't', check: 'artifact-has-table' }]);
  assert.equal(without.length, 1);
});

test('artifact-section-nonempty distinguishes an empty section from a filled one', () => {
  const filled = '# Doc\n\n## Reversibility\n\nTwo-way door.\n';
  assert.deepEqual(runChecks(filled, [{ id: 's', check: 'artifact-section-nonempty', section: 'Reversibility' }]), []);
  const empty = '# Doc\n\n## Reversibility\n\n## Next\n\nbody\n';
  const errs = runChecks(empty, [{ id: 's', check: 'artifact-section-nonempty', section: 'Reversibility' }]);
  assert.equal(errs.length, 1);
});
