/**
 * tests/consumer/optional-deps-absent.test.mjs — verifies CLI key commands work
 * when optional dependencies (ink, react) are absent.
 *
 * ink and react are optional dependencies (package.json#optionalDependencies).
 * Commands like `construct version`, lightweight JSON-output commands, and the
 * MCP server entry must remain functional when those packages are not installed.
 *
 * Approach: the CLI already imports ink/react nowhere in the critical path
 * (bin/construct, lib/cli-commands.mjs, lib/mcp/server.mjs). These tests assert
 * that invariant holds and that the key commands exit 0 in a real subprocess.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test, { before, after } from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = resolve(ROOT, 'bin', 'construct');

// Both subprocess-spawning tests below share this project's own sandboxed HOME
// so `construct version`/`construct evals` never touch the real developer
// machine's ~/.construct/projects/ (ADR-0066 machine-scoped state root).

let HOME;
before(() => { HOME = mkdtempSync(join(tmpdir(), 'optional-deps-absent-home-')); });
after(() => { rmTmpDir(HOME); });

// Static top-level import patterns that would throw when ink/react are absent.

const INK_STATIC_RE = /^import\s+.+\s+from\s+['"]ink['"]/m;
const REACT_STATIC_RE = /^import\s+.+\s+from\s+['"]react['"]/m;

test('construct version exits 0 and prints version string', () => {
  const stdout = execFileSync(process.execPath, [BIN, 'version'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, HOME, CX_HOME_OVERRIDE: HOME },
  });

  assert.match(stdout.trim(), /^construct v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
    'version output must match "construct vX.Y.Z" (with an optional -prerelease suffix)');
});

test('construct evals --json exits 0 and returns valid JSON', () => {
  const stdout = execFileSync(process.execPath, [BIN, 'evals', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, HOME, CX_HOME_OVERRIDE: HOME },
  });

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    assert.fail(`construct evals --json did not emit valid JSON: ${err.message}`);
  }

  assert.equal(typeof parsed.backendUrl, 'string', 'response must include backendUrl');
  assert.equal(typeof parsed.configured, 'boolean', 'response must include configured flag');
});

test('bin/construct has no static top-level ink import', () => {
  const src = readFileSync(BIN, 'utf8');

  // Confirm there is no `import ... from 'ink'` at the module top level.
  // A dynamic `await import('ink')` inside a function is allowed and safe; only
  // the static form (evaluated at module parse time) would throw when ink is absent.

  assert.ok(
    !INK_STATIC_RE.test(src),
    'bin/construct must not statically import from \'ink\' — use dynamic import() so the CLI works without ink installed',
  );
});

test('bin/construct has no static top-level react import', () => {
  const src = readFileSync(BIN, 'utf8');

  assert.ok(
    !REACT_STATIC_RE.test(src),
    'bin/construct must not statically import from \'react\' — use dynamic import() so the CLI works without react installed',
  );
});

test('lib/cli-commands.mjs has no static ink or react import', () => {
  const src = readFileSync(resolve(ROOT, 'lib', 'cli-commands.mjs'), 'utf8');

  assert.ok(
    !INK_STATIC_RE.test(src),
    'lib/cli-commands.mjs must not statically import from \'ink\'',
  );
  assert.ok(
    !REACT_STATIC_RE.test(src),
    'lib/cli-commands.mjs must not statically import from \'react\'',
  );
});

test('lib/mcp/server.mjs has no static ink or react import', () => {
  const src = readFileSync(resolve(ROOT, 'lib', 'mcp', 'server.mjs'), 'utf8');

  assert.ok(
    !INK_STATIC_RE.test(src),
    'lib/mcp/server.mjs must not statically import from \'ink\'',
  );
  assert.ok(
    !REACT_STATIC_RE.test(src),
    'lib/mcp/server.mjs must not statically import from \'react\'',
  );
});

test('ink and react are listed as optionalDependencies in package.json', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  const optDeps = pkg.optionalDependencies ?? {};

  assert.ok('ink' in optDeps, 'ink must be in optionalDependencies');
  assert.ok('react' in optDeps, 'react must be in optionalDependencies');

  // They must NOT appear in core dependencies, where their absence would break installs.
  const coreDeps = pkg.dependencies ?? {};
  assert.ok(!('ink' in coreDeps), 'ink must not be in core dependencies');
  assert.ok(!('react' in coreDeps), 'react must not be in core dependencies');
});
