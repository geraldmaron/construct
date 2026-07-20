/**
 * tests/functional/init-docs-menu.functional.test.mjs
 *
 * construct-su4dd: scripted interactive harness for init's docs setup menu.
 * CI has no reliable pseudo-TTY; CONSTRUCT_PROMPT_SCRIPT_FILE drives Packs /
 * Individual / Skip paths without manual input. Real TTY behavior remains
 * covered by lib/tty-prompts.mjs plus the injected unit tests in
 * tests/init-docs-interactive.test.mjs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';
import { DOC_PRESETS, DOC_LANES } from '../../lib/init/doc-lanes.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'init-docs-menu-'));
  const HOME = join(root, 'HOME');
  const project = join(root, 'project');
  mkdirSync(HOME, { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'README.md'), '# Existing project readme\n');
  writeFileSync(join(project, 'package.json'), '{"name":"init-docs-menu-check"}\n');
  return {
    root,
    HOME,
    project,
    cleanup() {
      rmTmpDir(root);
    },
  };
}

function writePromptScript(root, script) {
  const scriptPath = join(root, 'prompt-script.json');
  writeFileSync(scriptPath, `${JSON.stringify(script)}\n`);
  return scriptPath;
}

function runInteractiveInit(env, script) {
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: env.project });
  spawnSync('git', ['config', 'user.email', 'init-docs-menu@example.com'], { cwd: env.project });
  spawnSync('git', ['config', 'user.name', 'Init Docs Menu Test'], { cwd: env.project });

  const scriptPath = writePromptScript(env.root, script);
  return spawnSync(
    process.execPath,
    [BIN, 'init', '--interactive', '--no-start', '--no-beads'],
    {
      cwd: env.project,
      encoding: 'utf8',
      timeout: 120_000,
      env: sterileSpawnEnv({
        HOME: env.HOME,
        USERPROFILE: env.HOME,
        CONSTRUCT_HOME_OVERRIDE: env.HOME,
        XDG_CONFIG_HOME: join(env.HOME, '.config'),
        XDG_DATA_HOME: join(env.HOME, '.local', 'share'),
        XDG_CACHE_HOME: join(env.HOME, '.cache'),
        XDG_RUNTIME_DIR: join(env.HOME, 'run'),
        CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
        BOOTSTRAP_CHECKED: '1',
        NODE_ENV: 'test',
        CONSTRUCT_PROMPT_SCRIPT_FILE: scriptPath,
      }),
    },
  );
}

test('interactive init Skip path scaffolds docs/ only via prompt harness', async (t) => {
  const env = sandbox();
  t.after(env.cleanup);

  const result = runInteractiveInit(env, { select: ['skip'], confirm: [] });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  assert.ok(existsSync(join(env.project, 'docs', 'README.md')));
  assert.equal(existsSync(join(env.project, 'docs', 'adr')), false);
  assert.equal(existsSync(join(env.project, 'docs', 'prds')), false);
  assert.equal(existsSync(join(env.project, 'docs', 'architecture.md')), false);
});

test('interactive init Packs → lean scaffolds lean lanes via prompt harness', async (t) => {
  const env = sandbox();
  t.after(env.cleanup);

  const result = runInteractiveInit(env, {
    select: ['packs', 'lean'],
    confirm: [false],
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  for (const lane of DOC_PRESETS.lean) {
    const dirName = DOC_LANES[lane].dir;
    assert.ok(
      existsSync(join(env.project, 'docs', dirName, 'README.md')),
      `expected lean lane docs/${dirName}/README.md`,
    );
  }
  assert.equal(existsSync(join(env.project, 'docs', 'rfcs')), false);
  assert.equal(existsSync(join(env.project, 'docs', 'architecture.md')), false);
});

test('interactive init Individual path scaffolds selected lanes via prompt harness', async (t) => {
  const env = sandbox();
  t.after(env.cleanup);

  const result = runInteractiveInit(env, {
    select: ['individual'],
    multiSelect: [['adrs', 'prds']],
    confirm: [false],
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  assert.ok(existsSync(join(env.project, 'docs', 'adr', 'README.md')));
  assert.ok(existsSync(join(env.project, 'docs', 'prds', 'README.md')));
  assert.equal(existsSync(join(env.project, 'docs', 'rfcs')), false);
});

test('prompt harness fails when menu options drift without updating the script', async (t) => {
  const env = sandbox();
  t.after(env.cleanup);

  const result = runInteractiveInit(env, { select: ['not-a-real-menu-value'], confirm: [] });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /not found in menu/i);
});
