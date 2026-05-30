/**
 * tests/hooks/no-skip-vars.test.mjs — pins the no-skip-vars principle.
 *
 * Scans every .mjs file under lib/hooks/ for env-var references matching
 * the CONSTRUCT_SKIP_ / CONSTRUCT_ALLOW_ / CONSTRUCT_QUIET_ prefix and
 * fails on any match outside an explicit allowlist. The allowlist starts
 * empty by design: a hook that needs a skip is signalling that the
 * underlying gate is wrong-shaped; the fix is to repair the gate, not
 * re-introduce the bypass.
 *
 * Matches:
 *   process.env.CONSTRUCT_SKIP_FOO
 *   process.env['CONSTRUCT_SKIP_FOO']
 *   "CONSTRUCT_SKIP_FOO=1"          (in bash-command parsers)
 *   CONSTRUCT_SKIP_FOO (any token reference; over-matches docstrings, see below)
 *
 * Docstring mentions are allowed only inside the explicit ALLOWED_REFERENCES
 * set — lines that exist to explain why the principle is enforced
 * (e.g. comments stating "no skip env vars" or "no bypass mechanism").
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const HOOKS_DIR = path.join(ROOT, 'lib', 'hooks');

const SKIP_VAR_PATTERN = /\bCONSTRUCT_(?:SKIP|ALLOW|QUIET)_[A-Z0-9_]+/g;

// Allowlist of trimmed lines exempt from the scan. Empty by design — any
// reintroduction should fix the gate, not allowlist the bypass. Add entries
// only with a written justification.

const ALLOWED_LINES = new Set([]);

function listHookFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listHookFiles(full));
    } else if (full.endsWith('.mjs')) {
      out.push(full);
    }
  }
  return out;
}

describe('no skip env vars in lib/hooks/*.mjs', () => {
  const files = listHookFiles(HOOKS_DIR);

  it('hooks directory is non-empty (sanity)', () => {
    assert.ok(files.length > 0, 'expected at least one hook .mjs file');
  });

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    it(`${rel} contains no CONSTRUCT_SKIP_ / CONSTRUCT_ALLOW_ / CONSTRUCT_QUIET_ references`, () => {
      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      const offenders = [];
      lines.forEach((line, idx) => {
        const matches = line.match(SKIP_VAR_PATTERN);
        if (!matches) return;
        if (ALLOWED_LINES.has(line.trim())) return;
        offenders.push(`${rel}:${idx + 1}  ${line.trim()}`);
      });
      assert.equal(
        offenders.length,
        0,
        `Skip env var detected — see plan principle "no skip vars on quality gates". ` +
        `Either fix the gate or add the line to ALLOWED_LINES with justification.\n` +
        offenders.join('\n'),
      );
    });
  }
});
