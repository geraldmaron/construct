/**
 * tests/functional/profile-ux-preview.functional.test.mjs. Mutating scope
 * subcommands must preview-then-confirm.
 *
 * Pins the UX contract for `scope set` and `scope archive`:
 *   --dry-run produces a structured preview and writes nothing.
 *   --yes bypasses the interactive prompt for scripts and CI.
 *   archive refuses when the reason is shorter than 8 chars.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');

const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-ux-home-'));
after(() => fs.rmSync(SANDBOX_HOME, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

function freshProject(scopeId = 'rnd') {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-ux-'));
  fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify({ version: 1, scope: scopeId }, null, 2) + '\n');
  return cwd;
}

function run(args, { cwd, env = {} } = {}) {
  return spawnSync('node', [BIN, ...args], {
    cwd,
    env: { ...process.env, CX_TOOLKIT_DIR: REPO, HOME: SANDBOX_HOME, CX_HOME_OVERRIDE: SANDBOX_HOME, ...env },
    encoding: 'utf8',
  });
}

test('scope set --dry-run previews the structural diff without writing', () => {
  const cwd = freshProject('rnd');
  const before = fs.readFileSync(path.join(cwd, 'construct.config.json'), 'utf8');
  const res = run(['scope', 'set', 'creative', '--dry-run'], { cwd });
  assert.equal(res.status, 0, `expected 0 exit, got ${res.status}. stderr: ${res.stderr}`);
  assert.ok(res.stdout.includes('About to switch active scope'));
  assert.ok(res.stdout.includes('from:  rnd'));
  assert.ok(res.stdout.includes('to:    creative'));
  assert.ok(res.stdout.includes('Structural diff'));
  assert.ok(res.stdout.includes('[dry-run] No files were written.'));
  const after = fs.readFileSync(path.join(cwd, 'construct.config.json'), 'utf8');
  assert.equal(before, after, 'config.json must be unchanged after --dry-run');
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('scope set --yes writes the new scope without prompting', () => {
  const cwd = freshProject('rnd');
  const res = run(['scope', 'set', 'operations', '--yes'], { cwd });
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  const after = JSON.parse(fs.readFileSync(path.join(cwd, 'construct.config.json'), 'utf8'));
  assert.equal(after.scope, 'operations');
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('scope set is a no-op when the target equals the current scope', () => {
  const cwd = freshProject('rnd');
  const before = fs.readFileSync(path.join(cwd, 'construct.config.json'), 'utf8');
  const res = run(['scope', 'set', 'rnd', '--yes'], { cwd });
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes('already set'));
  const after = fs.readFileSync(path.join(cwd, 'construct.config.json'), 'utf8');
  assert.equal(before, after);
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('scope archive --dry-run shows what files would move without touching them', () => {
  const cwd = freshProject('rnd');
  const scopeFile = path.join(REPO, 'specialists', 'org', 'scopes', 'creative.json');
  const sizeBefore = fs.statSync(scopeFile).size;
  const res = run(['scope', 'archive', 'creative', '--reason=functional test preview', '--dry-run', '--yes'], { cwd });
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  assert.ok(res.stdout.includes('About to archive curated scope'));
  assert.ok(res.stdout.includes('reason:       functional test preview'));
  assert.ok(res.stdout.includes('Files that will move'));
  assert.ok(res.stdout.includes('What stays'));
  assert.ok(res.stdout.includes('[dry-run] No files were moved.'));
  assert.equal(fs.statSync(scopeFile).size, sizeBefore, 'scope file must not change under --dry-run');
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('scope archive fails fast when reason is too short', () => {
  const cwd = freshProject('rnd');
  const res = run(['scope', 'archive', 'creative', '--reason=too', '--yes'], { cwd });
  assert.notEqual(res.status, 0);
  assert.ok(res.stderr.includes('substantive --reason'));
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
