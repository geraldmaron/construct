/**
 * tests/hosts/integrations/vscode.test.ts — VS Code HostIntegrationAdapter.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createVscodeIntegrationAdapter } from '../../../src/hosts/integrations/vscode.ts';
import { integrationAdapterFor } from '../../../src/hosts/integrations/registry.ts';

test('registry maps vscode to a measured writer', () => {
  assert.equal(integrationAdapterFor('vscode')?.id, 'vscode');
  assert.equal(integrationAdapterFor('vs-code')?.id, 'vscode');
});

test('vscode adapter installs session-bound entry under servers key', async () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-vscode-int-'));
  try {
    const adapter = createVscodeIntegrationAdapter();
    assert.equal((await adapter.inspect(root)).status, 'absent');
    await adapter.install(root);
    const verify = await adapter.verify(root);
    assert.equal(verify.ok, true);
    const raw = JSON.parse(readFileSync(join(root, '.vscode', 'mcp.json'), 'utf8')) as {
      servers: { 'construct-mcp': { type?: string; args: string[] } };
    };
    assert.equal(raw.servers['construct-mcp'].type, 'stdio');
    const args = raw.servers['construct-mcp'].args;
    assert.ok(args.includes('serve'));
    assert.ok(args.some((a) => a === '--client=vscode'));
    assert.ok(args.some((a) => a.startsWith('--project=')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
