/**
 * tests/functional/cli-clickable-links.functional.test.mjs — end-to-end link contract.
 *
 * Spawns the real construct binary and asserts the help surface emits OSC-8
 * hyperlinks whose visible label is the raw doc path, the invariant Terminal.app
 * Cmd-click depends on. A plain pipe (no link-capable TERM_PROGRAM) must stay free
 * of OSC-8 so redirected and CI output is clean.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(ROOT, 'bin', 'construct');
const OSC8_OPEN = '\x1b]8;;';

// lib/paths.mjs resolves the machine-scoped state root from
// process.env directly, so a spawned `construct` must get its own sandboxed
// HOME to avoid registering this repo under the real developer machine's
// ~/.construct/projects/.

const SANDBOX_HOME = mkdtempSync(join(tmpdir(), 'cli-clickable-links-home-'));
process.on('exit', () => rmTmpDir(SANDBOX_HOME));

function run(args, env) {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    cwd: ROOT,
    env: { ...process.env, HOME: SANDBOX_HOME, CONSTRUCT_HOME_OVERRIDE: SANDBOX_HOME, ...env },
    encoding: 'utf8',
  });
  return res.stdout || '';
}

test('help footer emits an OSC-8 doc link with the path as the visible label', () => {
  const out = run(['doctor', '--help'], {
    TERM_PROGRAM: 'vscode',
    NO_COLOR: '',
    CONSTRUCT_PLAIN_COPY: '0',
    CONSTRUCT_LINKS: '1',
  });
  assert.ok(out.includes(OSC8_OPEN), 'expected an OSC-8 hyperlink in help output');
  assert.ok(out.includes('file://') && out.includes('docs/guides/reference/cli'), 'expected a file:// href to the cli docs');

  const linkMatch = out.match(/\x1b\]8;;file:[^\x07]*\x07([^\x1b]*)\x1b\]8;;\x07/);
  assert.ok(linkMatch, 'expected a parseable OSC-8 link');
  assert.equal(linkMatch[1].replace(/\x1b\[[0-9;]*m/g, ''), 'docs/guides/reference/cli/');
});

test('plain pipe output carries no OSC-8 sequences', () => {
  const out = run(['--help'], { TERM_PROGRAM: '', WT_SESSION: '', NO_COLOR: '1' });
  assert.ok(!out.includes(OSC8_OPEN), 'redirected output must not contain OSC-8');
});
