/**
 * lib/chat/desktop-build.mjs — build the Construct chat desktop window from source.
 *
 * The native window is a Tauri (Rust) app at apps/chat/desktop/src-tauri, so a
 * build requires the Rust toolchain. Absent cargo, the rustup installer runs
 * first, then `cargo build --release` produces the binary at
 * target/release/construct-chat — exactly where resolveDesktopBinary looks.
 * Mirrors the build-chat-desktop job in .github/workflows/release.yml for
 * local, low-touch first-run setup.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDesktopBinary } from './desktop-binary.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

function srcTauriDir(repoRoot = REPO_ROOT) {
  return path.join(repoRoot, 'apps', 'chat', 'desktop', 'src-tauri');
}

export function hasDesktopSource(repoRoot = REPO_ROOT) {
  try {
    return fs.statSync(path.join(srcTauriDir(repoRoot), 'Cargo.toml')).isFile();
  } catch {
    return false;
  }
}

// rustup installs to ~/.cargo/bin, absent from a fresh shell's PATH until
// ~/.cargo/env is sourced; prepend it for every child process here.

export function cargoEnv(env = process.env, homeDir = os.homedir()) {
  const cargoBin = path.join(homeDir, '.cargo', 'bin');
  const sep = process.platform === 'win32' ? ';' : ':';
  const currentPath = env.PATH || '';
  const parts = currentPath.split(sep);
  if (!parts.includes(cargoBin)) {
    return { ...env, PATH: `${cargoBin}${sep}${currentPath}` };
  }
  return { ...env };
}

export function hasCargo(env = process.env, homeDir = os.homedir()) {
  const probe = spawnSync('cargo', ['--version'], {
    env: cargoEnv(env, homeDir),
    stdio: 'ignore',
  });
  return probe.status === 0;
}

export function ensureRustToolchain({
  env = process.env,
  homeDir = os.homedir(),
  output = process.stdout,
  errorOutput = process.stderr,
} = {}) {
  if (hasCargo(env, homeDir)) return { ok: true };

  if (process.platform === 'win32') {
    return {
      ok: false,
      reason: 'Rust toolchain not found. Install it from https://rustup.rs and re-run.',
    };
  }

  output.write('Installing the Rust toolchain (one-time setup for the Construct Chat window)…\n');
  const installer = spawnSync(
    'sh',
    ['-c', "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal"],
    { env, stdio: 'inherit' },
  );

  if (installer.status !== 0) {
    return {
      ok: false,
      reason: 'Rust toolchain install failed. Install it manually from https://rustup.rs and re-run.',
    };
  }

  if (!hasCargo(env, homeDir)) {
    return {
      ok: false,
      reason: 'Rust installed but cargo is still not resolvable on PATH (~/.cargo/bin).',
    };
  }

  return { ok: true };
}

export function buildDesktopBinary({
  repoRoot = REPO_ROOT,
  env = process.env,
  homeDir = os.homedir(),
  output = process.stdout,
  errorOutput = process.stderr,
} = {}) {
  if (!hasDesktopSource(repoRoot)) {
    return { ok: false, reason: `Tauri source not found at ${srcTauriDir(repoRoot)}` };
  }

  const toolchain = ensureRustToolchain({ env, homeDir, output, errorOutput });
  if (!toolchain.ok) return { ok: false, reason: toolchain.reason };

  output.write('Building the Construct Chat desktop window (cargo build --release)…\n');
  const build = spawnSync('cargo', ['build', '--release'], {
    cwd: srcTauriDir(repoRoot),
    env: cargoEnv(env, homeDir),
    stdio: 'inherit',
  });

  if (build.status !== 0) {
    return { ok: false, reason: 'cargo build --release failed (see output above).' };
  }

  const binaryPath = resolveDesktopBinary({ repoRoot, homeDir });
  if (!binaryPath) {
    return {
      ok: false,
      reason: 'Build reported success but no binary resolved at target/release/construct-chat.',
    };
  }

  output.write(`Built Construct Chat window: ${binaryPath}\n`);
  return { ok: true, binaryPath };
}
