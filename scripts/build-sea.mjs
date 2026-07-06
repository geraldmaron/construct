#!/usr/bin/env node
/**
 * scripts/build-sea.mjs — Node Single Executable Application fallback build.
 *
 * Recorded fallback for the Bun-compiled binary path: if Bun's native-module
 * compatibility ever regresses for LanceDB or the MCP SDK, this produces a
 * binary for the current host platform using Node's built-in SEA feature
 * (`--experimental-sea-config` + postject blob injection; Node 20.11+, and the
 * simpler single-flag `--build-sea` from Node 25.5+ once postject support for
 * that flag lands). Not wired into the default release path — `npm run
 * build:binary` (Bun) is primary; this exists so the fallback is present and
 * functional, not merely described.
 *
 * Same bundle-then-inject technique already proven in
 * .github/workflows/release.yml's `build-binary` job (which runs against
 * official Node builds from actions/setup-node). On a Homebrew-installed
 * Node, blob generation works but injection can fail — see the note below.
 *
 * Usage:
 *   node scripts/build-sea.mjs          — build a binary for the current platform
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, chmodSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = resolve(ROOT, 'dist');
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
}

function which(bin) {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  return probe.status === 0;
}

function main() {
  mkdirSync(DIST_DIR, { recursive: true });

  const bundlePath = resolve(DIST_DIR, 'construct-bundle.mjs');
  const seaConfigPath = resolve(DIST_DIR, 'sea-config.json');
  const blobPath = resolve(DIST_DIR, 'sea-prep.blob');
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const outName = platform === 'windows' ? 'construct-windows-x64-sea.exe' : `construct-${platform}-${process.arch}-sea`;
  const outfile = resolve(DIST_DIR, outName);

  console.log('▸ bundling bin/construct with esbuild');
  const useLocalEsbuild = existsSync(resolve(ROOT, 'node_modules', '.bin', 'esbuild'));
  const esbuildBin = useLocalEsbuild ? resolve(ROOT, 'node_modules', '.bin', 'esbuild') : 'esbuild';
  const bundle = run(esbuildBin, [
    'bin/construct', '--bundle', '--platform=node', '--target=node22', '--format=esm',
    `--outfile=${bundlePath}`,
    '--external:@huggingface/transformers', '--external:@xenova/transformers',
    '--external:onnxruntime-node', '--external:sharp',
    '--external:@lancedb/lancedb', '--external:postgres',
  ]);
  if (bundle.status !== 0) {
    console.error('esbuild bundling failed. Install with `npm install` (esbuild is a devDependency).');
    process.exit(1);
  }

  console.log('▸ writing SEA config and preparation blob');
  writeFileSync(seaConfigPath, JSON.stringify({
    main: bundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
  }, null, 2));
  const blob = run(process.execPath, ['--experimental-sea-config', seaConfigPath]);
  if (blob.status !== 0) {
    console.error('SEA blob generation failed.');
    process.exit(1);
  }

  console.log('▸ copying node binary and injecting blob with postject');
  copyFileSync(process.execPath, outfile);
  chmodSync(outfile, 0o755);
  const useLocalPostject = existsSync(resolve(ROOT, 'node_modules', '.bin', 'postject'));
  const postjectBin = useLocalPostject ? resolve(ROOT, 'node_modules', '.bin', 'postject') : 'postject';
  const inject = run(postjectBin, [
    outfile, 'NODE_SEA_BLOB', blobPath, '--sentinel-fuse', SENTINEL,
    ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : []),
  ]);
  if (inject.status !== 0) {
    console.error([
      '',
      'postject injection failed. This is a known local-machine caveat, not a',
      'script bug: some Node distributions (observed with Homebrew-installed',
      'Node on macOS) ship without the NODE_SEA_FUSE sentinel string compiled',
      'into the binary, so postject cannot find where to inject the blob. The',
      'existing CI pipeline (.github/workflows/release.yml) does not hit this —',
      'it runs against official Node builds via actions/setup-node, which do',
      'include the sentinel. To build locally, use an official nodejs.org',
      'download (or nvm/fnm installing from nodejs.org) rather than Homebrew\'s.',
      '',
    ].join('\n'));
    process.exit(1);
  }

  if (process.platform === 'darwin' && which('codesign')) {
    console.log('▸ re-signing binary (required on macOS after postject injection)');
    run('codesign', ['--sign', '-', outfile]);
  }

  const smoke = spawnSync(outfile, ['version'], { encoding: 'utf8', timeout: 10_000 });
  if (smoke.status === 0 && (smoke.stdout || '').trim().length > 0) {
    console.log(`▸ smoke check passed: ${smoke.stdout.trim()}`);
  } else {
    console.error(`▸ smoke check FAILED (status=${smoke.status}, stdout="${smoke.stdout}", stderr="${smoke.stderr}")`);
    process.exit(2);
  }

  console.log(`\nBuilt: ${outfile}`);
}

main();
