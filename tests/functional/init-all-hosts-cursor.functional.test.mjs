/**
 * tests/functional/init-all-hosts-cursor.functional.test.mjs
 *
 * Isolation UX regression: `construct init --all-hosts` must materialise
 * `.cursor/mcp.json` (and rules) even when Cursor is not detected on PATH.
 * Also pins `--with-cursor` as a union with detection (does not replace),
 * and proves Cursor does not get a duplicate `.cursor/skills/` tree —
 * skills stay under `.claude/skills/` (Cursor loads that path natively;
 * construct-p2wlb).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

function runInit(dir, home, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [BIN, 'init', '--yes', '--no-start', '--no-beads', ...extraArgs],
    {
      cwd: dir,
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
        BOOTSTRAP_CHECKED: '1',
        HOME: home,
        CONSTRUCT_HOME_OVERRIDE: home,
        PATH: '/usr/bin:/bin',
      },
    },
  );
}

test('construct init --all-hosts creates .cursor/ in an isolated tmpdir', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'init-all-hosts-'));
  const home = mkdtempSync(join(tmpdir(), 'init-all-hosts-home-'));
  t.after(() => {
    rmTmpDir(dir);
    rmTmpDir(home);
  });

  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: dir });
  const result = runInit(dir, home, ['--all-hosts']);
  assert.equal(result.status, 0, `init exited ${result.status}: ${result.stderr}\n${result.stdout}`);
  assert.ok(existsSync(join(dir, '.cursor', 'mcp.json')), 'expected .cursor/mcp.json after --all-hosts');
  assert.ok(existsSync(join(dir, '.cursor', 'rules', 'construct.mdc')), 'expected .cursor/rules/construct.mdc');
  assert.ok(existsSync(join(dir, '.claude', 'settings.json')), 'expected .claude/ still present under --all-hosts');
});

test('construct init --with-cursor unions Cursor without requiring Cursor on PATH', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'init-with-cursor-'));
  const home = mkdtempSync(join(tmpdir(), 'init-with-cursor-home-'));
  t.after(() => {
    rmTmpDir(dir);
    rmTmpDir(home);
  });

  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'settings.json'), '{}\n');

  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: dir });
  const result = runInit(dir, home, ['--with-cursor']);
  assert.equal(result.status, 0, `init exited ${result.status}: ${result.stderr}\n${result.stdout}`);
  assert.ok(existsSync(join(dir, '.cursor', 'mcp.json')), 'expected .cursor/mcp.json after --with-cursor');
});

test('construct init --with-cursor keeps Claude skills; refuses .cursor/skills mirror', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'init-with-cursor-skills-'));
  const home = mkdtempSync(join(tmpdir(), 'init-with-cursor-skills-home-'));
  t.after(() => {
    rmTmpDir(dir);
    rmTmpDir(home);
  });

  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'settings.json'), '{}\n');
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: dir });

  const result = runInit(dir, home, ['--with-cursor']);
  assert.equal(result.status, 0, `init exited ${result.status}: ${result.stderr}\n${result.stdout}`);

  const claudeSkills = join(dir, '.claude', 'skills');
  assert.ok(existsSync(claudeSkills), 'lean+--with-cursor must still sync .claude/skills');
  const skillFiles = readdirSync(claudeSkills, { recursive: true })
    .filter((f) => String(f).endsWith('SKILL.md'));
  assert.ok(skillFiles.length >= 50, `expected >=50 SKILL.md under .claude/skills, got ${skillFiles.length}`);

  assert.ok(!existsSync(join(dir, '.cursor', 'skills')), 'must not mirror skills into .cursor/skills');
  assert.ok(!existsSync(join(dir, '.agents', 'skills')), 'must not mirror skills into .agents/skills');
  assert.ok(!existsSync(join(dir, '.cursor', 'hooks.json')), 'must not ship fake Cursor hook parity (.cursor/hooks.json)');

  const rules = readFileSync(join(dir, '.cursor', 'rules', 'construct.mdc'), 'utf8');
  assert.match(rules, /\.claude\/skills\//, 'Cursor rules must point at .claude/skills/');
  assert.match(rules, /get_skill/, 'Cursor rules must mention MCP get_skill');
  assert.match(rules, /\.cursor\/skills\//, 'Cursor rules must explicitly refuse .cursor/skills/ mirror expectation');
  assert.match(rules, /hooks\.json/, 'Cursor rules must disclose Construct does not ship .cursor/hooks.json');
  assert.match(rules, /release:check|lint:comments/, 'Cursor rules must point at fail-closed CLI compensating gates');
});
