/**
 * lib/paths.mjs — cross-platform resolution for Construct's home-relative directories.
 *
 * The codebase historically scattered `process.env.HOME + '/.cx'` and similar
 * patterns. Those break on Windows where `HOME` is unset and `USERPROFILE`
 * holds the home path. Use `homeDir()`, `cxDir()`, and `constructDir()`
 * instead — they consult `os.homedir()` (which respects every OS's user
 * directory convention) and join with `path.join` so separators work on any
 * platform.
 *
 * The `--toolkit-dir` style env override (`CX_TOOLKIT_DIR`) takes precedence
 * over `~/.construct/` so operators with non-default install layouts can
 * point Construct at the right tree.
 */

import os from 'node:os';
import path from 'node:path';

export function homeDir() {
  return process.env.CX_HOME_OVERRIDE || os.homedir() || process.env.HOME || process.env.USERPROFILE || '';
}

export function cxDir() {
  return path.join(homeDir(), '.cx');
}

export function constructDir() {
  return process.env.CX_TOOLKIT_DIR || path.join(homeDir(), '.construct');
}

export function hookPath(name) {
  return path.join(constructDir(), 'lib', 'hooks', `${name}.mjs`);
}
