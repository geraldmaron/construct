/**
 * tests/functional/mcp-tool-surface-partition.functional.test.mjs — the
 * tool-surface partition invariant wired into MCP server load (construct-tsyfe.9.2).
 *
 * lib/mcp/tool-surface-parity.mjs defines two checks: assertCoreSubsetOfCatalog
 * (every CORE_TOOL_NAMES entry is a real catalog tool) and the stronger
 * assertToolSurfacePartition (the flat core plus the `call` gateway enum
 * together cover the catalog exactly once — no gap, no overlap, no duplicate,
 * no phantom). Only the weaker check was wired into lib/mcp/server.mjs's
 * module-load path; the partition invariant had zero call sites and could not
 * catch a drift between what tools/list advertises and what dispatch actually
 * reaches. This suite (1) boots the real stdio server and asserts its
 * tools/list response is exactly the live flat-core-plus-call-tool partition,
 * with no stale or removed tool present, and (2) proves
 * assertToolSurfacePartition itself is load-bearing by feeding it synthetic
 * gap/overlap/duplicate/phantom fixtures and asserting it throws, naming the
 * offending tool.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';
import { assertToolSurfacePartition } from '../../lib/mcp/tool-surface-parity.mjs';
import { exposedTools, ALL_TOOL_DEFS } from '../../lib/mcp/server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');
const SERVER = path.join(REPO, 'lib', 'mcp', 'server.mjs');

function mcpClient() {
  const child = spawn(process.execPath, [SERVER], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: sterileSpawnEnv({ CX_TOOLKIT_DIR: REPO }),
  });
  const state = { buffer: '', frames: [] };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    state.buffer += chunk;
    let idx;
    while ((idx = state.buffer.indexOf('\n')) >= 0) {
      const raw = state.buffer.slice(0, idx).trim();
      state.buffer = state.buffer.slice(idx + 1);
      if (raw) { try { state.frames.push(JSON.parse(raw)); } catch { /* non-JSON noise */ } }
    }
  });
  const send = (frame) => child.stdin.write(`${JSON.stringify(frame)}\n`);
  const waitFor = (id, timeoutMs = 15_000) => new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const hit = state.frames.find((f) => f.id === id);
      if (hit) return resolve(hit);
      if (Date.now() >= deadline) return reject(new Error(`timeout waiting for id=${id}; frames=${state.frames.length}`));
      setTimeout(tick, 40);
    };
    tick();
  });
  return { send, waitFor, kill: () => { try { child.kill('SIGTERM'); } catch { /* already gone */ } } };
}

test('real MCP server tools/list is exactly the flat-core-plus-call-tool partition, no stale tool present', async () => {
  const expectedFlat = exposedTools().filter((t) => t.name !== 'call').map((t) => t.name).sort();
  const expectedEnum = [...new Set(ALL_TOOL_DEFS.map((t) => t.name))]
    .filter((n) => !expectedFlat.includes(n))
    .sort();

  const c = mcpClient();
  let id = 0;
  try {
    c.send({
      jsonrpc: '2.0', id: ++id, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'partition-test', version: '1' } },
    });
    await c.waitFor(id);
    c.send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    const listId = ++id;
    c.send({ jsonrpc: '2.0', id: listId, method: 'tools/list', params: {} });
    const listed = await c.waitFor(listId);
    const tools = listed.result?.tools ?? [];

    const gateway = tools.find((t) => t.name === 'call');
    assert.ok(gateway, 'construct_call gateway must be exposed');

    const observedFlat = tools.filter((t) => t.name !== 'call').map((t) => t.name).sort();
    const observedEnum = [...(gateway.inputSchema?.properties?.tool?.enum ?? [])].sort();

    assert.deepEqual(observedFlat, expectedFlat, 'tools/list flat surface must equal the live core catalog exactly, no stale/removed tool');
    assert.deepEqual(observedEnum, expectedEnum, 'call gateway enum must equal the live long-tail catalog exactly, no stale/removed tool');

    const surfaced = new Set([...observedFlat, ...observedEnum]);
    assert.equal(surfaced.size, observedFlat.length + observedEnum.length, 'no tool name may be surfaced twice across flat and enum');
  } finally {
    c.kill();
  }
});

test('assertToolSurfacePartition is load-bearing: a synthetic gap throws naming the unreachable tool', () => {
  assert.throws(
    () => assertToolSurfacePartition({
      catalog: new Set(['a', 'b', 'orphan_tool']),
      flat: ['a'],
      enumNames: ['b'],
    }),
    /orphan_tool/,
    'a catalog tool reachable through neither the flat surface nor the call enum must be named in the thrown error',
  );
});

test('assertToolSurfacePartition is load-bearing: a synthetic overlap throws naming the offending tool', () => {
  assert.throws(
    () => assertToolSurfacePartition({
      catalog: new Set(['a', 'b']),
      flat: ['a', 'b'],
      enumNames: ['b'],
    }),
    /flat AND enum.*\bb\b/,
    'a tool surfaced both flat and in the call enum must be named in the thrown error',
  );
});

test('assertToolSurfacePartition is load-bearing: a synthetic duplicate throws naming the offending tool', () => {
  assert.throws(
    () => assertToolSurfacePartition({
      catalog: new Set(['a', 'b']),
      flat: ['a', 'a'],
      enumNames: ['b'],
    }),
    /surfaced twice.*\ba\b/,
    'a tool name surfaced twice within the same list must be named in the thrown error',
  );
});

test('assertToolSurfacePartition is load-bearing: a synthetic phantom throws naming the offending tool', () => {
  assert.throws(
    () => assertToolSurfacePartition({
      catalog: new Set(['a', 'b']),
      flat: ['a', 'ghost_tool'],
      enumNames: ['b'],
    }),
    /ghost_tool/,
    'a surfaced name absent from the catalog must be named in the thrown error',
  );
});
