/**
 * handlers.mjs — extract the dispatch surface from bin/construct for the audit harness.
 *
 * bin/construct registers every command in a single `const handlers = new Map([...])`
 * table. The catalog-parity test already proved the shape is stable enough to parse.
 * Shared extractor for every audit phase that reasons about handler reachability
 * (Phase 0 census, Phase 1 smoke, Phase 2 dead-code).
 *
 * Keyed off the Map STRING KEYS, never the bound function identifiers: a handler's
 * function name is not guaranteed to match its command name, so the string key is the
 * only reliable command identity.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const BIN_PATH = path.join(REPO_ROOT, 'bin', 'construct');

// The handler table is `const handlers = new Map([` ... `]);` at column zero.
// Rows start at a 2-3 space indent with `['<name>',`. Deeper-indented `[` rows
// are nested arrays inside arrow bodies and are correctly excluded by the indent anchor.

export function readHandlerNames(binPath = BIN_PATH) {
  const source = fs.readFileSync(binPath, 'utf8');
  const start = source.indexOf('const handlers = new Map([');
  if (start < 0) throw new Error('handlers map opener not found in bin/construct');
  const after = source.slice(start);
  const closer = after.match(/\n\]\);/);
  if (!closer) throw new Error('handlers map closer (newline + "]);") not found');
  const body = after.slice(0, closer.index);
  const names = new Set();
  for (const m of body.matchAll(/\n {2,3}\[\s*'([^']+)'\s*,/g)) names.add(m[1]);
  return names;
}

// Commands whose handler defers module loading to call time (await import(...)).
// These pass `--help` (intercepted before dispatch) yet can be dead-on-invoke if the
// imported module was renamed/removed — Phase 1 probes them specifically.

export function readLazyImportCommands(binPath = BIN_PATH) {
  const source = fs.readFileSync(binPath, 'utf8');
  const start = source.indexOf('const handlers = new Map([');
  const after = source.slice(start);
  const closer = after.match(/\n\]\);/);
  const body = after.slice(0, closer.index);
  const lazy = new Set();
  for (const m of body.matchAll(/\n {2,3}\[\s*'([^']+)'\s*,\s*async[^\]]*?await import\(/gs)) {
    lazy.add(m[1]);
  }
  return lazy;
}

// Static, side-effect-free reachability probe: every `await import('<literal>')` anywhere
// in the dispatcher (handler bodies live both inline in the Map and in named cmd*
// functions far above it, so the whole file is in scope). Catches a renamed/removed module
// without invoking the command — some, e.g. acp, would start a stdio server. Returns a flat
// list of { specifier, resolved, exists, dynamic }; non-literal specifiers carry dynamic=true
// for manual follow-up rather than a false pass.

export function readLazyImportSpecifiers(binPath = BIN_PATH) {
  const source = fs.readFileSync(binPath, 'utf8');
  const binDir = path.dirname(binPath);
  const out = [];
  const seen = new Set();
  for (const m of source.matchAll(/await import\(\s*(['"`])([^'"`]+)\1\s*\)/g)) {
    const specifier = m[2];
    if (seen.has(specifier)) continue;
    seen.add(specifier);
    const resolved = specifier.startsWith('.') ? path.resolve(binDir, specifier) : null;
    out.push({ specifier, resolved, exists: resolved ? fs.existsSync(resolved) : null, dynamic: false });
  }
  for (const m of source.matchAll(/await import\(\s*(?!['"`])([^)]*)\)/g)) {
    const expr = m[1].trim().slice(0, 60);
    out.push({ specifier: `<dynamic:${expr}>`, resolved: null, exists: null, dynamic: true });
  }
  return out;
}

// Per-command lazy-import count for the inventory census (Map-block inline handlers only).

export function readLazyImportCount(binPath = BIN_PATH) {
  return readLazyImportCommands(binPath).size;
}
