/**
 * tests/graph/staleness.test.mjs — graph seed-hash staleness helper.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { checkGraphStaleness, GRAPH_SEED_FILES } from '../../lib/graph/staleness.mjs';

test('GRAPH_SEED_FILES lists registry contracts and workflow defs', () => {
  assert.ok(GRAPH_SEED_FILES.includes('registry/capabilities.json'));
  assert.ok(GRAPH_SEED_FILES.includes('specialists/unified-registry.json'));
});

test('checkGraphStaleness reports absent graph without throwing', () => {
  const state = checkGraphStaleness('/tmp/construct-staleness-missing-graph');
  assert.equal(state.present, false);
  assert.equal(state.stale, false);
});
