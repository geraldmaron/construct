#!/usr/bin/env node
/**
 * bin/construct-shim.mjs — npm downloader shim (ADR-0064 §"npm demoted to
 * downloader shim", construct-rf26.19).
 *
 * Not wired as package.json's published `bin` entry yet. `bin/construct`
 * still ships as the real Node CLI implementation because five existing
 * install/acceptance tests (tests/acceptance/global-install.test.mjs,
 * packed-install.test.mjs, tests/functional/install-scope.functional.test.mjs,
 * install-parity.functional.test.mjs, install-legacy-global-cleanup.
 * functional.test.mjs) spawn `node bin/construct ...` directly and assert on
 * synchronous, network-independent stdout within tight timeouts — a
 * networked shim needs those tests updated deliberately (mocked binaries or
 * an offline fallback path) before the cutover. Landing the shim's
 * platform-detection, cache, download, and exec logic separately, ahead of
 * that cutover (see tests/functional/construct-shim.functional.test.mjs),
 * keeps the existing install surface unaffected until that follow-up lands.
 *
 * Behavior once wired: detect platform/arch, resolve a cached or freshly
 * downloaded Bun-compiled `construct-<os>-<arch>` binary (same GitHub
 * Releases URL and sha256-sidecar scheme as scripts/install.sh, cached under
 * lib/config/xdg.mjs's cacheDir() keyed by the installed package version so
 * re-invocations after the first are network-free), then exec it with
 * argv/stdio inherited and the child's exit code propagated — never running
 * CLI logic in-process. `CONSTRUCT_BIN_OVERRIDE` bypasses detection/download
 * entirely (points straight at a binary or script), for local dev, CI, and
 * the tests covering this file. On an unsupported platform, or if
 * download/checksum verification fails, fallback runs the real Node CLI
 * implementation shipped alongside this file (`bin/construct`) rather than
 * erroring silently — a warning always prints to stderr first so the
 * fallback is never mistaken for the intended fast path.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cacheDir } from '../lib/config/xdg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');
const REAL_CLI_ENTRY = path.join(HERE, 'construct');

const SUPPORTED_PLATFORMS = [
  { platform: 'darwin', arch: 'arm64', id: 'darwin-arm64' },
  { platform: 'darwin', arch: 'x64', id: 'darwin-x64' },
  { platform: 'linux', arch: 'x64', id: 'linux-x64' },
  { platform: 'linux', arch: 'arm64', id: 'linux-arm64' },
];

export function detectPlatform(platform = process.platform, arch = process.arch) {
  const match = SUPPORTED_PLATFORMS.find((p) => p.platform === platform && p.arch === arch);
  return match ? match.id : null;
}

export function packageVersion(pkgRoot = PKG_ROOT) {
  try {
    return JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')).version || '';
  } catch {
    return '';
  }
}

export function resolveAssetName(platformId) {
  return `construct-${platformId}`;
}

export function resolveDownloadUrls({ repo, version, platformId }) {
  const asset = resolveAssetName(platformId);
  const base = `https://github.com/${repo}/releases/download/v${version}`;
  return { binaryUrl: `${base}/${asset}`, checksumUrl: `${base}/${asset}.sha256` };
}

export function resolveCachePath({ cacheRoot, version, platformId }) {
  return path.join(cacheRoot, 'bin', version, resolveAssetName(platformId));
}

export function sha256Of(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

// The sidecar mirrors `sha256sum`'s output format ("<hex>  <filename>"), same
// as scripts/install.sh's verify_checksum expects, so both installers stay
// compatible with whatever release.yml already publishes.

export function parseChecksumFile(contents) {
  return contents.trim().split(/\s+/)[0] || '';
}

/**
 * Resolves a verified local binary path for the current platform, downloading
 * into the version-keyed cache on a miss. Returns null (never throws) when
 * the platform is unsupported or the download/verification fails — callers
 * decide the fallback, this function only reports what it could not do via
 * the returned `reason`.
 */
