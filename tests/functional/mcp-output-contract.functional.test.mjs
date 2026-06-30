/**
 * tests/functional/mcp-output-contract.functional.test.mjs
 *
 * Tool-output/error contract for the MCP surface (self-audit construct-rr63.6.1, opens the
 * tool-contract-gate). Two parts:
 *   1. the target contract (schemas/mcp-tool-output.schema.json) is well-formed and defines a typed
 *      error vocabulary plus a typed degradation reason shared with the host-capability matrix;
 *   2. characterization of TODAY's behaviour — long-tail tools return an ad-hoc { error: string }
 *      with no code/details, and registry/capabilities.json declares no public web-search capability.
 * The characterization assertions pin the current gap so the Wave-4 migration that adds structured
 * errors / a governed web/search capability (construct-rr63.5.2) is a deliberate, visible change.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { inferDocumentSchemaTool } from '../../lib/mcp/tools/document.mjs';
import { orchestrationRun } from '../../lib/mcp/tools/orchestration-run.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));

test('the output/error contract is well-formed and defines a typed error vocabulary', () => {
  const schema = readJson('schemas/mcp-tool-output.schema.json');
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
  const structured = schema.properties.error.oneOf.find((s) => s.type === 'object');
  assert.ok(structured, 'the error contract offers a structured object form');
  assert.deepEqual(structured.required, ['code', 'message']);
  for (const code of ['INVALID_INPUT', 'NOT_FOUND', 'CAPABILITY_UNAVAILABLE', 'PROVIDER_EXECUTION_FAILED']) {
    assert.ok(structured.properties.code.enum.includes(code), `error code vocabulary includes ${code}`);
  }
});

test('the degradation reason vocabulary is shared with the host capability matrix', () => {
  const schema = readJson('schemas/mcp-tool-output.schema.json');
  for (const reason of ['not-installed', 'config-missing', 'mcp-unresolvable', 'token-unset', 'server-unreachable', 'capability-unavailable']) {
    assert.ok(schema.properties.degradationReason.enum.includes(reason), `degradationReason includes ${reason}`);
  }
});

test('long-tail tools today return an ad-hoc { error: string }, not the structured shape', async () => {
  const infer = await inferDocumentSchemaTool({});
  assert.equal(typeof infer.error, 'string', 'document.infer error is a bare string');
  assert.equal(typeof infer.error === 'object', false, 'no structured error object yet');

  const orch = await orchestrationRun({});
  assert.equal(typeof orch.error, 'string', 'orchestration_run error is a bare string');
  for (const tool of [infer, orch]) {
    assert.ok(!('code' in tool), 'no machine-branchable error code yet');
    assert.ok(!('details' in tool), 'no structured error details yet');
  }
});

test('no public web-search capability is declared today (truthful current state)', () => {
  const caps = readJson('registry/capabilities.json');
  const haystack = JSON.stringify(caps).toLowerCase();
  assert.equal(/web[ _-]?search/.test(haystack), false, 'capabilities.json declares no web search');
  assert.equal(haystack.includes('websearch'), false, 'no websearch tool/capability id');
});
