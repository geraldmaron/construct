/**
 * tests/registry/surface-map.test.mjs — ADR-0039 surface tier assignments.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SURFACE_TIERS, COMMAND_SURFACE, surfaceForCommand } from '../../lib/registry/surface-map.mjs';

test('SURFACE_TIERS excludes the retired dashboard tier', () => {
  assert.ok(!SURFACE_TIERS.includes('dashboard'));
  assert.deepEqual(SURFACE_TIERS, ['agent-mcp', 'thin-cli', 'tui', 'internal']);
});

test('observability command groups map to thin-cli after dashboard retirement', () => {
  for (const name of ['review', 'telemetry', 'evals', 'improvement']) {
    assert.equal(COMMAND_SURFACE[name], 'thin-cli', `${name} should be thin-cli`);
    assert.equal(surfaceForCommand(name), 'thin-cli');
  }
});
