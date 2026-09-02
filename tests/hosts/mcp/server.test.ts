/**
 * tests/hosts/mcp/server.test.ts — the MCP protocol over the line transport:
 * initialize, tools/list derived from the definitions, tools/call with typed
 * errors, and a refusal of tools the surface does not carry.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createMcpHandler, serveMcp } from '../../../src/hosts/mcp/server.ts';
import { toolsFor } from '../../../src/kernel/broker/tools.ts';
import { brokerFixture } from '../../kernel/broker/support.ts';

test('initialize, tools/list, tools/call, and errors follow the protocol', async () => {
  const fx = brokerFixture();
  try {
    const handle = createMcpHandler('interactive', fx.broker);
    const init = (await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })) as { result: { serverInfo: { name: string }; protocolVersion: string; instructions: string } };
    assert.equal(init.result.serverInfo.name, 'construct');
    assert.match(init.result.protocolVersion, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(init.result.instructions, /answer plain questions without recording/);
    assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
    const list = (await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as { result: { tools: { name: string; inputSchema: { additionalProperties: boolean } }[] } };
    assert.deepEqual(list.result.tools.map((t) => t.name), toolsFor('interactive').map((t) => t.name));
    assert.ok(list.result.tools.every((t) => t.inputSchema.additionalProperties === false));
    const ok = (await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bootstrap', arguments: {} } })) as { result: { content: { type: string; text: string }[]; structuredContent: { next: string } } };
    assert.equal(ok.result.content[0]!.type, 'text');
    assert.match(ok.result.structuredContent.next, /listen/);
    const badInput = (await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'remember', arguments: { kind: 'decision' } } })) as { error: { code: number; message: string } };
    assert.equal(badInput.error.code, -32602);
    assert.match(badInput.error.message, /"text" is required/);
    const toolError = (await handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'run_status', arguments: { runId: 'nope' } } })) as { result: { isError: boolean; structuredContent: { error: string } } };
    assert.equal(toolError.result.isError, true);
    assert.equal(toolError.result.structuredContent.error, 'no run nope');
    const missing = (await handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'claim_step', arguments: {} } })) as { error: { code: number; message: string } };
    assert.equal(missing.error.code, -32602);
    assert.match(missing.error.message, /no tool named "claim_step" on the interactive surface/);
    const unknown = (await handle({ jsonrpc: '2.0', id: 7, method: 'resources/list' })) as { error: { code: number } };
    assert.equal(unknown.error.code, -32601);
    assert.deepEqual(await handle({ jsonrpc: '2.0', id: 8, method: 'ping' }), { jsonrpc: '2.0', id: 8, result: {} });
  } finally {
    fx.cleanup();
  }
});

test('the headless server names itself and lists only its surface', async () => {
  const fx = brokerFixture('headless');
  try {
    const handle = createMcpHandler('headless', fx.broker);
    const init = (await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })) as { result: { serverInfo: { name: string } } };
    assert.equal(init.result.serverInfo.name, 'construct-runner');
    const list = (await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as { result: { tools: { name: string }[] } };
    assert.deepEqual(list.result.tools.map((t) => t.name).sort(), ['bootstrap', 'claim_step', 'heartbeat', 'run_status', 'submit_work']);
  } finally {
    fx.cleanup();
  }
});

test('the line transport answers in order and survives a parse error', async () => {
  const fx = brokerFixture();
  try {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on('data', (c: Buffer) => chunks.push(c.toString()));
    const served = serveMcp('interactive', fx.broker, stdin, stdout);
    stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
    stdin.write('not json\n');
    stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
    stdin.end();
    await served;
    const replies = chunks.join('').trim().split('\n').map((l) => JSON.parse(l) as { id: unknown; error?: { code: number } });
    assert.deepEqual(replies.map((r) => r.id), [null, 1, 2]);
    assert.equal(replies[0]!.error?.code, -32700);
  } finally {
    fx.cleanup();
  }
});
