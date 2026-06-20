/**
 * lib/chat/desktop-binary.mjs — resolve the Construct chat desktop window binary.
 *
 * Search order: CONSTRUCT_CHAT_DESKTOP_BIN, repo dev build, ~/.construct/bin,
 * then packaged sidecar next to construct.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

function binaryName() {
  return process.platform === 'win32' ? 'construct-chat.exe' : 'construct-chat';
}

function isReadableFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isLaunchableBinary(filePath) {
  if (!filePath) return false;
  if (isExecutable(filePath)) return true;
  return isReadableFile(filePath) && /\.(mjs|cjs|js)$/i.test(filePath);
}

export function desktopBinaryCandidates({ repoRoot = REPO_ROOT, homeDir = os.homedir() } = {}) {
  const name = binaryName();
  const tauriRoot = path.join(repoRoot, 'apps', 'chat', 'desktop', 'src-tauri', 'target');
  return [
    process.env.CONSTRUCT_CHAT_DESKTOP_BIN,
    path.join(tauriRoot, 'release', name),
    path.join(tauriRoot, 'debug', name),
    path.join(homeDir, '.construct', 'bin', name),
    path.join(repoRoot, 'apps', 'chat', 'desktop', 'bin', name),
  ].filter(Boolean);
}

export function resolveDesktopBinary(options = {}) {
  for (const candidate of desktopBinaryCandidates(options)) {
    if (isLaunchableBinary(candidate)) return candidate;
  }
  return null;
}

export function desktopBinaryInstallHint({ repoRoot = REPO_ROOT } = {}) {
  return [
    'Construct chat desktop window is not installed.',
    'Install it with: construct install --scope=user',
    `Or set CONSTRUCT_CHAT_DESKTOP_BIN to your construct-chat binary.`,
    `Dev build: npm run build:chat-desktop (output: ${path.join(repoRoot, 'apps', 'chat', 'desktop', 'src-tauri', 'target', 'release', binaryName())})`,
  ].join('\n');
}

export function hasGuiDisplay(env = process.env) {
  if (env.CX_CHAT_NO_DISPLAY === '1') return false;
  if (process.platform === 'win32') return true;
  if (process.platform === 'darwin') return true;
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}
