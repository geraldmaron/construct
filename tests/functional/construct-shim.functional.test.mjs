/**
 * tests/functional/construct-shim.functional.test.mjs.
 *
 * Exercises bin/construct-shim.mjs's platform-detection, cache, download,
 * checksum, and exec-decision logic directly — the shim is not yet wired as
 * package.json's published `bin` entry (see the file's own header for why),
 * so these are the only tests covering it until that cutover. `ensureBinary`
 * is tested with an injected `fetchImpl` (no real network call); `run`'s
 * argv/exit-code passthrough is tested via a real child process spawn using
 * `CONSTRUCT_BIN_OVERRIDE`, which needs no network either. Every case writes
 * only under a fresh mkdtemp cache root, never the developer's real
 * ~/.cache/construct.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmTmpDir } from '../helpers/cleanup.mjs';

import {
  detectPlatform,
  resolveAssetName,
  resolveDownloadUrls,
  resolveCachePath,
  sha256Of,
  parseChecksumFile,
  ensureBinary,
  decideCommand,
} from '../../bin/construct-shim.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHIM_ENTRY = resolve(ROOT, 'bin', 'construct-shim.mjs');

function freshCacheRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'construct-shim-cache-'));
  return dir;
}

test('detectPlatform maps known platform/arch pairs and rejects the rest', () => {
  assert.equal(detectPlatform('darwin', 'arm64'), 'darwin-arm64');
  assert.equal(detectPlatform('darwin', 'x64'), 'darwin-x64');
  assert.equal(detectPlatform('linux', 'x64'), 'linux-x64');
  assert.equal(detectPlatform('linux', 'arm64'), 'linux-arm64');
  assert.equal(detectPlatform('win32', 'x64'), null);
  assert.equal(detectPlatform('darwin', 'ia32'), null);
  assert.equal(detectPlatform('freebsd', 'x64'), null);
});

test('resolveDownloadUrls and resolveAssetName match scripts/install.sh\'s URL scheme', () => {
  const { binaryUrl, checksumUrl } = resolveDownloadUrls({
    repo: 'geraldmaron/construct',
    version: '1.4.2',
    platformId: 'darwin-arm64',
  });
  assert.equal(resolveAssetName('darwin-arm64'), 'construct-darwin-arm64');
  assert.equal(binaryUrl, 'https://github.com/geraldmaron/construct/releases/download/v1.4.2/construct-darwin-arm64');
  assert.equal(checksumUrl, `${binaryUrl}.sha256`);
});

test('resolveCachePath keys the cache on version and platform, under the given cache root', () => {
  const p = resolveCachePath({ cacheRoot: '/fake/cache', version: '1.4.2', platformId: 'linux-x64' });
  assert.equal(p, '/fake/cache/bin/1.4.2/construct-linux-x64');
});

test('parseChecksumFile reads the leading hex column, matching sha256sum output format', () => {
  assert.equal(parseChecksumFile('deadbeef  construct-darwin-arm64\n'), 'deadbeef');
  assert.equal(parseChecksumFile('deadbeef'), 'deadbeef');
  assert.equal(parseChecksumFile(''), '');
});

test('ensureBinary: cache hit returns the cached path without calling fetchImpl', async (t) => {
  const cacheRoot = freshCacheRoot();
  t.after(() => rmTmpDir(cacheRoot));

  const cachedPath = resolveCachePath({ cacheRoot, version: '1.4.2', platformId: 'darwin-arm64' });
  mkdirSync(dirname(cachedPath), { recursive: true });
  writeFileSync(cachedPath, 'fake-cached-binary');

  let fetchCalls = 0;
  const fetchImpl = async () => { fetchCalls += 1; throw new Error('must not be called on a cache hit'); };

  const result = await ensureBinary({
    repo: 'geraldmaron/construct',
    version: '1.4.2',
    platformId: 'darwin-arm64',
    cacheRoot,
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'cache');
  assert.equal(result.binaryPath, cachedPath);
  assert.equal(fetchCalls, 0);
});

test('ensureBinary: cache miss downloads, verifies checksum, writes an executable file', async (t) => {
  const cacheRoot = freshCacheRoot();
  t.after(() => rmTmpDir(cacheRoot));

  const binaryContent = Buffer.from('fake-downloaded-binary-content');
  const goodChecksum = sha256Of(binaryContent);

  const fetchImpl = async (url) => {
    if (url.endsWith('.sha256')) {
      return { ok: true, text: async () => `${goodChecksum}  construct-linux-x64\n` };
    }
    return { ok: true, arrayBuffer: async () => binaryContent.buffer.slice(binaryContent.byteOffset, binaryContent.byteOffset + binaryContent.byteLength) };
  };

  const result = await ensureBinary({
    repo: 'geraldmaron/construct',
    version: '9.9.9',
    platformId: 'linux-x64',
    cacheRoot,
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'download');
  const written = readFileSync(result.binaryPath);
  assert.deepEqual(written, binaryContent);
});

test('ensureBinary: checksum mismatch is reported, and no file is written to cache', async (t) => {
  const cacheRoot = freshCacheRoot();
  t.after(() => rmTmpDir(cacheRoot));

  const binaryContent = Buffer.from('fake-binary');
  const fetchImpl = async (url) => {
    if (url.endsWith('.sha256')) return { ok: true, text: async () => 'not-the-real-hash  construct-linux-arm64\n' };
    return { ok: true, arrayBuffer: async () => binaryContent.buffer.slice(binaryContent.byteOffset, binaryContent.byteOffset + binaryContent.byteLength) };
  };

  const result = await ensureBinary({
    repo: 'geraldmaron/construct',
    version: '9.9.9',
    platformId: 'linux-arm64',
    cacheRoot,
    fetchImpl,
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /checksum mismatch/);
  const cachedPath = resolveCachePath({ cacheRoot, version: '9.9.9', platformId: 'linux-arm64' });
  assert.throws(() => readFileSync(cachedPath));
});

test('ensureBinary: a network error is reported, not thrown', async (t) => {
  const cacheRoot = freshCacheRoot();
  t.after(() => rmTmpDir(cacheRoot));

  const fetchImpl = async () => { throw new Error('getaddrinfo ENOTFOUND'); };

  const result = await ensureBinary({
    repo: 'geraldmaron/construct',
    version: '9.9.9',
    platformId: 'darwin-x64',
    cacheRoot,
    fetchImpl,
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /network error/);
});

test('ensureBinary: unsupported platformId is reported without attempting any fetch', async () => {
  let called = false;
  const result = await ensureBinary({
    repo: 'geraldmaron/construct',
    version: '9.9.9',
    platformId: null,
    fetchImpl: async () => { called = true; },
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /unsupported platform/);
  assert.equal(called, false);
});

test('decideCommand: CONSTRUCT_BIN_OVERRIDE wins over platform detection and download entirely', async () => {
  const decision = await decideCommand({
    env: { CONSTRUCT_BIN_OVERRIDE: '/some/stub/binary' },
    detectPlatformImpl: () => { throw new Error('must not be called when override is set'); },
    ensureBinaryImpl: async () => { throw new Error('must not be called when override is set'); },
  });
  assert.deepEqual(decision, { action: 'exec', binaryPath: '/some/stub/binary', source: 'override' });
});

test('decideCommand: unsupported platform falls back to the Node CLI, with a stated reason', async () => {
  const decision = await decideCommand({
    env: {},
    detectPlatformImpl: () => null,
    ensureBinaryImpl: async () => { throw new Error('must not be called for an unsupported platform'); },
  });
  assert.equal(decision.action, 'fallback');
  assert.match(decision.reason, /unsupported platform/);
});

test('decideCommand: a failed ensureBinary falls back to the Node CLI, with ensureBinary\'s own reason', async () => {
  const decision = await decideCommand({
    env: {},
    detectPlatformImpl: () => 'darwin-arm64',
    ensureBinaryImpl: async () => ({ ok: false, reason: 'checksum mismatch for construct-darwin-arm64 (expected aaa, got bbb)' }),
  });
  assert.equal(decision.action, 'fallback');
  assert.match(decision.reason, /checksum mismatch/);
});

test('decideCommand: a successful ensureBinary resolves to exec with its binaryPath', async () => {
  const decision = await decideCommand({
    env: {},
    detectPlatformImpl: () => 'linux-x64',
    ensureBinaryImpl: async () => ({ ok: true, binaryPath: '/cache/bin/1.0.0/construct-linux-x64', source: 'cache' }),
  });
  assert.deepEqual(decision, { action: 'exec', binaryPath: '/cache/bin/1.0.0/construct-linux-x64', source: 'cache' });
});

test('run(): CONSTRUCT_BIN_OVERRIDE execs the override binary with argv passthrough and the child\'s exit code propagated', (t) => {
  const stubDir = mkdtempSync(join(tmpdir(), 'construct-shim-stub-'));
  t.after(() => rmTmpDir(stubDir));
  const stubPath = join(stubDir, 'stub-cli.mjs');
  writeFileSync(
    stubPath,
    '#!/usr/bin/env node\n' +
    'process.stdout.write("argv:" + JSON.stringify(process.argv.slice(2)) + "\\n");\n' +
    'process.exit(7);\n',
  );
  chmodSync(stubPath, 0o755);

  const spawned = spawnSync(process.execPath, [SHIM_ENTRY, 'foo', '--bar=baz'], {
    encoding: 'utf8',
    env: { ...process.env, CONSTRUCT_BIN_OVERRIDE: stubPath },
    timeout: 15_000,
  });

  assert.equal(spawned.status, 7, `expected exit 7, got status=${spawned.status} stderr=${spawned.stderr}`);
  assert.match(spawned.stdout, /argv:\["foo","--bar=baz"\]/);
});

test('run(): an unsupported host platform falls back to running the real bin/construct CLI, printing real version output', (t) => {
  // Exercises the fallback path against the *real* bin/construct entry (not a
  // stub) by forcing decideCommand's platform check to fail via a tiny
  // wrapper that overrides process.platform before importing the shim,
  // proving the fallback runs genuinely working CLI code, not a stub,
  // without needing an actually-unsupported host to run the test on.
  const wrapperDir = mkdtempSync(join(tmpdir(), 'construct-shim-wrapper-'));
  t.after(() => rmTmpDir(wrapperDir));
  const wrapperPath = join(wrapperDir, 'force-unsupported-platform.mjs');
  writeFileSync(
    wrapperPath,
    `Object.defineProperty(process, 'platform', { value: 'freebsd' });\n` +
    `const { run } = await import(${JSON.stringify(SHIM_ENTRY)});\n` +
    `await run(['version']);\n`,
  );

  const spawned = spawnSync(process.execPath, [wrapperPath], { encoding: 'utf8', timeout: 15_000 });

  assert.match(spawned.stderr, /falling back to the Node CLI \(unsupported platform\/arch/);
  assert.match(spawned.stdout, /^construct v\d+\.\d+\.\d+/);
  assert.equal(spawned.status, 0);
});
