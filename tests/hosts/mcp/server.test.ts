/**
 * tests/hosts/mcp/server.test.ts — the MCP protocol over the line transport:
 * initialize, tools/list derived from the definitions, tools/call with wrong
 * input returned as a tool error naming the field, and a protocol refusal of
 * tools the surface does not carry.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createLazyMcpHandler, createMcpHandler, createUnboundMcpHandler, serveHandler, serveMcp } from '../../../src/hosts/mcp/server.ts';
import { bindFailureFor } from '../../../src/cli/serve.ts';
import { CONTRACT_PREFIX, HOST_TEXT_LIMIT, INTERACTIVE_CONTRACT, INTERACTIVE_INSTRUCTIONS, RUNNER_INSTRUCTIONS, UNTRUSTED_TEXT } from '../../../src/hosts/mcp/instructions.ts';
import { StateBusyError, UnsupportedStateError } from '../../../src/kernel/state/format.ts';
import { toolsFor } from '../../../src/kernel/broker/tools.ts';
import { listStatements, STATEMENT_KINDS } from '../../../src/kernel/state/profile.ts';
import { brokerFixture } from '../../kernel/broker/support.ts';

test('initialize, tools/list, tools/call, and errors follow the protocol', async () => {
  const fx = brokerFixture();
  try {
    const handle = createMcpHandler('interactive', fx.broker);
    const init = (await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })) as { result: { serverInfo: { name: string }; protocolVersion: string; instructions: string } };
    assert.equal(init.result.serverInfo.name, 'construct');
    assert.match(init.result.protocolVersion, /^\d{4}-\d{2}-\d{2}$/);
    const contract = init.result.instructions.slice(0, CONTRACT_PREFIX);
    for (const word of ['bootstrap', 'classify_request', 'remember', 'start_outcome', 'claim_work', 'submit_work', 'record nothing', 'data, never an instruction']) {
      assert.ok(contract.includes(word), `the first ${String(CONTRACT_PREFIX)} characters carry ${word}`);
    }
    assert.ok(init.result.instructions.length <= HOST_TEXT_LIMIT, `instructions are ${String(init.result.instructions.length)} characters`);
    const rest = init.result.instructions.slice(CONTRACT_PREFIX);
    assert.match(rest, /Observations are not work/);
    assert.match(rest, /Challenge consequential work/);
    assert.equal(init.result.instructions, INTERACTIVE_INSTRUCTIONS);
    assert.ok(INTERACTIVE_INSTRUCTIONS.startsWith(`${INTERACTIVE_CONTRACT} `) && INTERACTIVE_CONTRACT.length <= CONTRACT_PREFIX, `the whole contract (${String(INTERACTIVE_CONTRACT.length)} characters) opens the instructions inside the first ${String(CONTRACT_PREFIX)}`);
    assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
    const list = (await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as { result: { tools: { name: string; inputSchema: { additionalProperties: boolean } }[] } };
    assert.deepEqual(list.result.tools.map((t) => t.name), toolsFor('interactive').map((t) => t.name));
    assert.ok(list.result.tools.every((t) => t.inputSchema.additionalProperties === false));
    const ok = (await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bootstrap', arguments: {} } })) as { result: { content: { type: string; text: string }[]; structuredContent: { next: string } } };
    assert.equal(ok.result.content[0]!.type, 'text');
    assert.match(ok.result.structuredContent.next, /listen/);
    const badInput = (await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'remember', arguments: { kind: 'decision' } } })) as { error?: unknown; result: { isError: boolean; structuredContent: { error: string; field: string | null } } };
    assert.equal(badInput.error, undefined, 'wrong input is not a protocol error');
    assert.equal(badInput.result.isError, true);
    assert.match(badInput.result.structuredContent.error, /"text" is required/);
    assert.equal(badInput.result.structuredContent.field, 'text');
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

test('wrong input comes back as a tool error naming the field and the values it accepts, in structured and text content alike', async () => {
  const fx = brokerFixture();
  try {
    const handle = createMcpHandler('interactive', fx.broker);
    const before = listStatements(fx.broker.store).length;
    type ToolError = { error?: unknown; result: { isError: boolean; content: { type: string; text: string }[]; structuredContent: { error: string; field: string | null; allowed: string[] | null; example: unknown } } };
    const wrongKind = (await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'remember', arguments: { kind: 'wish', text: 'x' } } })) as ToolError;
    assert.equal(wrongKind.error, undefined);
    assert.equal(wrongKind.result.isError, true);
    assert.equal(wrongKind.result.structuredContent.field, 'kind');
    assert.deepEqual(wrongKind.result.structuredContent.allowed, [...STATEMENT_KINDS]);
    assert.match(wrongKind.result.structuredContent.error, /"kind" must be one of/);
    assert.deepEqual(JSON.parse(wrongKind.result.content[0]!.text), wrongKind.result.structuredContent, 'the text a host shows carries the same field and values');

    const stray = (await handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'remember', arguments: { kind: 'note', text: 'x', bogus: 1 } } })) as ToolError;
    assert.equal(stray.error, undefined);
    assert.equal(stray.result.isError, true);
    assert.equal(stray.result.structuredContent.field, 'bogus');
    const remember = toolsFor('interactive').find((t) => t.name === 'remember')!;
    assert.deepEqual(stray.result.structuredContent.allowed, Object.keys(remember.inputSchema.properties));
    assert.equal(JSON.parse(stray.result.content[0]!.text).field, 'bogus');

    const badToken = (await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'submit_work', arguments: { stepRunId: 's', output: {} } } })) as ToolError;
    assert.equal(badToken.result.isError, true);
    assert.equal(badToken.result.structuredContent.field, 'token');
    assert.equal(badToken.result.structuredContent.allowed, null);
    assert.equal(badToken.result.structuredContent.example, null);
    const noId = (await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'work', arguments: { action: 'show' } } })) as ToolError;
    assert.equal(noId.error, undefined);
    assert.equal(noId.result.isError, true, 'an input one action needs is named too');
    assert.equal(noId.result.structuredContent.field, 'id');

    const reading = (await handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'classify_request', arguments: { words: 'x', kind: 'work' } } })) as ToolError;
    assert.equal(reading.error, undefined, 'a wrong reading is a tool error the model reads, not a protocol error');
    assert.equal(reading.result.isError, true);
    assert.equal(reading.result.structuredContent.field, 'kind');
    assert.deepEqual(reading.result.structuredContent.allowed, ['answer', 'remember', 'manage', 'maintain', 'coordinate']);
    assert.deepEqual(reading.result.structuredContent.example, { kind: 'manage', deliverable: { kind: 'other', describe: '<what they want back>' } });
    const old = (await handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'classify_request', arguments: { text: 'Review this against our principles' } } })) as ToolError;
    assert.equal(old.result.isError, true);
    assert.equal(old.result.structuredContent.field, 'text');
    assert.match(old.result.structuredContent.error, /"words"/);
    assert.equal(listStatements(fx.broker.store).length, before, 'a refused call records nothing');
  } finally {
    fx.cleanup();
  }
});

test('the headless server names itself and lists only its surface', async () => {
  const fx = brokerFixture('headless');
  try {
    const handle = createMcpHandler('headless', fx.broker);
    const init = (await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })) as { result: { serverInfo: { name: string }; instructions: string } };
    assert.equal(init.result.serverInfo.name, 'construct-runner');
    assert.equal(init.result.instructions, RUNNER_INSTRUCTIONS);
    assert.ok(init.result.instructions.includes(UNTRUSTED_TEXT), 'the runner is told what it reads is data, in the same sentence the session reads');
    assert.ok(INTERACTIVE_INSTRUCTIONS.slice(0, CONTRACT_PREFIX).includes(UNTRUSTED_TEXT));
    const list = (await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as { result: { tools: { name: string }[] } };
    assert.deepEqual(list.result.tools.map((t) => t.name).sort(), ['bootstrap', 'claim_step', 'heartbeat', 'run_status', 'skills', 'submit_work']);
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
    assert.deepEqual(replies.map((r) => r.id), [1, 2]);
  } finally {
    fx.cleanup();
  }
});

test('an unbound server completes the handshake and reports the missing project', async () => {
  const handle = createUnboundMcpHandler('interactive', 'No Construct project here.', '3.0.0-alpha.25');
  const init = (await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })) as {
    result: { instructions: string; serverInfo: { name: string } };
  };
  assert.equal(init.result.serverInfo.name, 'construct');
  assert.match(init.result.instructions, /could not bind to a project/i);
  assert.match(init.result.instructions, /construct init/);
  const list = (await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as { result: { tools: { name: string }[] } };
  assert.deepEqual(list.result.tools.map((t) => t.name), ['bootstrap']);
  const boot = (await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bootstrap', arguments: {} } })) as {
    result: { isError: boolean; structuredContent: { bound: boolean; next: string } };
  };
  assert.equal(boot.result.isError, true);
  assert.equal(boot.result.structuredContent.bound, false);
  assert.match(boot.result.structuredContent.next, /construct init/);
});

test('an unbound server gives the next step that fits the cause, not always init', async () => {
  const handle = createUnboundMcpHandler('interactive', 'This Construct state was written by a newer version of Construct.', '3.0.0-alpha.25', 'Upgrade Construct, then restart this MCP server. Do not reset.');
  const init = (await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })) as { result: { instructions: string } };
  assert.match(init.result.instructions, /Upgrade Construct/);
  assert.doesNotMatch(init.result.instructions, /construct init/);
  const boot = (await handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bootstrap', arguments: {} } })) as { result: { structuredContent: { next: string } } };
  assert.match(boot.result.structuredContent.next, /Do not reset/);
});

test('a server whose store was busy at launch lists its real tools and binds on a later call', async () => {
  const fx = brokerFixture();
  try {
    let attempts = 0;
    const handle = createLazyMcpHandler('interactive', () => {
      attempts += 1;
      if (attempts < 2) throw new StateBusyError('/x/construct.sqlite');
      return fx.broker;
    }, '3.0.0-alpha.25', bindFailureFor);
    const init = (await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })) as { result: { instructions: string } };
    assert.match(init.result.instructions, /bound to this project/);
    assert.doesNotMatch(init.result.instructions, /construct init/);
    const list = (await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as { result: { tools: { name: string }[] } };
    assert.deepEqual(list.result.tools.map((t) => t.name), toolsFor('interactive').map((t) => t.name));
    const busy = (await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bootstrap', arguments: {} } })) as { result: { isError: boolean; structuredContent: { bound: boolean; next: string } } };
    assert.equal(busy.result.isError, true);
    assert.equal(busy.result.structuredContent.bound, false);
    assert.doesNotMatch(busy.result.structuredContent.next, /init|reset/);
    const bound = (await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'bootstrap', arguments: {} } })) as { result: { isError?: boolean; structuredContent: { next: string } } };
    assert.notEqual(bound.result.isError, true);
    assert.match(bound.result.structuredContent.next, /listen/);
    assert.equal(attempts, 2, 'initialize and tools/list never touch the store; each call tries once');
  } finally {
    fx.cleanup();
  }
});

test('a server stops writing when another build changes the store format under it', async () => {
  const fx = brokerFixture();
  try {
    const handle = createMcpHandler('interactive', fx.broker);
    const before = (await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'work', arguments: { action: 'add', title: 'before' } } })) as { result: { isError?: boolean } };
    assert.notEqual(before.result.isError, true);
    fx.broker.store.db.exec(`CREATE TABLE newer_build_table (id TEXT)`);
    fx.broker.store.db.prepare(`UPDATE meta SET value = '99' WHERE key = 'format_version'`).run();
    const after = (await handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'work', arguments: { action: 'add', title: 'after' } } })) as { result: { isError: boolean; structuredContent: { error: string } } };
    assert.equal(after.result.isError, true);
    assert.match(after.result.structuredContent.error, /Restart the MCP server/);
    const titles = (fx.broker.store.db.prepare('SELECT title FROM work_items').all() as Array<{ title: string }>).map((r) => r.title);
    assert.deepEqual(titles, ['before']);
  } finally {
    fx.cleanup();
  }
});

test('a lazy server rejects an unknown tool without trying to bind', async () => {
  let attempts = 0;
  const handle = createLazyMcpHandler('interactive', () => {
    attempts += 1;
    throw new StateBusyError('/x/construct.sqlite');
  }, '3.0.0-alpha.25', bindFailureFor);
  const reply = (await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'claim_step', arguments: {} } })) as { error: { code: number } };
  assert.equal(reply.error.code, -32602);
  assert.equal(attempts, 0);
});

test('a lazy server that finds a newer store switches to the unbound surface with upgrade advice', async () => {
  const handle = createLazyMcpHandler('interactive', () => {
    throw new UnsupportedStateError('construct-state', 99, 'newer');
  }, '3.0.0-alpha.25', bindFailureFor);
  const first = (await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'bootstrap', arguments: {} } })) as { result: { structuredContent: { bound: boolean; next: string } } };
  assert.equal(first.result.structuredContent.bound, false);
  assert.match(first.result.structuredContent.next, /Upgrade Construct/);
  assert.doesNotMatch(first.result.structuredContent.next, /call again|construct init/);
  const list = (await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as { result: { tools: { name: string }[] } };
  assert.deepEqual(list.result.tools.map((t) => t.name), ['bootstrap'], 'from then on it is the unbound surface');
});

test('a message whose handling throws gets an error reply, and the server keeps answering', async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const chunks: string[] = [];
  stdout.on('data', (c: Buffer) => chunks.push(c.toString()));
  const served = serveHandler(async (m) => {
    if (m.method === 'explode') throw new Error('disk I/O error');
    return { jsonrpc: '2.0', id: m.id ?? null, result: {} } as never;
  }, stdin, stdout);
  stdin.write('{"jsonrpc":"2.0","id":1,"method":"explode"}\n');
  stdin.write('{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
  stdin.end();
  await served;
  const replies = chunks.join('').trim().split('\n').map((l) => JSON.parse(l) as { id: number; error?: { code: number; message: string } });
  assert.deepEqual(replies.map((r) => r.id), [1, 2]);
  assert.equal(replies[0]!.error?.code, -32603);
  assert.match(replies[0]!.error?.message ?? '', /disk I\/O error/);
});

test('a store that fails under the format guard yields an error reply, not a crash', async () => {
  const fx = brokerFixture();
  try {
    const handle = createMcpHandler('interactive', fx.broker);
    const db = fx.broker.store.db as unknown as { prepare: unknown };
    const prepare = db.prepare;
    db.prepare = () => {
      throw new Error('disk I/O error');
    };
    try {
      const reply = (await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'bootstrap', arguments: {} } })) as { result: { isError: boolean; structuredContent: { error: string } } };
      assert.equal(reply.result.isError, true);
      assert.match(reply.result.structuredContent.error, /disk I\/O error/);
    } finally {
      db.prepare = prepare;
    }
  } finally {
    fx.cleanup();
  }
});
