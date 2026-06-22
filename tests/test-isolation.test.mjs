/**
 * tests/test-isolation.test.mjs — regression guard for functional test HOME isolation.
 *
 * Files that assign process.env.HOME must restore it in the same file (finally,
 * after, afterEach, or t.after). Parallel node --test runs share one process env;
 * a leaked HOME routes durable writes to the developer machine.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const ALLOWLIST = new Set([
  'helpers/sterile-env.mjs',
  'e2e/lib/sterile-env.mjs',
]);

const RESTORE_PATTERNS = [
  /process\.env\.HOME\s*=\s*(?:prior|prev|original|realHOMEenv|priorHome|originalHome)/,
  /delete\s+process\.env\.HOME/,
  /if\s*\(\s*priorHome\s*===\s*undefined\s*\)\s*delete\s+process\.env\.HOME/,
  /\.finally\s*\(/,
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && full.endsWith('.mjs')) out.push(full);
  }
  return out;
}

test('tests that assign process.env.HOME also restore it in-file', () => {
  const offenders = [];
  for (const full of walk(HERE)) {
    const rel = path.relative(HERE, full);
    if (ALLOWLIST.has(rel)) continue;
    const src = fs.readFileSync(full, 'utf8');
    if (!/process\.env\.HOME\s*=/.test(src)) continue;
    const hasRestore = RESTORE_PATTERNS.some((re) => re.test(src))
      || /\bt\.after\s*\(/.test(src)
      || /\bafterEach\s*\(/.test(src)
      || /\bafter\s*\(/.test(src);
    if (!hasRestore) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `HOME isolation leaks (assign without restore):\n  ${offenders.join('\n  ')}\n`,
  );
});
