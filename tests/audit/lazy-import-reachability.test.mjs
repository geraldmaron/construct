/**
 * lazy-import-reachability.test.mjs — static gate for bin/construct lazy imports
 * and construct-jx21v deadcode acceptance for the opt-in Postgres graph adapter.
 *
 * construct --help intercepts before dispatch, so a renamed or removed module
 * targeted by await import() in a handler stays invisible to help smoke until
 * invocation. checkLazyImports resolves every literal specifier without spawning
 * the binary. construct-jx21v: flow resume/status depends on lib/flows/checkpoint.mjs
 * and lib/flows/define.mjs at call time; lib/graph/relational/postgres-store.mjs is
 * documented in scripts/audit/02-deadcode.mjs ACCEPTED_TEST_ONLY (construct-b0nny.21).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { checkLazyImports } from '../../scripts/audit/01-smoke.mjs';
import { runDeadCode } from '../../scripts/audit/02-deadcode.mjs';

test('every static await import in bin/construct resolves to a file', () => {
  const lazy = checkLazyImports();
  assert.equal(
    lazy.broken.length,
    0,
    `broken lazy imports: ${lazy.broken.join(', ') || '(none listed)'}`,
  );
});

test('flow command lazy imports resolve', () => {
  const lazy = checkLazyImports();
  for (const specifier of ['../lib/flows/checkpoint.mjs', '../lib/flows/define.mjs']) {
    assert.ok(!lazy.broken.includes(specifier), `${specifier} must resolve`);
  }
});

test('postgres graph adapter is accepted test-only, not a deadcode finding', () => {
  const target = 'lib/graph/relational/postgres-store.mjs';
  const report = runDeadCode();
  assert.ok(!report.dead.includes(target), `${target} must not be dead`);
  assert.ok(!report.testOnly.includes(target), `${target} must be in ACCEPTED_TEST_ONLY`);
});
