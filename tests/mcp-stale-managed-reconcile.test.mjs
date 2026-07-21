/**
 * tests/mcp-stale-managed-reconcile.test.mjs — the second-pass reconcile that
 * rewrites immortal stale MCP entries.
 *
 * The host sync loops only visit the current sync set, so a construct-managed but
 * out-of-set entry (e.g. `memory`) with a stale toolkit path is never revisited.
 * reconcileStaleManagedEntries rewrites those in place — guarded by both
 * construct-ownership AND a stale toolkit path, so an unmanaged/user entry is never
 * touched — and is idempotent (a second pass finds nothing stale). `mapId` covers
 * OpenCode, whose config.mcp is keyed by getOpenCodeMcpId(id) rather than the
 * catalog id, and both stale checks also cover OpenCode's `command`/`environment`
 * entry shape.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { reconcileStaleManagedEntries } from '../scripts/sync-worker-profiles.mjs';
import { buildClaudeMcpEntry, buildOpenCodeMcpEntry } from '../lib/mcp-platform-config.mjs';

const rebuild = (id, def) => buildClaudeMcpEntry(id, def, process.env, { host: 'vscode' });
const rebuildOpenCode = (id, def) => buildOpenCodeMcpEntry(id, def, process.env).entry;

test('rewrites a stale managed out-of-toolkit entry and leaves an unmanaged entry untouched', () => {
  const config = {
    memory: { command: 'node', args: ['/old/checkout/lib/mcp/memory.mjs'] },
    'my-tool': { command: 'npx', args: ['-y', 'my-unrelated-tool'] },
  };
  const userEntryBefore = structuredClone(config['my-tool']);
  const staleMemoryBefore = structuredClone(config.memory);

  const changed = reconcileStaleManagedEntries(config, { registryMcp: {}, rebuildEntry: rebuild });

  assert.equal(changed, true, 'a stale managed entry was rewritten');
  assert.deepEqual(config['my-tool'], userEntryBefore, 'the unmanaged user entry is untouched');
  assert.notDeepEqual(config.memory, staleMemoryBefore, 'the stale memory entry was rewritten');
});

test('does not touch an entry already in the current sync set (first pass owns it)', () => {
  const config = { memory: { command: 'node', args: ['/old/checkout/lib/mcp/memory.mjs'] } };
  const before = structuredClone(config.memory);
  const changed = reconcileStaleManagedEntries(config, { registryMcp: { memory: {} }, rebuildEntry: rebuild });
  assert.equal(changed, false);
  assert.deepEqual(config.memory, before);
});

test('is idempotent — a second pass over rewritten entries changes nothing', () => {
  const config = { memory: { command: 'node', args: ['/old/checkout/lib/mcp/memory.mjs'] } };
  assert.equal(reconcileStaleManagedEntries(config, { registryMcp: {}, rebuildEntry: rebuild }), true);
  assert.equal(reconcileStaleManagedEntries(config, { registryMcp: {}, rebuildEntry: rebuild }), false, 'second pass is a no-op');
});

test('rewrites a memory entry whose port disagrees with the allocated port (split-brain)', () => {
  const saved = process.env.MEMORY_PORT;
  process.env.MEMORY_PORT = '9901';
  try {
    const config = { memory: { type: 'http', url: 'http://127.0.0.1:8765/' } };
    const changed = reconcileStaleManagedEntries(config, { registryMcp: {}, rebuildEntry: rebuild });
    assert.equal(changed, true, 'a memory entry whose port differs from the allocated one is stale');
    assert.doesNotMatch(JSON.stringify(config.memory), /:8765\b/, 'the rewritten entry drops the disagreeing port');
    assert.match(JSON.stringify(config.memory), /9901/, 'the rewritten entry uses the allocated port');
  } finally {
    if (saved === undefined) delete process.env.MEMORY_PORT;
    else process.env.MEMORY_PORT = saved;
  }
});

test('rewrites a memory entry whose bridge script path does not exist', () => {
  const config = { memory: { command: 'node', args: ['/gone/lib/mcp/memory-bridge.mjs'] } };
  const changed = reconcileStaleManagedEntries(config, { registryMcp: {}, rebuildEntry: rebuild });
  assert.equal(changed, true, 'a memory entry pointing at a missing bridge script is stale');
});

test('rewrites a stale OpenCode-shaped entry (command array, not args) outside the sync set', () => {
  const config = {
    memory: { type: 'local', command: ['node', '/old/checkout/lib/mcp/memory-bridge.mjs'], environment: {} },
    'my-tool': { type: 'local', command: ['npx', '-y', 'my-unrelated-tool'] },
  };
  const userEntryBefore = structuredClone(config['my-tool']);

  const changed = reconcileStaleManagedEntries(config, { registryMcp: {}, rebuildEntry: rebuildOpenCode });

  assert.equal(changed, true, 'a stale OpenCode-shaped managed entry was rewritten');
  assert.deepEqual(config['my-tool'], userEntryBefore, 'the unmanaged user entry is untouched');
  assert.ok(Array.isArray(config.memory.command), 'rewritten entry keeps the OpenCode command-array shape');
  assert.ok(!config.memory.command.some((a) => typeof a === 'string' && a.includes('/old/checkout/')), 'stale path was replaced');
});

test('rewrites an OpenCode-shaped memory entry whose port disagrees, via `environment` not `env`', () => {
  const saved = process.env.MEMORY_PORT;
  process.env.MEMORY_PORT = '9902';
  try {
    const config = { memory: { type: 'local', command: ['node', 'memory-bridge.mjs'], environment: { CONSTRUCT_MEMORY_BRIDGE_URL: 'http://127.0.0.1:8765/' } } };
    const changed = reconcileStaleManagedEntries(config, { registryMcp: {}, rebuildEntry: rebuildOpenCode });
    assert.equal(changed, true, 'a port mismatch inside `environment` (OpenCode shape) is detected as stale');
    assert.match(JSON.stringify(config.memory), /9902/, 'the rewritten entry uses the allocated port');
  } finally {
    if (saved === undefined) delete process.env.MEMORY_PORT;
    else process.env.MEMORY_PORT = saved;
  }
});

test('mapId translates a host config key to the catalog id without renaming the entry', () => {
  const config = {
    mem_srv: { type: 'local', command: ['node', '/old/checkout/lib/mcp/memory-bridge.mjs'], environment: {} },
  };
  const mapId = (key) => (key === 'mem_srv' ? 'memory' : key);

  const changed = reconcileStaleManagedEntries(config, { registryMcp: {}, mapId, rebuildEntry: rebuildOpenCode });

  assert.equal(changed, true, 'the entry is reconciled once its host key is mapped back to the catalog id');
  assert.ok('mem_srv' in config, 'the rewrite stays under the original host key, never renamed');
  assert.ok(!('memory' in config), 'no new key is seeded under the catalog id');
});

test('mapId respects the sync set: a mapped id already in registryMcp is left to the first pass', () => {
  const config = { mem_srv: { type: 'local', command: ['node', '/old/checkout/lib/mcp/memory-bridge.mjs'], environment: {} } };
  const before = structuredClone(config.mem_srv);
  const mapId = (key) => (key === 'mem_srv' ? 'memory' : key);

  const changed = reconcileStaleManagedEntries(config, { registryMcp: { memory: {} }, mapId, rebuildEntry: rebuildOpenCode });

  assert.equal(changed, false, 'memory is in the sync set once mapped, so the second pass skips it');
  assert.deepEqual(config.mem_srv, before);
});
