/**
 * tests/kernel/connectors/seam.test.ts — the ladder decides on presence,
 * never on trust, and the evidence class it hands back tells the two apart.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choosePath } from '../../../src/kernel/connectors/seam.ts';

test('a present host MCP surface answers first, and its evidence is reported', () => {
  const verdict = choosePath({ hostMcpAvailable: true, connectorAvailable: true });
  assert.equal(verdict.path, 'host-mcp');
  assert.equal(verdict.evidence, 'reported');
});

test('with no host MCP surface, a present connector answers, and its evidence is witnessed', () => {
  const verdict = choosePath({ hostMcpAvailable: false, connectorAvailable: true });
  assert.equal(verdict.path, 'connector');
  assert.equal(verdict.evidence, 'witnessed');
});

test('neither present is an honest refusal, not a silent nothing', () => {
  const verdict = choosePath({ hostMcpAvailable: false, connectorAvailable: false });
  assert.equal(verdict.path, 'refused');
  assert.equal(verdict.evidence, null);
  assert.match(verdict.reason, /nothing carries this work/);
});

test('a host MCP surface is chosen over a connector on presence, not on which is more trustworthy', () => {
  // The connector's own record would be `witnessed` — the stronger evidence
  // class — and the ladder still answers host-mcp when both are present.
  // Authority order and fidelity order are deliberately not the same axis.
  const verdict = choosePath({ hostMcpAvailable: true, connectorAvailable: true });
  assert.equal(verdict.path, 'host-mcp');
  assert.notEqual(verdict.evidence, 'witnessed', 'host-mcp evidence is reported even though a witnessed path exists');
});
