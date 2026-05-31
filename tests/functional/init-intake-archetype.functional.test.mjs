/**
 * tests/functional/init-intake-archetype.functional.test.mjs
 *
 * End-to-end coverage for Piece C: when a project initializes with a profile
 * whose capabilities.intake block is on, `construct init` scaffolds the
 * archetype shape (inbox/ + .gitignore, .cx/intake/manifest.json) and stamps
 * attribution onto markdown artifacts (AGENTS.md, plan.md, .cx/context.md).
 *
 * Cases:
 *   1. rnd profile (capabilities.intake on) → inbox/, manifest, attribution
 *   2. attribution.disable env var → no createdBy fields on artifacts
 *   3. idempotent re-run does not clobber an existing inbox/.gitignore
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'init-intake-archetype-'));
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'archetype-test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Archetype Test'], { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runInit(cwd, { profile = 'rnd', extraEnv = {} } = {}) {
  return spawnSync(process.execPath, [BIN, 'init', '--yes', `--profile=${profile}`], {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
      BOOTSTRAP_CHECKED: '1',
      CONSTRUCT_AGENT_ID: 'test-agent',
      ...extraEnv,
    },
  });
}

test('init with rnd profile scaffolds inbox/, .gitignore, and the dedup manifest', () => {
  const p = makeProject();
  try {
    const result = runInit(p.dir);
    assert.equal(result.status, 0, `init exited ${result.status}: ${result.stderr}`);

    const inboxDir = join(p.dir, 'inbox');
    assert.ok(existsSync(inboxDir), 'expected inbox/ at project root');

    const inboxGitignore = join(inboxDir, '.gitignore');
    assert.ok(existsSync(inboxGitignore), 'expected inbox/.gitignore');
    const ignoreContent = readFileSync(inboxGitignore, 'utf8');
    assert.match(ignoreContent, /^\*\n!\.gitignore\n$/, 'gitignore must allow only itself');

    const manifestPath = join(p.dir, '.cx', 'intake', 'manifest.json');
    assert.ok(existsSync(manifestPath), 'expected .cx/intake/manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.version, 1);
    assert.deepEqual(manifest.files, {});
  } finally {
    p.cleanup();
  }
});

test('init stamps createdBy / createdByAgent on AGENTS.md when attribution is on', () => {
  const p = makeProject();
  try {
    const result = runInit(p.dir);
    assert.equal(result.status, 0, `init exited ${result.status}: ${result.stderr}`);

    const agents = readFileSync(join(p.dir, 'AGENTS.md'), 'utf8');
    assert.match(agents, /created_by: Archetype Test <archetype-test@example\.com>/);
    assert.match(agents, /created_by_agent: test-agent/);
  } finally {
    p.cleanup();
  }
});

test('CONSTRUCT_ATTRIBUTION_DISABLE suppresses createdBy fields', () => {
  const p = makeProject();
  try {
    const result = runInit(p.dir, { extraEnv: { CONSTRUCT_ATTRIBUTION_DISABLE: '1' } });
    assert.equal(result.status, 0, `init exited ${result.status}: ${result.stderr}`);

    const agents = readFileSync(join(p.dir, 'AGENTS.md'), 'utf8');
    assert.doesNotMatch(agents, /created_by:/);
    assert.doesNotMatch(agents, /created_by_agent:/);
  } finally {
    p.cleanup();
  }
});

test('init does not clobber an existing inbox/.gitignore on re-run', () => {
  const p = makeProject();
  try {
    runInit(p.dir);
    const inboxGitignore = join(p.dir, 'inbox', '.gitignore');
    const customContent = '# custom user content\n*\n!.gitignore\n!README.md\n';
    writeFileSync(inboxGitignore, customContent, 'utf8');

    const result = runInit(p.dir);
    assert.equal(result.status, 0);
    assert.equal(readFileSync(inboxGitignore, 'utf8'), customContent, 'existing .gitignore must survive re-init');
  } finally {
    p.cleanup();
  }
});

test('init.cx/context.json carries createdBy attribution when capability is on', () => {
  const p = makeProject();
  try {
    const result = runInit(p.dir);
    assert.equal(result.status, 0);
    const ctx = JSON.parse(readFileSync(join(p.dir, '.cx', 'context.json'), 'utf8'));
    assert.equal(ctx.createdBy, 'Archetype Test <archetype-test@example.com>');
    assert.equal(ctx.createdByAgent, 'test-agent');
    assert.ok(typeof ctx.createdAt === 'string' && ctx.createdAt.length > 0);
  } finally {
    p.cleanup();
  }
});
