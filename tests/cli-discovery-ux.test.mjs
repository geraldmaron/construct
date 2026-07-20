/**
 * tests/cli-discovery-ux.test.mjs — CLI help, list sorting, and retired-term discovery UX.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  CLI_COMMANDS_BY_CATEGORY,
  CATEGORY_ORDER,
  formatRetiredCommandHint,
  suggestClosestMatch,
} from '../lib/cli-commands.mjs';
import { tempDir } from './helpers.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const BIN = path.join(ROOT, 'bin', 'construct');

function run(args, { home, cwd, stdio } = {}) {
  const homeDir = home || tempDir('construct-cli-discovery-home-');
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: cwd || ROOT,
    encoding: 'utf8',
    env: { ...process.env, HOME: homeDir, CONSTRUCT_HOME_OVERRIDE: homeDir },
    stdio: stdio || undefined,
  });
}

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function commandNamesFromHelp(out, category) {
  const section = out.split(`▸ ${category}`)[1]?.split('\n▸ ')[0] || '';
  return stripAnsi(section)
    .split('\n')
    .map((line) => line.match(/^\s+\S+\s+(\S+)/)?.[1])
    .filter(Boolean);
}

test('core help lists commands alphabetically within each category', () => {
  const homeDir = tempDir('construct-cli-discovery-help-');
  const out = execFileSync(process.execPath, [BIN, '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, HOME: homeDir, CONSTRUCT_HOME_OVERRIDE: homeDir },
  });

  for (const category of CATEGORY_ORDER) {
    const expected = (CLI_COMMANDS_BY_CATEGORY[category] || [])
      .filter((c) => c.core)
      .map((c) => c.name);
    if (!expected.length) continue;

    const names = commandNamesFromHelp(out, category);
    assert.deepEqual(names, expected, `${category} commands should be alpha-sorted`);
  }
});

test('construct list matches worker-profile list output', () => {
  const homeDir = tempDir('construct-cli-discovery-list-');
  const env = { ...process.env, HOME: homeDir, CONSTRUCT_HOME_OVERRIDE: homeDir };
  const list = execFileSync(process.execPath, [BIN, 'list'], { cwd: ROOT, encoding: 'utf8', env });
  const workerProfiles = execFileSync(process.execPath, [BIN, 'worker-profile', 'list'], { cwd: ROOT, encoding: 'utf8', env });
  assert.equal(list, workerProfiles);
});

test('retired commands stay rejected but point at canonical replacements', () => {
  for (const [cmd, hint] of Object.entries({
    specialist: 'worker-profile',
    persona: 'worker-profile',
    scope: 'workspace-preset',
    workflow: 'procedure',
  })) {
    const result = run([cmd, 'list']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unknown command/);
    assert.match(result.stderr, new RegExp(hint.replace('-', '\\-')));
    assert.ok(formatRetiredCommandHint(cmd)?.includes(hint));
  }
});

test('unknown command typos suggest the closest live command', () => {
  const result = run(['sycn']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Did you mean.*construct sync/i);
  assert.equal(suggestClosestMatch('sycn', ['sync', 'stop']), 'sync');
});

test('registry catalog subcommand typos suggest list or show', () => {
  const result = run(['worker-profile', 'lis']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Did you mean: list\?/);
});

test('list help uses worker profile vocabulary', () => {
  const homeDir = tempDir('construct-cli-discovery-list-help-');
  const out = execFileSync(process.execPath, [BIN, 'list', '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, HOME: homeDir, CONSTRUCT_HOME_OVERRIDE: homeDir },
  });
  assert.match(out, /worker profiles/i);
  assert.doesNotMatch(out, /List all agents/i);
});

test('construct role help uses Worker Profile framing', () => {
  const homeDir = tempDir('construct-cli-discovery-role-help-');
  const out = execFileSync(process.execPath, [BIN, 'role', '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, HOME: homeDir, CONSTRUCT_HOME_OVERRIDE: homeDir },
  });
  assert.match(out, /Worker Profile invocation queue/i);
  assert.match(out, /construct worker-profile list/);
  assert.doesNotMatch(out, /Role framework/i);
});

test('worker-profile validate without input prints usage (no crash)', () => {
  const result = run(['worker-profile', 'validate'], {
    home: tempDir('construct-cli-discovery-validate-'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: construct worker-profile validate/);
  assert.doesNotMatch(result.stderr, /EAGAIN|resource temporarily unavailable/);
});

test('construct list surfaces the active Workspace Preset', () => {
  const project = tempDir('construct-cli-discovery-list-preset-');
  fs.writeFileSync(
    path.join(project, 'construct.config.json'),
    `${JSON.stringify({ version: 1, workspacePreset: 'creative' }, null, 2)}\n`,
  );
  const homeDir = tempDir('construct-cli-discovery-list-preset-home-');
  const out = execFileSync(process.execPath, [BIN, 'list'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, HOME: homeDir, CONSTRUCT_HOME_OVERRIDE: homeDir },
  });
  assert.match(out, /^Active preset: creative\n/m);
  const viaWorkerProfile = execFileSync(process.execPath, [BIN, 'worker-profile', 'list'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, HOME: homeDir, CONSTRUCT_HOME_OVERRIDE: homeDir },
  });
  assert.equal(out, viaWorkerProfile);
});
