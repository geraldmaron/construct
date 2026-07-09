/**
 * tests/audit/f02-secrets/resolver-bypass-consumers.test.mjs — secret-resolver bypass regression.
 *
 * Pins the targeted provider-key consumers so unresolved `op://` refs never count as
 * configured and never reach HTTP headers or child-process env handoffs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { rmTmpDir } from '../../helpers/cleanup.mjs';

const UNRESOLVED_REF = 'op://vault/item/field';
const BAD_PATH = path.join(os.tmpdir(), 'cx-no-op-bin');

async function withPatchedEnv(vars, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withPatchedCwd(nextCwd, fn) {
  const previous = process.cwd();
  process.chdir(nextCwd);
  try {
    return await fn();
  } finally {
    process.chdir(previous);
  }
}

test('resolver-bypass consumers treat unresolved op:// refs as not configured and do not transmit them', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f02-resolver-bypass-'));
  const fakeHome = path.join(tmpRoot, 'home');
  const toolkitDir = path.join(tmpRoot, 'toolkit');
  const projectDir = path.join(tmpRoot, 'project');
  const repoRoot = path.resolve(process.cwd());
  const constructBinDir = path.join(toolkitDir, 'bin');
  const constructMarker = path.join(tmpRoot, 'construct-invoked');
  const sampleFile = path.join(projectDir, 'sample.txt');

  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(constructBinDir, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(sampleFile, 'hello from schema infer\n', 'utf8');
  fs.writeFileSync(
    path.join(constructBinDir, 'construct'),
    `#!/bin/sh\nprintf 'called' > "${constructMarker}"\n`,
    { mode: 0o755 },
  );

  t.after(() => {
    rmTmpDir(tmpRoot);
  });

  const fetchCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    fetchCalls.push({
      url: String(url),
      headers: Object.fromEntries(Object.entries(init.headers || {}).map(([key, value]) => [key, String(value)])),
    });
    throw new Error('network should not be attempted');
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await withPatchedEnv({
    PATH: BAD_PATH,
    HOME: fakeHome,
    ANTHROPIC_API_KEY: UNRESOLVED_REF,
    OPENROUTER_API_KEY: UNRESOLVED_REF,
    OPENAI_API_KEY: UNRESOLVED_REF,
    CONSTRUCT_INTENT_VERIFY: undefined,
    XDG_CONFIG_HOME: path.join(fakeHome, '.config'),
  }, () => withPatchedCwd(projectDir, async () => {
    // Clear secret cache to ensure op:// refs are not resolved from previous tests
    const { __clearSecretCache } = await import('../../../lib/providers/secret-resolver.mjs');
    __clearSecretCache();
    
    const { embed } = await import(`../../../lib/storage/embeddings-openai.mjs?ts=${Date.now()}`);
    const { extractViaProvider } = await import(`../../../lib/ingest/provider-extract.mjs?ts=${Date.now()}`);

    await assert.rejects(
      () => embed('embed this'),
      /OPENAI_API_KEY required for OpenAI embeddings/,
    );

    await assert.rejects(
      () => extractViaProvider({
        filePath: sampleFile,
        model: 'openai/gpt-4o-mini',
        provider: 'openrouter',
        env: process.env,
        fetchImpl: globalThis.fetch,
      }),
      (error) => error?.code === 'PROVIDER_KEY_MISSING',
    );
  }));

  const hook = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'lib/hooks/model-fallback.mjs')],
    {
      cwd: projectDir,
      env: {
        ...process.env,
        PATH: BAD_PATH,
        HOME: fakeHome,
        XDG_CONFIG_HOME: path.join(fakeHome, '.config'),
        OPENROUTER_API_KEY: UNRESOLVED_REF,
        CX_TOOLKIT_DIR: toolkitDir,
      },
      input: JSON.stringify({ error: { message: '429 rate limit', provider: 'openrouter' } }),
      encoding: 'utf8',
    },
  );

  assert.equal(hook.status, 0, hook.stderr);
  assert.match(hook.stderr, /No fallback candidate and no OpenRouter API key/);
  assert.equal(fs.existsSync(constructMarker), false, 'hook should not launch construct when the key is only an unresolved op:// ref');

  assert.equal(fetchCalls.length, 0, 'no network call should be attempted when provider keys are unresolved refs');
  assert.equal(fetchCalls.some((call) => Object.values(call.headers).some((value) => value.includes('op://'))), false);

  const sources = [
    'lib/intent-classifier.mjs',
    'lib/schema-infer.mjs',
    'lib/storage/embeddings-openai.mjs',
    'lib/hooks/model-fallback.mjs',
    'lib/ingest/provider-extract.mjs',
  ];
  for (const file of sources) {
    const source = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
    assert.match(source, /secret-resolver/, `${file} should import the secret resolver`);
    assert.doesNotMatch(
      source,
      /process\.env\.(ANTHROPIC|OPENROUTER|OPENAI)_API_KEY/,
      `${file} should not read provider keys directly from process.env`,
    );
  }
});
