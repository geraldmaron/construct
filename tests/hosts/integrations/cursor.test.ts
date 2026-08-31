/**
 * tests/hosts/integrations/cursor.test.ts — Cursor HostIntegrationAdapter.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createCursorIntegrationAdapter } from '../../../src/hosts/integrations/cursor.ts';

test('cursor adapter installs session-bound construct-mcp entry', async () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-cursor-int-'));
  try {
    const adapter = createCursorIntegrationAdapter();
    assert.equal((await adapter.inspect(root)).status, 'absent');
    await adapter.install(root);
    const verify = await adapter.verify(root);
    assert.equal(verify.ok, true);
    const raw = JSON.parse(readFileSync(join(root, '.cursor', 'mcp.json'), 'utf8')) as {
      mcpServers: { 'construct-mcp': { args: string[] } };
    };
    const args = raw.mcpServers['construct-mcp'].args;
    assert.ok(args.includes('serve'));
    assert.ok(args.some((a) => a === '--client=cursor'));
    assert.ok(args.some((a) => a.startsWith('--project=')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
