/**
 * tests/orchestration-doc-authoring-patterns.test.mjs — doc-type drift guard.
 *
 * detectDocAuthoringIntent maps a natural-language request to a docType and
 * then to that docType's canonical owner via ownerForDoc. The docType strings
 * in DOC_AUTHORING_PATTERNS (lib/orchestration/classification.mjs) are owned by
 * the routing registry's knownDocTypes(), but the mapping is hand-maintained —
 * so a docType renamed or removed in the registry leaves a stale pattern that
 * resolves to a null owner, silently dropping the request's canonical author.
 * The guard below asserts every authoring-pattern docType is a known registry
 * doc type (construct-v1wk).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { docAuthoringDocTypes } from '../lib/orchestration/classification.mjs';
import { knownDocTypes } from '../lib/orchestration/routing-tables.mjs';

test('every DOC_AUTHORING_PATTERNS docType is a registry-known doc type', () => {
  const known = new Set(knownDocTypes());
  const orphaned = docAuthoringDocTypes().filter((docType) => !known.has(docType));
  assert.deepEqual(
    orphaned,
    [],
    `authoring patterns reference docType(s) absent from knownDocTypes(): ${orphaned.join(', ')} — `
      + 'rename the pattern to a registered type or register the type in specialists/org.',
  );
});
