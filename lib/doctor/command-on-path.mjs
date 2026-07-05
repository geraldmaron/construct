/**
 * lib/doctor/command-on-path.mjs — resolve a command's PATH location the way a
 * user's terminal would, without requiring zsh.
 *
 * `command -v` needs a login-ish shell to see the same PATH a real terminal
 * session would build (rc files, PATH managers, etc). zsh is the
 * macOS/most-desktop-Linux default but is not guaranteed present (minimal
 * containers, some CI images) — spawning it unconditionally turns a missing
 * zsh into a false "not on PATH" result for every dependent check. Falling
 * back to `sh -lc` on ENOENT keeps this a real PATH lookup instead.
 */

import { spawnSync } from 'node:child_process';

export function resolveCommandOnPath(command, { spawnSyncImpl = spawnSync, platform = process.platform } = {}) {
  if (platform === 'win32') {
    return spawnSyncImpl('where', [command], { encoding: 'utf8', stdio: 'pipe' });
  }
  const viaZsh = spawnSyncImpl('zsh', ['-lc', `command -v ${command}`], { encoding: 'utf8', stdio: 'pipe' });
  if (viaZsh.error?.code === 'ENOENT') {
    return spawnSyncImpl('sh', ['-lc', `command -v ${command}`], { encoding: 'utf8', stdio: 'pipe' });
  }
  return viaZsh;
}
