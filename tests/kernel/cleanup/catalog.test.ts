/**
 * tests/kernel/cleanup/catalog.test.ts — fixture-home coverage for the
 * predecessor-trace detection catalog. Fixtures mirror the artifacts a real
 * v2 install accumulates (construct-legacy's own lib/uninstall/uninstall.mjs
 * and its test suite are the reference), rooted in tmpdirs so nothing ever
 * touches a real project or a real $HOME.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolvePaths } from '../../../src/kernel/paths.ts';
import { buildCleanupCatalog } from '../../../src/kernel/cleanup/catalog.ts';
import { detectedItems, selectedItems, applyCleanup } from '../../../src/kernel/cleanup/run.ts';
import type { CleanupOptions } from '../../../src/kernel/cleanup/run.ts';

interface Fixture {
  readonly cwd: string;
  readonly home: string;
  cleanup(): void;
}

function mkFixture(): Fixture {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cleanup-proj-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cleanup-home-'));
  return {
    cwd,
    home,
    cleanup: () => {
      fs.rmSync(cwd, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

function seedProject(cwd: string): void {
  fs.mkdirSync(path.join(cwd, '.construct', 'launcher', 'cache', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.construct', 'launcher', 'version'), '0.1.0\n');

  fs.mkdirSync(path.join(cwd, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.claude', 'agents', 'construct.md'), '# construct persona\n');
  fs.writeFileSync(path.join(cwd, '.claude', 'agents', 'engineer.md'), '# engineer\n');
  fs.writeFileSync(path.join(cwd, '.claude', 'agents', 'user-custom.md'), '# user-owned\n');
  fs.writeFileSync(path.join(cwd, '.claude', 'agents', '.construct-manifest'), 'construct.md\nengineer.md\n');

  fs.mkdirSync(path.join(cwd, '.claude', 'commands', 'core'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.claude', 'commands', 'core', 'reset.md'), '# reset\n');
  fs.writeFileSync(path.join(cwd, '.claude', 'commands', '.construct-manifest'), 'core/reset.md\n');

  fs.writeFileSync(
    path.join(cwd, '.claude', 'settings.json'),
    JSON.stringify(
      {
        hooks: { 'pre:session': [{ command: 'node .construct/launcher/run.mjs hook pre-session' }] },
        mcpServers: {
          context7: { command: 'npx' },
          'construct-mcp': { command: 'node' },
          'user-private-server': { command: 'node' },
        },
        userOnlyKey: { keepMe: true },
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(cwd, '.mcp.json'),
    JSON.stringify(
      {
        mcpServers: {
          context7: { command: 'npx' },
          'construct-mcp': { command: 'node' },
          'user-private-server': { command: 'node' },
        },
      },
      null,
      2,
    ),
  );

  fs.mkdirSync(path.join(cwd, '.construct', 'inbox'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.construct', 'context.json'), '{}');

  fs.writeFileSync(path.join(cwd, 'AGENTS.md'), '# scaffolded\n');
  fs.writeFileSync(path.join(cwd, 'plan.md'), '# plan\n');

  execFileSync('git', ['init', '-q'], { cwd });
  execFileSync('git', ['config', 'core.hooksPath', '.beads/hooks'], { cwd });
}

function seedHome(home: string): void {
  const paths = resolvePaths({}, home);
  fs.mkdirSync(path.join(paths.stateDir, 'workspace'), { recursive: true });
  fs.mkdirSync(path.join(paths.stateDir, 'vector'), { recursive: true });
  fs.writeFileSync(path.join(paths.stateDir, 'vector', 'index.json'), '{}');

  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.writeFileSync(path.join(paths.dataDir, 'completions.sh'), '# completions\n');

  fs.mkdirSync(path.join(paths.cacheDir, 'embeddings'), { recursive: true });
  fs.writeFileSync(path.join(paths.cacheDir, 'embeddings', 'model.onnx'), 'pretend');

  fs.mkdirSync(paths.configDir, { recursive: true });
  fs.writeFileSync(path.join(paths.configDir, 'config.env'), 'ANTHROPIC_API_KEY=sk-test\n');
  fs.mkdirSync(path.join(paths.configDir, 'services', 'postgres'), { recursive: true });
  fs.writeFileSync(path.join(paths.configDir, 'services', 'postgres', 'docker-compose.yml'), 'version: "3"\n');
  fs.symlinkSync(path.join(home, 'somewhere-else'), path.join(paths.configDir, 'lib'));

  fs.writeFileSync(
    path.join(home, '.claude.json'),
    JSON.stringify({ mcpServers: { memory: { command: 'node' }, github: { command: 'gh' } } }, null, 2),
  );
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.claude', 'settings.json'),
    JSON.stringify({ mcpServers: { cass: { command: 'node' }, other: { command: 'x' } } }, null, 2),
  );
  fs.mkdirSync(path.join(home, '.config', 'opencode'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.config', 'opencode', 'opencode.json'),
    JSON.stringify({ mcp: { memory: { command: 'node' }, other: { command: 'x' } } }, null, 2),
  );
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.codex', 'config.toml'),
    '[mcp_servers.memory]\ncommand = "node"\n\n[mcp_servers.other]\ncommand = "x"\n',
  );
}

function readGitHooksPath(cwd: string): string | null {
  try {
    return execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return null; // git exits non-zero when the key is unset
  }
}

function seeded(): { fixture: Fixture; paths: ReturnType<typeof resolvePaths> } {
  const fixture = mkFixture();
  seedProject(fixture.cwd);
  seedHome(fixture.home);
  return { fixture, paths: resolvePaths({}, fixture.home) };
}

const DEFAULT_OPTIONS: CleanupOptions = { scope: 'all', all: false, keepState: false };

test('detects every seeded trace across project and machine scope', () => {
  const { fixture, paths } = seeded();
  try {
    const catalog = buildCleanupCatalog({ cwd: fixture.cwd, home: fixture.home, paths });
    const detected = detectedItems(catalog, DEFAULT_OPTIONS);
    const ids = detected.map((item) => item.id).sort();
    assert.deepEqual(ids, [
      'machine-cache-embeddings',
      'machine-config-env',
      'machine-data',
      'machine-lib-symlink',
      'machine-memory-mcp',
      'machine-postgres-compose',
      'machine-state',
      'project-agents',
      'project-commands',
      'project-git-hookspath',
      'project-launcher',
      'project-scaffold',
      'project-settings',
      'project-state',
    ]);
  } finally {
    fixture.cleanup();
  }
});

test('default run (auto-risk only) removes launcher, manifested agents, hooks; preserves ask-risk state', () => {
  const { fixture, paths } = seeded();
  try {
    const catalog = buildCleanupCatalog({ cwd: fixture.cwd, home: fixture.home, paths });
    const detected = detectedItems(catalog, DEFAULT_OPTIONS);
    const toRemove = selectedItems(detected, false);
    applyCleanup(detected, new Set(toRemove.map((i) => i.id)));

    assert.equal(fs.existsSync(path.join(fixture.cwd, '.construct', 'launcher')), false, 'launcher removed');
    assert.ok(fs.existsSync(path.join(fixture.cwd, '.construct')), '.construct state preserved (ask-risk)');
    assert.ok(fs.existsSync(path.join(fixture.cwd, '.construct', 'context.json')), 'context.json preserved');

    assert.equal(fs.existsSync(path.join(fixture.cwd, '.claude', 'agents', 'construct.md')), false, 'manifested agent removed');
    assert.equal(fs.existsSync(path.join(fixture.cwd, '.claude', 'agents', 'engineer.md')), false, 'manifested agent removed');
    assert.ok(fs.existsSync(path.join(fixture.cwd, '.claude', 'agents', 'user-custom.md')), 'user-owned agent preserved');

    const settings = JSON.parse(fs.readFileSync(path.join(fixture.cwd, '.claude', 'settings.json'), 'utf8'));
    assert.equal(settings.hooks, undefined, 'hooks block removed');
    assert.equal(settings.mcpServers.context7, undefined, 'context7 stripped');
    assert.equal(settings.mcpServers['construct-mcp'], undefined, 'construct-mcp stripped');
    assert.ok(settings.mcpServers['user-private-server'], 'user mcp preserved');
    assert.deepEqual(settings.userOnlyKey, { keepMe: true }, 'unrelated top-level key preserved');

    const mcpJson = JSON.parse(fs.readFileSync(path.join(fixture.cwd, '.mcp.json'), 'utf8'));
    assert.ok(mcpJson.mcpServers['user-private-server'], 'user mcp preserved in .mcp.json');
    assert.equal(mcpJson.mcpServers.context7, undefined);

    assert.ok(fs.existsSync(path.join(fixture.cwd, 'AGENTS.md')), 'AGENTS.md preserved (ask-risk)');

    assert.equal(readGitHooksPath(fixture.cwd), null, 'core.hooksPath unset');

    assert.equal(fs.existsSync(paths.stateDir), false, 'machine state dir removed');
    assert.equal(fs.existsSync(paths.dataDir), false, 'machine data dir removed');
    assert.ok(fs.existsSync(path.join(paths.cacheDir, 'embeddings', 'model.onnx')), 'embedding cache preserved (ask-risk)');
    assert.ok(fs.existsSync(path.join(paths.configDir, 'config.env')), 'config.env preserved (ask-risk)');
    assert.equal(fs.existsSync(path.join(paths.configDir, 'lib')), false, 'lib symlink removed');

    const claudeJson = JSON.parse(fs.readFileSync(path.join(fixture.home, '.claude.json'), 'utf8'));
    assert.equal(claudeJson.mcpServers.memory, undefined, 'memory mcp stripped from claude.json');
    assert.ok(claudeJson.mcpServers.github, 'unrelated mcp preserved in claude.json');
  } finally {
    fixture.cleanup();
  }
});

test('--all also removes ask-risk items', () => {
  const { fixture, paths } = seeded();
  try {
    const catalog = buildCleanupCatalog({ cwd: fixture.cwd, home: fixture.home, paths });
    const options: CleanupOptions = { scope: 'all', all: true, keepState: false };
    const detected = detectedItems(catalog, options);
    const toRemove = selectedItems(detected, true);
    applyCleanup(detected, new Set(toRemove.map((i) => i.id)));

    assert.equal(fs.existsSync(path.join(fixture.cwd, '.construct')), false, '.construct state removed');
    assert.equal(fs.existsSync(path.join(fixture.cwd, 'AGENTS.md')), false);
    assert.equal(fs.existsSync(path.join(fixture.cwd, 'plan.md')), false);
    assert.equal(fs.existsSync(path.join(paths.cacheDir, 'embeddings')), false, 'embedding cache removed');
    assert.equal(fs.existsSync(path.join(paths.configDir, 'config.env')), false, 'config.env removed');
  } finally {
    fixture.cleanup();
  }
});

test('--scope=project leaves machine state untouched', () => {
  const { fixture, paths } = seeded();
  try {
    const catalog = buildCleanupCatalog({ cwd: fixture.cwd, home: fixture.home, paths });
    const options: CleanupOptions = { scope: 'project', all: true, keepState: false };
    const detected = detectedItems(catalog, options);
    applyCleanup(detected, new Set(detected.map((i) => i.id)));

    assert.equal(fs.existsSync(path.join(fixture.cwd, '.construct', 'launcher')), false);
    assert.ok(fs.existsSync(paths.stateDir), 'machine state untouched');
    assert.ok(fs.existsSync(path.join(paths.configDir, 'config.env')), 'machine config untouched');
  } finally {
    fixture.cleanup();
  }
});

test('--scope=machine leaves project state untouched', () => {
  const { fixture, paths } = seeded();
  try {
    const catalog = buildCleanupCatalog({ cwd: fixture.cwd, home: fixture.home, paths });
    const options: CleanupOptions = { scope: 'machine', all: true, keepState: false };
    const detected = detectedItems(catalog, options);
    applyCleanup(detected, new Set(detected.map((i) => i.id)));

    assert.ok(fs.existsSync(path.join(fixture.cwd, '.construct', 'launcher')), 'project untouched');
    assert.ok(fs.existsSync(path.join(fixture.cwd, '.claude', 'agents', 'construct.md')), 'agents untouched');
    assert.equal(fs.existsSync(paths.stateDir), false, 'machine state removed');
  } finally {
    fixture.cleanup();
  }
});

test('--keep-state limits to launcher + adapters + settings + git-hookspath', () => {
  const { fixture, paths } = seeded();
  try {
    const catalog = buildCleanupCatalog({ cwd: fixture.cwd, home: fixture.home, paths });
    const options: CleanupOptions = { scope: 'all', all: true, keepState: true };
    const detected = detectedItems(catalog, options);
    applyCleanup(detected, new Set(detected.map((i) => i.id)));

    assert.equal(fs.existsSync(path.join(fixture.cwd, '.construct', 'launcher')), false, 'launcher removed');
    assert.equal(fs.existsSync(path.join(fixture.cwd, '.claude', 'agents', 'engineer.md')), false, 'agents removed');
    assert.ok(fs.existsSync(path.join(fixture.cwd, '.construct')), '.construct state preserved');
    assert.ok(fs.existsSync(path.join(fixture.cwd, 'AGENTS.md')), 'AGENTS.md preserved');
    assert.ok(fs.existsSync(paths.stateDir), 'machine state preserved');
  } finally {
    fixture.cleanup();
  }
});

test('reports nothing detected on a clean project and home', () => {
  const fixture = mkFixture();
  try {
    const paths = resolvePaths({}, fixture.home);
    const catalog = buildCleanupCatalog({ cwd: fixture.cwd, home: fixture.home, paths });
    const detected = detectedItems(catalog, DEFAULT_OPTIONS);
    assert.deepEqual(detected, []);
  } finally {
    fixture.cleanup();
  }
});

test('leaves a malformed settings.json untouched', () => {
  const { fixture, paths } = seeded();
  try {
    const settingsPath = path.join(fixture.cwd, '.claude', 'settings.json');
    fs.writeFileSync(settingsPath, '{not valid json');
    const catalog = buildCleanupCatalog({ cwd: fixture.cwd, home: fixture.home, paths });
    const detected = detectedItems(catalog, DEFAULT_OPTIONS);
    applyCleanup(detected, new Set(selectedItems(detected, false).map((i) => i.id)));
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{not valid json');
  } finally {
    fixture.cleanup();
  }
});

test('deletes .mcp.json once stripping empties it, preserves it when a user entry remains', () => {
  const fixture = mkFixture();
  try {
    fs.mkdirSync(path.join(fixture.cwd, '.claude'), { recursive: true });
    const mcpJsonPath = path.join(fixture.cwd, '.mcp.json');
    fs.writeFileSync(mcpJsonPath, JSON.stringify({ mcpServers: { 'construct-mcp': { command: 'node' } } }, null, 2));
    const paths = resolvePaths({}, fixture.home);
    const catalog = buildCleanupCatalog({ cwd: fixture.cwd, home: fixture.home, paths });
    const detected = detectedItems(catalog, DEFAULT_OPTIONS);
    applyCleanup(detected, new Set(selectedItems(detected, false).map((i) => i.id)));
    assert.equal(fs.existsSync(mcpJsonPath), false, '.mcp.json removed once Construct-only');
  } finally {
    fixture.cleanup();
  }
});
