/**
 * tests/hosts/session-attach.test.ts — a file is not a socket.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listsReadyConstructMcp, sessionServeAttach } from '../../src/hosts/session-attach.ts';
import { plantReadyMcpList } from '../harness/attached-serve.ts';

test('construct-mcp: ready is the live list this session can call', () => {
  assert.equal(listsReadyConstructMcp('construct-mcp: ready'), true);
  assert.equal(listsReadyConstructMcp('construct-mcp: error'), false);
  assert.equal(listsReadyConstructMcp('other-mcp: ready'), false);
  assert.equal(listsReadyConstructMcp(''), false);
});

test('cursor without a live list is unavailable — a missing binary is not a wire', () => {
  const attach = sessionServeAttach('cursor', { PATH: '/no-such-host-cli' });
  assert.equal(attach.status, 'unavailable');
});

test('bob has no MCP list probe and never pretends to attach', () => {
  const attach = sessionServeAttach('bob', process.env);
  assert.equal(attach.status, 'unavailable');
});

test('cursor-agent mcp list reporting construct-mcp ready is attached', () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-attach-'));
  try {
    const env = plantReadyMcpList(root, 'cursor-agent');
    const attach = sessionServeAttach('cursor', { ...process.env, ...env });
    assert.equal(attach.status, 'attached');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
