/**
 * tests/vscode-mcp-toolkit-path.test.mjs
 *
 * A merged .vscode/mcp.json preserves existing server entries so user edits
 * survive a re-sync. mcpEntryPointsOutsideToolkit is the exception that keeps a
 * construct-owned server path from a different toolkit root from being preserved
 * forever — the bug that left VS Code/Copilot launching a deleted checkout and
 * the orchestrator with no construct-mcp tools.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mcpEntryPointsOutsideToolkit } from '../scripts/sync-specialists.mjs';

const ROOT = '/Users/dev/Developer/Projects/construct';

test('a construct toolkit path outside the current root is stale', () => {
  const entry = { command: 'node', args: ['/Users/dev/Git/construct/lib/mcp/server.mjs'] };
  assert.equal(mcpEntryPointsOutsideToolkit(entry, ROOT), true);
});

test('a construct toolkit path under the current root is not stale', () => {
  const entry = { command: 'node', args: [`${ROOT}/lib/mcp/server.mjs`] };
  assert.equal(mcpEntryPointsOutsideToolkit(entry, ROOT), false);
});

test('a user-owned server with no toolkit path is preserved', () => {
  const npx = { command: 'npx', args: ['-y', '@playwright/mcp@latest'] };
  const remote = { type: 'http', url: 'https://example.com/mcp' };
  assert.equal(mcpEntryPointsOutsideToolkit(npx, ROOT), false);
  assert.equal(mcpEntryPointsOutsideToolkit(remote, ROOT), false);
  assert.equal(mcpEntryPointsOutsideToolkit(undefined, ROOT), false);
});

test('the memory bridge path under a foreign root is stale too', () => {
  const entry = { command: 'node', args: ['/opt/old/construct/lib/mcp/memory-bridge.mjs'] };
  assert.equal(mcpEntryPointsOutsideToolkit(entry, ROOT), true);
});
