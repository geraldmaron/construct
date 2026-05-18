#!/usr/bin/env node
/**
 * .construct/run.mjs — project-local Construct launcher.
 *
 * Resolves the right Construct install for the project and forwards every
 * argument and stream to it. Settings.json hooks invoke this file
 * (`node .construct/run.mjs hook <name>`) so the hook command is identical
 * for every peer who clones the project, regardless of whether they have
 * Construct globally installed or have run `npm install`.
 *
 * Resolution order:
 *
 *   0. `CONSTRUCT_DEV_PATH` env var — if set, points at a Construct checkout
 *      and the launcher invokes its `bin/construct`. Used for development
 *      and smoke tests; not consulted in normal runs.
 *
 *   1. Workspace `node_modules/@geraldmaron/construct/bin/construct` — if a
 *      `npm install` has materialised Construct in this project's node_modules,
 *      use that. Fastest, no network.
 *
 *   2. `npx -p @geraldmaron/construct@<version> construct …` — if Node ≥ 18
 *      is on PATH but the package isn't installed locally. npx caches the
 *      package after the first run. The version pin comes from
 *      `.construct/version` next to this file.
 *
 *   3. Globally installed `construct` on PATH — if neither of the above
 *      hit but the user has installed Construct globally.
 *
 *   4. Cached binary at `.construct/cache/bin/construct-<os>-<arch>` — if
 *      a previous bootstrap downloaded the matching single-file binary
 *      from GitHub Releases.
 *
 *   5. Docker container — if the docker daemon is reachable, invoke
 *      `ghcr.io/geraldmaron/construct:<pinned-version>` with the project
 *      bind-mounted at /work. Lets language-agnostic projects (no Node,
 *      no global construct, no binary) still execute hooks. Disable with
 *      `CONSTRUCT_DISABLE_DOCKER=1` for environments where docker is
 *      reachable but undesirable (e.g. CI runners that prefer fail-fast).
 *
 *   6. Print a precise error with the exact install commands and exit
 *      with the documented exit code (127 = command not found).
 *
 * The launcher is intentionally tiny and dependency-free so it never
 * needs `npm install` to be runnable. It uses only Node's stdlib.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..');
const VERSION_FILE = join(HERE, 'version');
const CACHE_BIN_DIR = join(HERE, 'cache', 'bin');

function readPinnedVersion() {
  try {
    const v = readFileSync(VERSION_FILE, 'utf8').trim();
    if (v && /^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$/.test(v)) return v;
  } catch { /* file missing or unreadable */ }
  return null;
}

function isExecutable(path) {
  try {
    return statSync(path).isFile();
  } catch { return false; }
}

function commandOnPath(cmd) {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {
    encoding: 'utf8',
  });
  if (probe.status !== 0) return null;
  const first = probe.stdout.split(/\r?\n/).find(Boolean);
  return first || null;
}

function runForeground(cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    cwd: opts.cwd || PROJECT_ROOT,
    env: { ...process.env, ...(opts.env || {}) },
  });
  child.on('exit', (code) => process.exit(code ?? 1));
  child.on('error', (err) => {
    process.stderr.write(`[construct] launcher failed to spawn ${cmd}: ${err.message}\n`);
    process.exit(127);
  });
}

function tryDevPath() {
  const dev = process.env.CONSTRUCT_DEV_PATH;
  if (!dev) return false;
  const candidate = join(dev, 'bin', 'construct');
  if (!isExecutable(candidate)) return false;
  runForeground(process.execPath, [candidate, ...process.argv.slice(2)]);
  return true;
}

function tryNodeModules() {
  const candidate = join(
    PROJECT_ROOT,
    'node_modules', '@geraldmaron', 'construct', 'bin', 'construct'
  );
  if (!isExecutable(candidate)) return false;
  runForeground(process.execPath, [candidate, ...process.argv.slice(2)]);
  return true;
}

function tryNpx(version) {
  if (!commandOnPath('npx')) return false;
  const spec = version ? `@geraldmaron/construct@${version}` : '@geraldmaron/construct';
  runForeground('npx', ['-p', spec, '--', 'construct', ...process.argv.slice(2)]);
  return true;
}

function tryGlobal() {
  const found = commandOnPath('construct');
  if (!found) return false;
  runForeground(found, process.argv.slice(2));
  return true;
}

function tryCachedBinary() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const os = process.platform === 'darwin' ? 'darwin'
    : process.platform === 'win32' ? 'windows'
    : 'linux';
  const ext = process.platform === 'win32' ? '.exe' : '';
  const candidate = join(CACHE_BIN_DIR, `construct-${os}-${arch}${ext}`);
  if (!isExecutable(candidate)) return false;
  runForeground(candidate, process.argv.slice(2));
  return true;
}

function tryDocker(version) {
  if (process.env.CONSTRUCT_DISABLE_DOCKER === '1') return false;
  if (!commandOnPath('docker')) return false;
  // Confirm the daemon is reachable, not just that the CLI is installed.
  const info = spawnSync('docker', ['info'], { stdio: 'ignore' });
  if (info.status !== 0) return false;
  const tag = version || 'latest';
  const image = `ghcr.io/geraldmaron/construct:${tag}`;
  const userHome = process.env.HOME || process.env.USERPROFILE || '';
  const hostConstructDir = userHome ? join(userHome, '.construct') : null;
  const dockerArgs = [
    'run', '--rm', '-i',
    '-v', `${PROJECT_ROOT}:/work`,
    '-w', '/work',
    '-e', 'CONSTRUCT_PROJECT_ROOT=/work',
  ];
  if (hostConstructDir) {
    dockerArgs.push('-v', `${hostConstructDir}:/data/.construct`);
  }
  dockerArgs.push(image, ...process.argv.slice(2));
  runForeground('docker', dockerArgs);
  return true;
}

function fail() {
  const v = readPinnedVersion();
  process.stderr.write(
    '[construct] No Construct install found.\n' +
    '\n' +
    '  This project pins Construct' + (v ? ` ${v}` : '') + ' but no runtime resolved.\n' +
    '\n' +
    '  Pick one:\n' +
    '    - Install Node.js 18+ from https://nodejs.org and re-run.\n' +
    '    - Install Construct globally:  npm install -g @geraldmaron/construct\n' +
    '    - Install Docker:              docker pull ghcr.io/geraldmaron/construct\n' +
    '    - Bootstrap a binary:           ./.construct/bootstrap.sh   (POSIX)\n' +
    '                                    powershell -File .construct/bootstrap.ps1   (Windows)\n'
  );
  process.exit(127);
}

const version = readPinnedVersion();

if (tryDevPath()) { /* spawned */ }
else if (tryNodeModules()) { /* spawned */ }
else if (tryNpx(version)) { /* spawned */ }
else if (tryGlobal()) { /* spawned */ }
else if (tryCachedBinary()) { /* spawned */ }
else if (tryDocker(version)) { /* spawned */ }
else fail();
