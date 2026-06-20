/**
 * scripts/build-chat-desktop.mjs — proactive build of the Construct Chat desktop window.
 *
 * Ensures the icon set exists, then builds the native Tauri binary from source via
 * lib/chat/desktop-build.mjs (the same path the lazy first-run uses). Invoked by
 * `npm run build:chat-desktop` and the --scope=user install when Tauri source is
 * present. Exits non-zero on build failure so callers see a real error.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDesktopBinary, hasDesktopSource } from '../lib/chat/desktop-build.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

if (!hasDesktopSource(REPO_ROOT)) {
  process.stderr.write(`No Tauri source at apps/chat/desktop/src-tauri — nothing to build.\n`);
  process.exit(1);
}

const icons = spawnSync(process.execPath, [path.join(HERE, 'generate-chat-icon.mjs')], {
  stdio: 'inherit',
});
if (icons.status !== 0) {
  process.stderr.write('Icon generation failed.\n');
  process.exit(1);
}

const result = buildDesktopBinary({
  repoRoot: REPO_ROOT,
  env: process.env,
  output: process.stdout,
  errorOutput: process.stderr,
});

if (!result.ok) {
  process.stderr.write(`Build failed: ${result.reason}\n`);
  process.exit(1);
}
