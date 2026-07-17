/**
 * tests/mcp-tool-schema-validate.test.mjs — unit coverage for
 * lib/mcp/tool-schema-validate.mjs and its wiring into
 * lib/mcp/dispatch-envelope.mjs's createToolCallHandler (construct-tsyfe.9.1).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateToolInput, validateToolOutput, DEFAULT_MAX_STRING_LENGTH, DEFAULT_MAX_ARRAY_LENGTH } from '../lib/mcp/tool-schema-validate.mjs';
import { createToolCallHandler } from '../lib/mcp/dispatch-envelope.mjs';

const SAMPLE_DEF = Object.freeze({
  name: 'sample_tool',
  inputSchema: Object.freeze({
    type: 'object',
    required: ['name'],
    properties: { name: { type: 'string' }, count: { type: 'number' } },
  }),
  outputSchema: Object.freeze({
    type: 'object',
    required: ['ok'],
    properties: { ok: { type: 'boolean' } },
  }),
});

describe('validateToolInput', () => {
  it('accepts input matching the declared schema', () => {
    const outcome = validateToolInput(SAMPLE_DEF, { name: 'x' });
    assert.equal(outcome.valid, true);
    assert.deepEqual(outcome.errors, []);
  });

  it('rejects input missing a required field', () => {
    const outcome = validateToolInput(SAMPLE_DEF, {});
    assert.equal(outcome.valid, false);
    assert.ok(outcome.errors.length > 0);
  });

  it('rejects input with a wrong-typed field', () => {
    const outcome = validateToolInput(SAMPLE_DEF, { name: 'x', count: 'not-a-number' });
    assert.equal(outcome.valid, false);
  });

  it('treats a def with no inputSchema as accepting anything', () => {
    const outcome = validateToolInput({ name: 'no_schema_tool' }, { anything: 'goes' });
    assert.equal(outcome.valid, true);
  });

  it('flags an oversized string even when the schema itself sets no maxLength', () => {
    const outcome = validateToolInput(SAMPLE_DEF, { name: 'x'.repeat(DEFAULT_MAX_STRING_LENGTH + 1) });
    assert.equal(outcome.valid, false);
    assert.ok(outcome.errors.some((e) => e.includes('exceeds')));
  });

  it('flags an oversized array even when the schema itself sets no maxItems', () => {
    const outcome = validateToolInput(
      { inputSchema: { type: 'object', properties: { items: { type: 'array' } } } },
      { items: new Array(DEFAULT_MAX_ARRAY_LENGTH + 1).fill('x') },
    );
    assert.equal(outcome.valid, false);
  });
});

describe('validateToolOutput', () => {
  it('accepts output matching the declared schema', () => {
    const outcome = validateToolOutput(SAMPLE_DEF, { ok: true });
    assert.equal(outcome.valid, true);
  });

  it('rejects output missing a required field', () => {
    const outcome = validateToolOutput(SAMPLE_DEF, { unrelated: 1 });
    assert.equal(outcome.valid, false);
  });

  it('treats a def with no outputSchema as accepting anything', () => {
    const outcome = validateToolOutput({ name: 'no_schema_tool' }, 'anything');
    assert.equal(outcome.valid, true);
  });
});

describe('createToolCallHandler schema enforcement', () => {
  function makeHandler({ dispatchToolByName, toolDefsByName }) {
    return createToolCallHandler({
      ROOT_DIR: process.cwd(),
      DEPLOYMENT_MODE: 'solo',
      dispatchToolByName,
      toolDefsByName,
    });
  }

  it('rejects malformed input before the handler runs, on the direct CallTool path (not just via the call gateway)', async () => {
    let dispatchCalled = false;
    const handler = makeHandler({
      dispatchToolByName: async () => { dispatchCalled = true; return { ok: true }; },
      toolDefsByName: new Map([['sample_tool', SAMPLE_DEF]]),
    });

    const response = await handler({ params: { name: 'sample_tool', arguments: {} } });
    assert.equal(dispatchCalled, false, 'the handler must never run when input fails schema validation');
    assert.equal(response.structuredContent.error.code, 'INVALID_INPUT');
  });

  it('replaces a handler result that violates its declared outputSchema with a typed INTERNAL error, logging the mismatch', async () => {
    const handler = makeHandler({
      dispatchToolByName: async () => ({ wrong: 'shape' }),
      toolDefsByName: new Map([['sample_tool', SAMPLE_DEF]]),
    });

    const originalError = console.error;
    let logged = '';
    console.error = (...parts) => { logged += parts.join(' '); };
    try {
      const response = await handler({ params: { name: 'sample_tool', arguments: { name: 'x' } } });
      assert.equal(response.structuredContent.error.code, 'INTERNAL');
      assert.ok(logged.includes('sample_tool'), 'the output-schema mismatch must be logged, not silently passed through');
    } finally {
      console.error = originalError;
    }
  });

  it('does not hold a broker awaiting_approval envelope to the tool outputSchema', async () => {
    const handler = makeHandler({
      dispatchToolByName: async () => ({ status: 'awaiting_approval', approvalId: 'abc' }),
      toolDefsByName: new Map([['sample_tool', SAMPLE_DEF]]),
    });

    const response = await handler({ params: { name: 'sample_tool', arguments: { name: 'x' } } });
    assert.equal(response.structuredContent.status, 'awaiting_approval');
    assert.equal(response.structuredContent.error, undefined);
  });

  it('does not hold a dispatch-level error envelope to the tool outputSchema', async () => {
    const handler = makeHandler({
      dispatchToolByName: async () => ({ error: 'some underlying failure' }),
      toolDefsByName: new Map([['sample_tool', SAMPLE_DEF]]),
    });

    const response = await handler({ params: { name: 'sample_tool', arguments: { name: 'x' } } });
    assert.equal(response.structuredContent.error, 'some underlying failure');
  });

  it('a tool absent from toolDefsByName dispatches unchanged (no partial-coverage crash)', async () => {
    let dispatchCalled = false;
    const handler = makeHandler({
      dispatchToolByName: async () => { dispatchCalled = true; return { ok: true }; },
      toolDefsByName: new Map(),
    });

    const response = await handler({ params: { name: 'unregistered_tool', arguments: { anything: true } } });
    assert.equal(dispatchCalled, true);
    assert.deepEqual(response.structuredContent, { ok: true });
  });
});
