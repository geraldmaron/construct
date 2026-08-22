/**
 * tests/scripts/lint-skill-pack-skew.test.ts: whether a committed skill pack
 * directory is checked, byte for byte, against what this checkout's own
 * catalog would generate right now.
 *
 * The catalog (lenses, playbooks, standards) is never faked: it is imported
 * here exactly as the lint imports it, so the fresh pack this file builds
 * and the fresh pack the lint builds are the same computation, twice. Only
 * the committed side is a fixture, written into a scratch directory this
 * test owns alone, never into the real .claude/skills/ every other session
 * and gate run shares.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { LENSES } from '../../src/kernel/plan/lenses.ts';
import { allPlaybooks } from '../../src/kernel/plan/playbooks.ts';
import { LENS_STANDARDS } from '../../src/kernel/plan/standards.ts';
import { projectSkillsPack } from '../../src/kernel/skills/projection.ts';
import { packageVersion } from '../../src/cli/runtime.ts';

const execFileAsync = promisify(execFile);
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const LINT = fileURLToPath(new URL('../../scripts/lint-skill-pack-skew.mjs', import.meta.url));

const VERSION = packageVersion();
const FRESH = projectSkillsPack({
  lenses: LENSES,
  playbooks: allPlaybooks(),
  standards: LENS_STANDARDS,
  version: VERSION,
});

function scratchRoot(): string {
  return mkdtempSync(join(tmpdir(), 'construct-lint-skill-pack-skew-'));
}

/** Writes generated files exactly as `construct skills --out=<dir>` would. */
function writePack(packDir: string, files: readonly { path: string; content: string }[]): void {
  for (const file of files) {
    const target = join(packDir, ...file.path.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
}

function writeFolder(packDir: string, directory: string, skillMd: string): void {
  const dir = join(packDir, directory);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), skillMd);
}

async function runLint(root: string): Promise<{ code: number; stderr: string }> {
  try {
    const { stderr } = await execFileAsync(process.execPath, [LINT, root], { cwd: REPO });
    return { code: 0, stderr };
  } catch (err) {
    const e = err as { code?: number; stderr?: string };
    return { code: e.code ?? 1, stderr: e.stderr ?? '' };
  }
}

test('a freshly generated pack, written verbatim, matches itself', async () => {
  const root = scratchRoot();
  try {
    writePack(join(root, '.claude', 'skills'), FRESH);
    const r = await runLint(root);
    assert.equal(r.code, 0, r.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a folder edited by hand after generation fails, naming the folder', async () => {
  const root = scratchRoot();
  try {
    const packDir = join(root, '.claude', 'skills');
    writePack(packDir, FRESH);
    const target = FRESH[0];
    writeFileSync(join(packDir, ...target.path.split('/')), `${target.content}\nedited after generation\n`);
    const r = await runLint(root);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes(target.directory), r.stderr);
    assert.match(r.stderr, /does not match what the current catalog would generate/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a folder the catalog currently projects but the pack lacks fails as missing', async () => {
  const root = scratchRoot();
  try {
    writePack(join(root, '.claude', 'skills'), FRESH.slice(1));
    const r = await runLint(root);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes(FRESH[0].directory), r.stderr);
    assert.match(r.stderr, /is missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a generated folder the catalog no longer projects fails as orphaned', async () => {
  const root = scratchRoot();
  try {
    const packDir = join(root, '.claude', 'skills');
    writePack(packDir, FRESH);
    writeFolder(
      packDir,
      'construct-a-lens-that-no-longer-exists',
      [
        '---',
        'name: construct-a-lens-that-no-longer-exists',
        'description: fixture only, not a real lens.',
        'metadata:',
        '  generator: construct',
        '  version: 0.0.0-test',
        '---',
        '',
        'fixture body',
        '',
      ].join('\n'),
    );
    const r = await runLint(root);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes('construct-a-lens-that-no-longer-exists'), r.stderr);
    assert.match(r.stderr, /no longer projects a skill by that name/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a hand-authored folder with no generation marker is not this lint\'s business', async () => {
  const root = scratchRoot();
  try {
    const packDir = join(root, '.claude', 'skills');
    writePack(packDir, FRESH);
    writeFolder(
      packDir,
      'my-own-skill',
      ['---', 'name: my-own-skill', 'description: written by hand, no generator marker.', '---', '', 'not construct output', ''].join(
        '\n',
      ),
    );
    const r = await runLint(root);
    assert.equal(r.code, 0, r.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('no .claude/skills directory at all fails rather than passing on nothing to compare', async () => {
  const root = scratchRoot();
  try {
    const r = await runLint(root);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes(FRESH[0].directory), r.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
