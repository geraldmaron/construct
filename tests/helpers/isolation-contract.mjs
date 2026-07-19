/**
 * tests/helpers/isolation-contract.mjs — shared assertions for functional test isolation.
 *
 * Functional tests must keep durable writes under the fixture root (tmpdir), never
 * the developer's real HOME, ~/.cx, or repo profiles/. Use assertPathUnderRoot
 * after any API that resolves project-scoped or user-scoped storage paths.
 */

import assert from 'node:assert/strict';
import path from 'node:path';

export function assertPathUnderRoot(absolutePath, root, label = 'artifact path') {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(absolutePath);
  const rel = path.relative(resolvedRoot, resolvedPath);
  assert.ok(
    rel && !rel.startsWith('..') && !path.isAbsolute(rel),
    `${label} must stay under fixture root ${resolvedRoot}; got ${resolvedPath}`,
  );
}

export function isolationEnv(homeRoot, extra = {}) {
  return {
    ...process.env,
    HOME: homeRoot,
    CONSTRUCT_HOME_OVERRIDE: homeRoot,
    ...extra,
  };
}