export async function ensureBinary({
  repo,
  version,
  platformId,
  cacheRoot = cacheDir(),
  fetchImpl = fetch,
} = {}) {
  if (!platformId) return { ok: false, reason: `unsupported platform/arch (${process.platform}/${process.arch})` };

  const cachedPath = resolveCachePath({ cacheRoot, version, platformId });
  if (existsSync(cachedPath)) {
    return { ok: true, binaryPath: cachedPath, source: 'cache' };
  }

  const { binaryUrl, checksumUrl } = resolveDownloadUrls({ repo, version, platformId });
  let binaryRes;
  let checksumRes;
  try {
    [binaryRes, checksumRes] = await Promise.all([fetchImpl(binaryUrl), fetchImpl(checksumUrl)]);
  } catch (err) {
    return { ok: false, reason: `network error fetching ${binaryUrl}: ${err.message}` };
  }
  if (!binaryRes.ok) return { ok: false, reason: `download failed: ${binaryRes.status} ${binaryUrl}` };
  if (!checksumRes.ok) return { ok: false, reason: `checksum download failed: ${checksumRes.status} ${checksumUrl}` };

  const binaryBuf = Buffer.from(await binaryRes.arrayBuffer());
  const checksumText = await checksumRes.text();
  const expected = parseChecksumFile(checksumText);
  const actual = sha256Of(binaryBuf);
  if (!expected || expected !== actual) {
    return { ok: false, reason: `checksum mismatch for ${resolveAssetName(platformId)} (expected ${expected || '(none)'}, got ${actual})` };
  }

  mkdirSync(path.dirname(cachedPath), { recursive: true });
  writeFileSync(cachedPath, binaryBuf);
  chmodSync(cachedPath, 0o755);
  return { ok: true, binaryPath: cachedPath, source: 'download' };
}

function warn(msg) {
  process.stderr.write(`[construct] ${msg}\n`);
}

/**
 * Decides which binary to run and why, with no I/O beyond ensureBinary's own
 * cache/network calls — no spawn, no process.exit. Kept separate from run()
 * so the override/fallback/exec decision is testable in-process without a
 * child spawn or a real network call standing between a test and its
 * assertion.
 */
export async function decideCommand({
  env = process.env,
  repo = 'geraldmaron/construct',
  detectPlatformImpl = detectPlatform,
  ensureBinaryImpl = ensureBinary,
} = {}) {
  if (env.CONSTRUCT_BIN_OVERRIDE) {
    return { action: 'exec', binaryPath: env.CONSTRUCT_BIN_OVERRIDE, source: 'override' };
  }

  const version = packageVersion();
  const platformId = detectPlatformImpl();
  if (!platformId) {
    return { action: 'fallback', reason: `unsupported platform/arch (${process.platform}/${process.arch})` };
  }

  const result = await ensureBinaryImpl({ repo, version, platformId });
  if (!result.ok) {
    return { action: 'fallback', reason: result.reason };
  }
  return { action: 'exec', binaryPath: result.binaryPath, source: result.source };
}

// Real Node implementation fallback — used both when the platform has no
// compiled binary and when a download/verification attempt fails, so a
// broken release never turns into a silent no-op for users who could still
// run the CLI in-process.

export async function run(argv, opts = {}) {
  const decision = await decideCommand(opts);

  if (decision.action === 'fallback') {
    warn(`falling back to the Node CLI (${decision.reason})`);
    const result = spawnSync(process.execPath, [REAL_CLI_ENTRY, ...argv], { stdio: 'inherit' });
    process.exit(result.status ?? 1);
    return;
  }

  const result = spawnSync(decision.binaryPath, argv, { stdio: 'inherit' });
  if (result.error) {
    warn(`failed to run ${decision.binaryPath}: ${result.error.message}`);
    process.exit(1);
    return;
  }
  process.exit(result.status ?? 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).catch((err) => {
    warn(`unexpected shim error: ${err.message}`);
    process.exit(1);
  });
}
