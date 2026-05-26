/**
 * lib/version.mjs — Single source of truth for the installed Construct version.
 *
 * Reads package.json once per process and caches. Surfaces:
 *   - bin/construct (`--version`, `construct version`)
 *   - construct status (header)
 *   - migration runner (compatibility check against artifact schema versions)
 *   - doctor watchers (advisory drift against published npm tag)
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG_PATH = join(ROOT, 'package.json');

let _cached = null;

export function getInstalledVersion() {
  if (_cached) return _cached;
  try {
    const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
    _cached = { version: pkg.version || '0.0.0', name: pkg.name || 'construct', pkgPath: PKG_PATH };
  } catch {
    _cached = { version: '0.0.0', name: 'construct', pkgPath: PKG_PATH };
  }
  return _cached;
}

/**
 * Parse a semver string into { major, minor, patch }. Returns null on failure.
 */
export function parseSemver(s) {
  const match = String(s || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Compare two semver strings. Returns -1 / 0 / 1.
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  return 0;
}
