/**
 * tests/hosts/claude/project-mcpconfig.test.ts — the persistent project
 * registration `construct wire` writes into `.mcp.json`, distinct from the
 * per-invocation role config asserted in tests/hosts/claude/adapter.test.ts.
 * The shape here matches docs/consumer-install.md's verified example: bare
 * command/args, no `type`, no `env` — there is no bearer for this file to
 * protect.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sep } from 'node:path';
import {
  PROJECT_MCP_SERVER_NAME,
  buildProjectMcpServerEntry,
  projectMcpConfigPath,
} from '../../../src/hosts/claude/mcpconfig.ts';

test('the project server name matches what kernel/cleanup/catalog.ts already knows to un-merge', () => {
  assert.equal(PROJECT_MCP_SERVER_NAME, 'construct-mcp');
});

test('the config path is .mcp.json at the given project root', () => {
  const path = projectMcpConfigPath('/some/repo');
  assert.equal(path, `/some/repo${sep}.mcp.json`);
});

test('the entry is bare command+args — no type, no env, matching docs/consumer-install.md', () => {
  const entry = buildProjectMcpServerEntry({ command: '/usr/bin/node', args: ['/path/to/bin/construct.mjs', 'serve'] });
  assert.deepEqual(entry, { command: '/usr/bin/node', args: ['/path/to/bin/construct.mjs', 'serve'] });
  assert.equal('type' in entry, false, 'this file carries no bearer, and no schema needs the role hint');
  assert.equal('env' in entry, false);
});

test('with no launch override, the entry resolves this Node binary and this checkout\'s bin/construct.mjs, ending in serve', () => {
  const entry = buildProjectMcpServerEntry() as { command: string; args: readonly string[] };
  assert.equal(entry.command, process.execPath);
  assert.ok(entry.args[0]?.endsWith(`${sep}bin${sep}construct.mjs`), 'points at this checkout\'s launcher');
  assert.deepEqual(entry.args.slice(-1), ['serve'], 'the projection, never role-serve or dispatch');
});
