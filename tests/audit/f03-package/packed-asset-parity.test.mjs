/**
 * tests/audit/f03-package/packed-asset-parity.red.mjs — F03 [R1] packed-tarball asset parity.
 *
 * Regression guard for CX-AUDIT-PACKAGE-001/-002. Runtime code loads data files out of
 * the repo-root registry/ and schemas/ directories:
 *   - lib/registry/validate.mjs  reads <root>/registry/capabilities.json
 *   - lib/registry/agent-manifest.mjs  reads <root>/registry/agent-manifest.json
 *   - lib/embedded-contract/capability.mjs  reads <root>/schemas/*.json
 * so package.json `files` ships both, and a consumer `npm install` gets a package whose
 * registry+schema validation and capability inventory work on first run. Each test packs
 * the EXACT artifact with `npm pack`, extracts it, and asserts every runtime-loaded
 * repo-root directory resolves inside the extraction — the manifest-vs-loads parity the
 * audit requires.
 *
 * Hermetic: pack destination and extraction both live under fs.mkdtemp(os.tmpdir()).
 * No network: `npm pack` of a local path is offline. The repo root is resolved from this
 * file's location so the test packs the real working tree, not a published version.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { rmTmpDir } from '../../helpers/cleanup.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Pack the working tree exactly as `npm publish` would, extract the single tarball, and
// return the package root inside the extraction (npm prefixes every entry with `package/`).
// One pack+extract is shared across the asserts via the module-level `packed` promise so the
// (slow) pack runs once.

function packAndExtract() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f03-pack-'));
  const npmCache = path.join(dir, 'npm-cache');
  fs.mkdirSync(npmCache, { recursive: true });
  const pack = spawnSync('npm', ['pack', '--json', '--pack-destination', dir], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_cache: npmCache,
      NPM_CONFIG_CACHE: npmCache,
    },
  });
  if (pack.status !== 0) {
    throw new Error(`npm pack failed (exit ${pack.status}): ${pack.stderr || pack.stdout}`);
  }
  const tarballName = JSON.parse(pack.stdout)[0].filename;
  const tarballPath = path.join(dir, tarballName);
  const extractDir = path.join(dir, 'extracted');
  fs.mkdirSync(extractDir, { recursive: true });
  const untar = spawnSync('tar', ['-xzf', tarballPath, '-C', extractDir], { encoding: 'utf8' });
  if (untar.status !== 0) {
    throw new Error(`tar extract failed (exit ${untar.status}): ${untar.stderr}`);
  }
  return { dir, pkgRoot: path.join(extractDir, 'package') };
}

let cached = null;
function packed() {
  if (!cached) cached = packAndExtract();
  return cached;
}

test.after(() => {
  if (cached) {
    rmTmpDir(cached.dir);
  }
});

test('[R1] packed artifact must contain registry/capabilities.json (loaded by lib/registry/validate.mjs:37)', () => {
  const { pkgRoot } = packed();
  const loaded = path.join(pkgRoot, 'registry', 'capabilities.json');
  assert.ok(
    fs.existsSync(loaded),
    `runtime loads registry/capabilities.json but it is absent from the tarball at ${loaded}; package.json "files" omits registry/`,
  );
});

test('[R1] packed artifact must contain registry/agent-manifest.json (loaded by lib/registry/agent-manifest.mjs:40)', () => {
  const { pkgRoot } = packed();
  const loaded = path.join(pkgRoot, 'registry', 'agent-manifest.json');
  assert.ok(
    fs.existsSync(loaded),
    `loadAgentManifest reads registry/agent-manifest.json but it is absent from the tarball at ${loaded}; package.json "files" omits registry/`,
  );
});

test('[R1] packed artifact must contain repo-root schemas/ (read by lib/embedded-contract/capability.mjs:78)', () => {
  const { pkgRoot } = packed();
  const schemasDir = path.join(pkgRoot, 'schemas');
  assert.ok(
    fs.existsSync(schemasDir),
    `buildSchemas() reads <root>/schemas/*.json but the directory is absent from the tarball at ${schemasDir}; package.json "files" omits schemas/`,
  );
  const jsonCount = fs.existsSync(schemasDir)
    ? fs.readdirSync(schemasDir).filter((f) => f.endsWith('.json')).length
    : 0;
  assert.ok(
    jsonCount > 0,
    `expected at least one schema JSON in the packed schemas/ directory, found ${jsonCount}`,
  );
});

test('[R1] every repo-root dir a runtime path reads must be packed (manifest-vs-loads parity)', () => {
  const { pkgRoot } = packed();

  // Each entry maps a runtime read site to the repo-root directory it depends on. A
  // packed artifact missing any of these directories ships a broken first-run path.

  const runtimeRootDirs = [
    { dir: 'registry', loadedBy: 'lib/registry/validate.mjs, lib/registry/agent-manifest.mjs' },
    { dir: 'schemas', loadedBy: 'lib/embedded-contract/capability.mjs' },
  ];
  const missing = runtimeRootDirs.filter(({ dir }) => !fs.existsSync(path.join(pkgRoot, dir)));
  assert.deepEqual(
    missing.map((m) => m.dir),
    [],
    `runtime-loaded repo-root directories absent from the packed artifact: ${
      missing.map((m) => `${m.dir} (loaded by ${m.loadedBy})`).join('; ')
    }`,
  );
});
