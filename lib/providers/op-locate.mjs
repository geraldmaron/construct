/**
 * lib/providers/op-locate.mjs — resolve the 1Password `op` CLI binary once.
 *
 * A GUI-launched MCP host (OpenCode, Claude Desktop, Cursor) spawns
 * `node lib/mcp/server.mjs` with a minimal PATH that omits Homebrew, so a bare
 * `spawnSync('op', …)` ENOENTs and `op` is misreported as not installed despite
 * being present at a well-known path like /opt/homebrew/bin/op. Resolution walks three
 * tiers — the process PATH (cheap, no shell), then a login-shell probe that re-runs
 * the user's rc/profile (macOS path_helper included, the way credential-bootstrap
 * recovers PATH), then well-known install dirs — and caches the absolute path for
 * the process lifetime. Every op-invocation site (secret-resolver, op-run,
 * credential-bootstrap) resolves through here so PATH semantics stay consistent
 * across call sites. env/runShell/wellKnown are injectable so tests exercise each
 * tier without a real 1Password install.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const WELL_KNOWN_POSIX = ['/opt/homebrew/bin/op', '/usr/local/bin/op', '/usr/bin/op'];

function wellKnownWin32() {
  const local = process.env.LOCALAPPDATA;
  return [
    local ? path.join(local, 'Microsoft', 'WinGet', 'Links', 'op.exe') : null,
    'C:\\ProgramData\\chocolatey\\bin\\op.exe',
  ].filter(Boolean);
}

function defaultWellKnown() {
  return process.platform === 'win32' ? wellKnownWin32() : WELL_KNOWN_POSIX;
}

let cached;

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

// Scan the process PATH for `op` without spawning a shell — the common case where
// PATH is already correct resolves here at no cost.

function scanProcessPath(env) {
  const dirs = String(env?.PATH || '').split(path.delimiter).filter(Boolean);
  const names = process.platform === 'win32' ? ['op.exe', 'op.cmd', 'op.bat'] : ['op'];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

// Login-shell probe: `sh -lc 'command -v op'` re-runs the user's shell init, which
// on macOS is where path_helper adds Homebrew — recovering the PATH a GUI-launched
// child never inherited. `where op` is the Windows analogue.

function defaultRunShell() {
  if (process.platform === 'win32') {
    const r = spawnSync('where', ['op'], { encoding: 'utf8', timeout: 3000 });
    return r.status === 0 ? String(r.stdout || '').split(/\r?\n/)[0].trim() : '';
  }
  const r = spawnSync('sh', ['-lc', 'command -v op'], { encoding: 'utf8', timeout: 3000 });
  return r.status === 0 ? String(r.stdout || '').trim() : '';
}

/**
 * Resolve the `op` binary (process PATH → login-shell PATH → well-known dirs),
 * returning an absolute path or null. Cached for the process lifetime; pass
 * fresh:true to bypass the cache. env/runShell/wellKnown are injectable for tests.
 */
export function locateOpBinary({ env = process.env, runShell = defaultRunShell, wellKnown = defaultWellKnown(), fresh = false } = {}) {
  if (!fresh && cached !== undefined) return cached;

  const onPath = scanProcessPath(env);
  if (onPath) return (cached = onPath);

  const viaShell = runShell();
  if (viaShell && isFile(viaShell)) return (cached = viaShell);

  for (const candidate of wellKnown) {
    if (candidate && isFile(candidate)) return (cached = candidate);
  }

  return (cached = null);
}

export function __resetOpLocateCache() {
  cached = undefined;
}
