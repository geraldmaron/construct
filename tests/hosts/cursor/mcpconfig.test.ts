/**
 * tests/hosts/cursor/mcpconfig.test.ts — the persistent project registration
 * `construct wire` writes into `.cursor/mcp.json`. Cursor has no
 * per-invocation role write surface (adapter.ts's own header records the
 * gap), so unlike hosts/claude and hosts/opencode this module carries no
 * bearer-disposal test: there is no bearer here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, sep } from 'node:path';
import {
  PROJECT_MCP_SERVER_NAME,
  buildProjectMcpServerEntry,
  projectMcpConfigPath,
} from '../../../src/hosts/cursor/mcpconfig.ts';

test('the project server name matches the Claude host\'s, so an uninstall does not need to know which host wired it', () => {
  assert.equal(PROJECT_MCP_SERVER_NAME, 'construct-mcp');
});

test('the config path is .cursor/mcp.json at the given project root', () => {
  const path = projectMcpConfigPath('/some/repo');
  assert.equal(path, join('/some/repo', '.cursor', 'mcp.json'));
});

test('the entry is bare command+args, matching docs/consumer-install.md\'s verified Cursor example', () => {
  const entry = buildProjectMcpServerEntry({ command: 'node', args: ['/path/to/bin/construct.mjs', 'serve'] });
  assert.deepEqual(entry, { command: 'node', args: ['/path/to/bin/construct.mjs', 'serve'] });
});

test('with no launch override, the entry resolves this Node binary and this checkout\'s bin/construct.mjs, ending in serve', () => {
  const entry = buildProjectMcpServerEntry() as { command: string; args: readonly string[] };
  assert.equal(entry.command, process.execPath);
  assert.ok(entry.args[0]?.endsWith(`${sep}bin${sep}construct.mjs`));
  assert.deepEqual(entry.args.slice(-1), ['serve']);
});
