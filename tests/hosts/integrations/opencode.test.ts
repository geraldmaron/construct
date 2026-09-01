/**
 * tests/hosts/integrations/opencode.test.ts — OpenCode HostIntegrationAdapter.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createOpencodeIntegrationAdapter } from '../../../src/hosts/integrations/opencode.ts';
import { integrationAdapterFor } from '../../../src/hosts/integrations/registry.ts';

test('registry maps opencode to a documented writer', () => {
  assert.equal(integrationAdapterFor('opencode')?.id, 'opencode');
  assert.equal(integrationAdapterFor('opencode')?.capabilities().maturity, 'documented');
});

test('opencode adapter installs session-bound entry under mcp key', async () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-opencode-int-'));
  try {
    const adapter = createOpencodeIntegrationAdapter();
    assert.equal((await adapter.inspect(root)).status, 'absent');
    await adapter.install(root);
    const verify = await adapter.verify(root);
    assert.equal(verify.ok, true);
    const raw = JSON.parse(readFileSync(join(root, 'opencode.json'), 'utf8')) as {
      $schema?: string;
      mcp: {
        'construct-mcp': {
          type?: string;
          enabled?: boolean;
          command: string[];
        };
      };
    };
    assert.equal(raw.$schema, 'https://opencode.ai/config.json');
    assert.equal(raw.mcp['construct-mcp'].type, 'local');
    assert.equal(raw.mcp['construct-mcp'].enabled, true);
    const command = raw.mcp['construct-mcp'].command;
    assert.ok(command.includes('serve'));
    assert.ok(command.some((a) => a === '--client=opencode'));
    assert.ok(command.some((a) => a.startsWith('--project=')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('opencode merge preserves unrelated mcp servers', async () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-opencode-merge-'));
  try {
    writeFileSync(
      join(root, 'opencode.json'),
      `${JSON.stringify(
        {
          $schema: 'https://opencode.ai/config.json',
          mcp: {
            context7: { type: 'remote', url: 'https://mcp.context7.com/mcp' },
          },
        },
        null,
        2,
      )}\n`,
    );
    const adapter = createOpencodeIntegrationAdapter();
    await adapter.install(root);
    const raw = JSON.parse(readFileSync(join(root, 'opencode.json'), 'utf8')) as {
      mcp: Record<string, unknown>;
    };
    assert.ok(raw.mcp.context7);
    assert.ok(raw.mcp['construct-mcp']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
