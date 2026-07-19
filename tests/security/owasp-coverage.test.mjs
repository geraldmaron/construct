/**
 * tests/security/owasp-coverage.test.mjs — LMCP-N8 security corpus wired into
 * the living graph.
 *
 * Pins the acceptance guarantees:
 *   1. the OWASP GenAI Top-10 matrix is generated from the graph and lists all
 *      ten categories, each with a test count (0 for uncovered) — coverage
 *      gaps are enumerable, never silently absent;
 *   2. `@owasp`/`@secures` tags become graph structure: security-test nodes
 *      carry their categories and `secures` edges reach the protected
 *      workflow/embed nodes;
 *   3. a `@secures` naming a node that does not exist fails `graph validate
 *      --strict` (dangling coverage link).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildFromSecurity,
  buildOwaspMatrix,
  findWorkflowsMissingSecurity,
  OWASP_GENAI_TOP10,
} from '../../lib/graph/security-coverage.mjs';
import { writeGraph } from '../../lib/graph/store.mjs';
import { validateGraph } from '../../lib/graph/validate.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the OWASP matrix generated from the graph lists all 10 categories with counts', () => {
  const matrix = buildOwaspMatrix(REPO_ROOT);
  assert.equal(matrix.graphPresent, true, 'run `construct graph build` first');
  assert.equal(matrix.categories.length, 10);
  const ids = matrix.categories.map((c) => c.id);
  for (const { id } of OWASP_GENAI_TOP10) assert.ok(ids.includes(id), `matrix missing ${id}`);
  for (const cat of matrix.categories) assert.equal(typeof cat.testCount, 'number');
  // At least the injection + excessive-agency categories are covered by the
  // tagged corpus, so the matrix is not trivially empty.
  const byId = Object.fromEntries(matrix.categories.map((c) => [c.id, c.testCount]));
  assert.ok(byId.LLM01 >= 1, 'LLM01 should be covered');
  assert.ok(byId.LLM06 >= 1, 'LLM06 should be covered');
});

test('buildFromSecurity seeds test nodes with OWASP categories + secures edges', () => {
  const { nodes, edges } = buildFromSecurity({ rootDir: REPO_ROOT });
  const tagged = nodes.filter((n) => Array.isArray(n.attrs?.owasp) && n.attrs.owasp.length > 0);
  assert.ok(tagged.length >= 5, 'expected several tagged security tests');
  // The N4 vector-poisoning test secures the research-synthesis workflow.
  assert.ok(
    edges.some((e) => e.rel === 'secures' && e.to === 'workflow:research-synthesis'),
    'research-synthesis should have an inbound secures edge',
  );
  // An embed preset is secured via its embed node, not a workflow node.
  assert.ok(
    edges.some((e) => e.rel === 'secures' && e.to === 'embed:operations'),
    'operations embed preset should have an inbound secures edge',
  );
});

test('the security gap list covers embed presets and executable workflows', () => {
  const gaps = findWorkflowsMissingSecurity(REPO_ROOT);
  assert.equal(gaps.graphPresent, true);
  for (const covered of ['embed:operations', 'workflow:research-synthesis']) {
    assert.ok(gaps.covered.includes(covered), `${covered} should be covered`);
    assert.ok(!gaps.workflows.includes(covered), `${covered} should not be in the gap list`);
  }
});

test('a @secures naming a nonexistent node fails graph validate --strict', () => {
  // Only this test writes a synthetic graph instead of reading REPO_ROOT's
  // real one — isolate its relational graph.db under its own
  // CONSTRUCT_HOME_OVERRIDE for the duration, restored immediately after so the
  // other REPO_ROOT-reading tests in this file keep seeing the real fixture
  // scripts/ci/build-test-fixtures.sh built.
  const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-owasp-home-'));
  const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-owasp-'));
  try {
    writeGraph(tmp, {
      nodes: [{ id: 'test:tests/x.test.mjs', type: 'test', name: 'x', attrs: { owasp: ['LLM01'] } }],
      edges: [{ from: 'test:tests/x.test.mjs', to: 'workflow:ghost', rel: 'secures', source: 'corpus-annotation' }],
    });
    const solo = validateGraph(tmp, { strict: false });
    assert.ok(solo.warnings.some((w) => /@secures 'workflow:ghost'/.test(w)));
    const strict = validateGraph(tmp, { strict: true });
    assert.equal(strict.valid, false);
    assert.ok(strict.errors.some((e) => /@secures 'workflow:ghost'/.test(e)));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(homeOverride, { recursive: true, force: true });
    if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
  }
});
