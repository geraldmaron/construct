/**
 * tests/audit/f02-secrets/sync-template-leak.test.mjs — F02 regression guard for the
 * OpenCode sync-template secret leak.
 *
 * resolveTemplateStrings (scripts/sync-worker-profiles.mjs) must check its secret-suffix
 * guard (TOKEN/SECRET/API_KEY/PUBLIC_KEY/PRIVATE_KEY) before falling back to a raw
 * process.env[name] lookup, so a secret-suffixed placeholder always resolves to
 * OpenCode's `{env:NAME}` reference rather than the live shell value — the same
 * value->ref flip buildLocalEnvironment applies for stdio MCP env. mergeMissingObjectDefaults
 * fills opencode.json's provider defaults straight from resolveTemplateStrings's output,
 * so the guard order determines what reaches disk. writeOpenCodeConfig must also persist
 * opencode.json at 0600, since it can carry a resolved provider apiKey / Authorization
 * header, mirroring lib/env-config.mjs's writeEnvValues contract for config.env.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveTemplateStrings } from '../../../scripts/sync-worker-profiles.mjs';
import { writeOpenCodeConfig } from '../../../lib/opencode-config.mjs';

const POSIX = process.platform !== 'win32';

test('[R12] resolveTemplateStrings never materializes a secret-suffixed placeholder from process.env', () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'sk-test-leak-123';

  try {
    const provider = {
      openrouter: {
        options: {
          headers: { Authorization: 'Bearer __OPENROUTER_API_KEY__' },
        },
      },
    };

    const resolved = resolveTemplateStrings(provider);
    const serialized = JSON.stringify(resolved);

    assert.ok(
      !serialized.includes('sk-test-leak-123'),
      `resolved provider config leaked the live OPENROUTER_API_KEY value: ${serialized}`,
    );
    assert.equal(resolved.openrouter.options.headers.Authorization, 'Bearer {env:OPENROUTER_API_KEY}');
  } finally {
    if (originalKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalKey;
    }
  }
});

test('[R12] writeOpenCodeConfig creates opencode.json with 0600 (no group/world read)', { skip: !POSIX }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f02-opencode-mode-create-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const file = path.join(dir, 'opencode.json');
  writeOpenCodeConfig({ $schema: 'https://opencode.ai/config.json', agent: {}, mcp: {} }, file);

  const mode = fs.statSync(file).mode & 0o777;
  assert.equal(
    mode & 0o077,
    0,
    `opencode.json is group/world-accessible (mode ${mode.toString(8)}); a credential-bearing config must be 0600`,
  );
});

test('[R12] writeOpenCodeConfig tightens a pre-existing world-readable opencode.json on rewrite', { skip: !POSIX }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f02-opencode-mode-rewrite-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const file = path.join(dir, 'opencode.json');
  fs.writeFileSync(file, '{}\n', 'utf8');
  fs.chmodSync(file, 0o644);

  writeOpenCodeConfig({ $schema: 'https://opencode.ai/config.json', agent: {}, mcp: {} }, file);

  const mode = fs.statSync(file).mode & 0o777;
  assert.equal(
    mode & 0o077,
    0,
    `rewrite left opencode.json group/world-accessible (mode ${mode.toString(8)}); the write must re-apply 0600`,
  );
});
