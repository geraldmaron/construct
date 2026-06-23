/**
 * tests/mcp-artifact-workflow.test.mjs — MCP workflow provenance envelope.
 *
 * MCP planning must not claim host specialist execution as local completion.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { artifactWorkflow } from '../lib/mcp/tools/embedded-contract.mjs';

test('MCP artifact workflow returns a contract envelope with truthful provenance', () => {
  const result = artifactWorkflow({ input: 'Review this ADR and create a customer PDF.' });
  assert.equal(result.contractVersion, '1.1.0');
  assert.equal(result.data.kind, 'artifact-workflow-run');
  assert.deepEqual(result.data.executedSteps, []);
  assert.ok(result.data.skippedSteps.some((step) => step.id === 'review'));
});
