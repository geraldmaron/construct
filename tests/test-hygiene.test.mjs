/**
 * tests/test-hygiene.test.mjs — regression guard against /tmp/construct-* leaks.
 *
 * Walks every tests/**.test.mjs file. For each `mkdtempSync` call site, asserts
 * the same file contains at least one cleanup signal (t.after(, afterEach(,
 * fs.rmSync(, rmSync(, or a tracking array used in an after() block). The
 * check is a heuristic, not a parser. The allowlist below documents files
 * that legitimately do not need an in-file cleanup, with a one-line reason.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ALLOWLIST: files that may contain `mkdtempSync` without a sibling cleanup
// signal in the same file. Each entry must explain why the call is safe.
const ALLOWLIST = new Set([
  // helpers.mjs exposes tempDir(prefix, t) — caller passes t to register cleanup.
  'helpers.mjs',
  // e2e/lib/sterile-env.mjs builds a scenario's sterile env; the tmpdir must
  // outlive the builder so the runner can drive all tiers against it, and is
  // intentionally preserved on failure for forensics. Lifecycle (cleanup on
  // success, preserve + print path on failure) is the runner's responsibility,
  // not this builder's — see tests/e2e/runner.mjs.
  'e2e/lib/sterile-env.mjs',
]);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile() && full.endsWith('.mjs')) {
      out.push(full);
    }
  }
  return out;
}

const CLEANUP_PATTERNS = [
  /\bt\.after\s*\(/,
  /\bafterEach\s*\(/,
  /\bafter\s*\(/,
  /\bfs\.rmSync\s*\(/,
  /[^.]\brmSync\s*\(/,
  /\.rm\s*\(\s*[^)]*recursive/,
];

test('every tests/**/*.mjs file with mkdtempSync also has a cleanup signal', () => {
  const files = walk(HERE);
  const offenders = [];

  for (const full of files) {
    const rel = path.relative(HERE, full);
    if (ALLOWLIST.has(rel)) continue;
    const src = fs.readFileSync(full, 'utf8');
    if (!/mkdtempSync\s*\(/.test(src)) continue;
    const hasCleanup = CLEANUP_PATTERNS.some((re) => re.test(src));
    if (!hasCleanup) offenders.push(rel);
  }

  assert.deepEqual(
    offenders,
    [],
    `Files with mkdtempSync but no cleanup signal:\n  ${offenders.join('\n  ')}\n\n` +
    'Add t.after(() => fs.rmSync(dir, { recursive: true, force: true })) per test, ' +
    'or use an after() block with a tracked array. ' +
    'If the file is intentionally exempt, add it to ALLOWLIST in test-hygiene.test.mjs.'
  );
});
