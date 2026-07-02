/**
 * tests/mcp-stale-managed-reconcile.test.mjs — the second-pass reconcile that
 * rewrites immortal stale MCP entries.
 *
 * The host sync loops only visit the current sync set, so a construct-managed but
 * out-of-set entry (e.g. `memory`) with a stale toolkit path is never revisited.
 * reconcileStaleManagedEntries rewrites those in place — guarded by both
 * construct-ownership AND a stale toolkit path, so an unmanaged/user entry is never
 * touched — and is idempotent (a second pass finds nothing stale).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { reconcileStaleManagedEntries } from '../scripts/sync-specialists.mjs';
import { buildClaudeMcpEntry } from '../lib/mcp-platform-config.mjs';

const rebuild = (id, def) => buildClaudeMcpEntry(id, def, process.env, { host: 'vscode' });

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
