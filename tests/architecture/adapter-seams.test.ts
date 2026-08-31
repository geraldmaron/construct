/**
 * tests/architecture/adapter-seams.test.ts — integration vs execution boundaries.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');

test('HostIntegrationAdapter interface has no invoke method', () => {
  const src = readFileSync(join(ROOT, 'src/kernel/integration/types.ts'), 'utf8');
  const iface = src.slice(src.indexOf('export interface HostIntegrationAdapter'));
  assert.doesNotMatch(iface, /^\s*invoke\b/m);
  assert.doesNotMatch(iface, /\bmodel\??:/);
  assert.match(iface, /\binstall\(/);
  assert.match(iface, /\bverify\(/);
});

test('ExecutionAdapter types do not mention MCP install paths', () => {
  const src = readFileSync(join(ROOT, 'src/kernel/execution/types.ts'), 'utf8');
  assert.doesNotMatch(src, /mcpconfig|writeMcp|install\(/);
  assert.match(src, /ExecutionAdapter/);
  assert.match(src, /\binvoke\b/);
});

test('executionAdapterFromHost bridge does not import MCP install', () => {
  const src = readFileSync(join(ROOT, 'src/kernel/execution/from-host.ts'), 'utf8');
  assert.doesNotMatch(src, /mcpconfig|mergeMcp|integrations\//);
  assert.match(src, /executionAdapterFromHost/);
});
