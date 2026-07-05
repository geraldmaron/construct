/**
 * tests/functional/mcp-dynamic-tool-registration.functional.test.mjs — LMCP-B5.
 *
 * Exercises lib/mcp/tool-registry.mjs's scanToolModules() against real
 * `*.tool.mjs` fixture files written to an isolated tmpdir, proving a tool
 * can self-register (def + handler) without any edit to lib/mcp/server.mjs,
 * and that a tool missing its safety classification fails registration with
 * a clear, attributable error.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanToolModules } from '../../lib/mcp/tool-registry.mjs';

function withFixtureDir(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-mcp-tool-scan-'));
  try {
    for (const [name, contents] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), contents, 'utf8');
    }
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('scanToolModules registers a self-describing fixture tool with no server.mjs edit', async () => {
  await withFixtureDir({
    'ping.tool.mjs': `
      export const TOOL_DEFS = [{
        name: 'fixture_ping',
        description: 'Fixture tool proving self-registration.',
        inputSchema: { type: 'object', properties: {} },
        safety: { class: 'read', filesystem: 'none', network: 'none', process: 'none' },
      }];
      export const TOOL_HANDLERS = {
        fixture_ping: async () => ({ pong: true }),
      };
    `,
    'not-a-tool.mjs': `export const noop = 1;`,
  }, async (dir) => {
    const { defs, handlers, errors } = await scanToolModules({ dir });
    assert.equal(errors.length, 0);
    assert.equal(defs.length, 1);
    assert.equal(defs[0].name, 'fixture_ping');
    assert.deepEqual(defs[0].outputSchema, { type: 'object' });
    assert.ok(handlers.has('fixture_ping'));
    const result = await handlers.get('fixture_ping')({});
    assert.deepEqual(result, { pong: true });
  });
});

test('scanToolModules ignores files without the .tool.mjs suffix', async () => {
  await withFixtureDir({
    'not-a-tool.mjs': `
      export const TOOL_DEFS = [{ name: 'should_not_register', description: 'x', inputSchema: {}, safety: { class: 'read' } }];
      export const TOOL_HANDLERS = { should_not_register: async () => ({}) };
    `,
  }, async (dir) => {
    const { defs, handlers } = await scanToolModules({ dir });
    assert.equal(defs.length, 0);
    assert.equal(handlers.size, 0);
  });
});

test('a tool without a safety classification fails registration with a clear error', async () => {
  await withFixtureDir({
    'unsafe.tool.mjs': `
      export const TOOL_DEFS = [{
        name: 'fixture_unsafe',
        description: 'Missing safety block.',
        inputSchema: { type: 'object', properties: {} },
      }];
      export const TOOL_HANDLERS = {
        fixture_unsafe: async () => ({}),
      };
    `,
  }, async (dir) => {
    await assert.rejects(
      () => scanToolModules({ dir }),
      (err) => {
        assert.match(err.message, /tool-safety/);
        assert.match(err.message, /fixture_unsafe/);
        return true;
      },
    );
  });
});

test('a def naming a tool with no matching handler fails registration', async () => {
  await withFixtureDir({
    'orphan.tool.mjs': `
      export const TOOL_DEFS = [{
        name: 'fixture_orphan',
        description: 'Def with no handler.',
        inputSchema: { type: 'object', properties: {} },
        safety: { class: 'read', filesystem: 'none', network: 'none', process: 'none' },
      }];
      export const TOOL_HANDLERS = {};
    `,
  }, async (dir) => {
    await assert.rejects(
      () => scanToolModules({ dir }),
      /TOOL_HANDLERS has no matching function/,
    );
  });
});

test('the real lib/mcp/tools directory scans cleanly with no self-registered tools yet', async () => {
  const { defs, handlers, errors } = await scanToolModules();
  assert.equal(errors.length, 0);
  assert.equal(defs.length, 0);
  assert.equal(handlers.size, 0);
});
