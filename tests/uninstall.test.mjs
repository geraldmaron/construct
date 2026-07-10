/**
 * tests/uninstall.test.mjs — coverage for the `construct uninstall` command.
 *
 * Verifies (ADR-0074 consolidated layout: launcher nests at .construct/launcher/,
 * per-project config + state is the top-level .construct/):
 *   - --dry-run reports the plan and changes nothing on disk.
 *   - --yes (default risk: auto) removes .construct/launcher/, agents listed in
 *     the manifest and the Construct hooks block from settings.json,
 *     and the XDG state workspace dir and the global doctor-root state dir;
 *     the ask-risk top-level .construct/ state is preserved.
 *   - User-added mcpServers and user-added top-level settings keys are preserved.
 *   - ask-risk items (.construct/ state, AGENTS.md/plan.md, embedding cache,
 *     config.env) are skipped unless --all is also passed.
 *   - --scope=project leaves machine state alone, and vice versa.
 *   - --keep-state limits to .construct/launcher/ + .claude/ adapters + settings.json.
 *   - .mcp.json (construct-ranh's project-scope MCP write path) has
 *     Construct-managed servers stripped alongside settings.json, preserving
 *     user-added servers and deleting the file once it is Construct-only-empty.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { runUninstall, parseArgs } from '../lib/uninstall/uninstall.mjs';
import { configDir, stateDir, cacheDir, doctorRoot } from '../lib/config/xdg.mjs';

let projectDir;
let homeDir;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-uninstall-proj-'));
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-uninstall-home-'));
  seedProject(projectDir);
  seedHome(homeDir);
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
  fs.rmSync(homeDir, { recursive: true, force: true });
});

function seedProject(dir) {
  fs.mkdirSync(path.join(dir, '.construct', 'launcher', 'cache', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.construct', 'launcher', 'version'), '0.1.0\n');
  fs.writeFileSync(path.join(dir, '.construct', 'launcher', 'run.mjs'), '// stub\n');

  fs.mkdirSync(path.join(dir, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'agents', 'construct.md'), '# construct persona\n');
  fs.writeFileSync(path.join(dir, '.claude', 'agents', 'cx-engineer.md'), '# engineer\n');
  fs.writeFileSync(path.join(dir, '.claude', 'agents', 'user-custom.md'), '# user-owned\n');
  fs.writeFileSync(
    path.join(dir, '.claude', 'agents', '.construct-manifest'),
    'construct.md\ncx-engineer.md\n'
  );

  fs.mkdirSync(path.join(dir, '.claude', 'commands', 'core'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'commands', 'core', 'reset.md'), '# reset\n');
  fs.writeFileSync(
    path.join(dir, '.claude', 'commands', '.construct-manifest'),
    'core/reset.md\n'
  );

  fs.writeFileSync(
    path.join(dir, '.claude', 'settings.json'),
    JSON.stringify(
      {
        hooks: { 'pre:session': [{ command: 'node .construct/launcher/run.mjs hook pre-session' }] },
        permissions: { allow: ['Bash'] },
        mcpServers: {
          memory: { command: 'node', args: ['memory.mjs'] },
          github: { command: 'gh' },
          'user-private-server': { command: 'node', args: ['private.mjs'] },
        },
        userOnlyKey: { keepMe: true },
      },
      null,
      2
    )
  );

  fs.mkdirSync(path.join(dir, '.construct', 'inbox'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.construct', 'context.json'), '{}');

  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# scaffolded\n');
  fs.writeFileSync(path.join(dir, 'plan.md'), '# plan\n');
}

function seedHome(dir) {
  const configRoot = configDir(dir);
  const stateRoot = stateDir(dir);
  const cacheRoot = cacheDir(dir);
  fs.mkdirSync(path.join(stateRoot, 'workspace'), { recursive: true });
  fs.mkdirSync(path.join(stateRoot, 'vector'), { recursive: true });
  fs.writeFileSync(path.join(stateRoot, 'vector', 'index.json'), '{}');
  fs.mkdirSync(path.join(cacheRoot, 'embeddings'), { recursive: true });
  fs.writeFileSync(path.join(cacheRoot, 'embeddings', 'model.onnx'), 'pretend');
  fs.mkdirSync(configRoot, { recursive: true });
  fs.writeFileSync(path.join(configRoot, 'config.env'), 'ANTHROPIC_API_KEY=sk-test\n');
  fs.mkdirSync(path.join(configRoot, 'services', 'postgres'), { recursive: true });
  fs.writeFileSync(path.join(configRoot, 'services', 'postgres', 'docker-compose.yml'), 'version: "3"\n');

  fs.mkdirSync(doctorRoot(dir), { recursive: true });
  fs.writeFileSync(path.join(doctorRoot(dir), 'log.jsonl'), '{"x":1}\n');
}

function silently(fn) {
  const realLog = console.log;
  const realErr = console.error;
  const out = [];
  console.log = (...args) => out.push(args.join(' '));
  console.error = (...args) => out.push(args.join(' '));
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.log = realLog;
      console.error = realErr;
    })
    .then((result) => ({ result, out: out.join('\n') }));
}

describe('parseArgs', () => {
  it('defaults to interactive, no flags', () => {
    const args = parseArgs([]);
    assert.equal(args.dryRun, false);
    assert.equal(args.yes, false);
    assert.equal(args.all, false);
    assert.equal(args.keepState, false);
    assert.equal(args.scope, 'all');
  });

  it('parses --dry-run, --yes, --all, --keep-state, --scope', () => {
    const args = parseArgs(['--dry-run', '--yes', '--all', '--keep-state', '--scope=project']);
    assert.equal(args.dryRun, true);
    assert.equal(args.yes, true);
    assert.equal(args.all, true);
    assert.equal(args.keepState, true);
    assert.equal(args.scope, 'project');
  });

  it('rejects an invalid scope', () => {
    assert.throws(() => parseArgs(['--scope=nope']), /Invalid --scope/);
  });
});

describe('runUninstall --dry-run', () => {
  it('changes nothing on disk', async () => {
    await silently(() =>
      runUninstall(['--dry-run', `--cwd=${projectDir}`, `--home=${homeDir}`])
    );
    assert.ok(fs.existsSync(path.join(projectDir, '.construct', 'launcher')));
    assert.ok(fs.existsSync(path.join(projectDir, '.construct')));
    assert.ok(fs.existsSync(path.join(projectDir, '.claude', 'agents', 'construct.md')));
    assert.ok(fs.existsSync(path.join(projectDir, '.claude', 'settings.json')));
    assert.ok(fs.existsSync(path.join(stateDir(homeDir), 'workspace')));
  });
});

describe('runUninstall --yes (auto-risk only)', () => {
  it('removes .construct/launcher, manifest entries, hooks block, workspace, ~/.cx; preserves .construct state', async () => {
    const { result } = await silently(() =>
      runUninstall(['--yes', `--cwd=${projectDir}`, `--home=${homeDir}`])
    );

    assert.equal(result.canceled, false);

    assert.equal(fs.existsSync(path.join(projectDir, '.construct', 'launcher')), false, '.construct/launcher removed');
    assert.ok(fs.existsSync(path.join(projectDir, '.construct')), '.construct state preserved (ask-risk)');
    assert.ok(fs.existsSync(path.join(projectDir, '.construct', 'context.json')), '.construct/context.json preserved');
    assert.equal(
      fs.existsSync(path.join(projectDir, '.claude', 'agents', 'construct.md')),
      false,
      'manifested agent removed'
    );
    assert.equal(
      fs.existsSync(path.join(projectDir, '.claude', 'agents', 'cx-engineer.md')),
      false,
      'manifested cx- agent removed'
    );
    assert.ok(
      fs.existsSync(path.join(projectDir, '.claude', 'agents', 'user-custom.md')),
      'user-owned agent file preserved'
    );

    const settings = JSON.parse(
      fs.readFileSync(path.join(projectDir, '.claude', 'settings.json'), 'utf8')
    );
    assert.equal(settings.hooks, undefined, 'hooks block removed');
    assert.ok(settings.mcpServers.memory, 'memory mcp preserved by project uninstall');
    assert.ok(settings.mcpServers.github, 'github mcp preserved by project uninstall');
    assert.ok(settings.mcpServers['user-private-server'], 'user mcp preserved');
    assert.deepEqual(settings.userOnlyKey, { keepMe: true }, 'unrelated top-level key preserved');

    assert.equal(
      fs.existsSync(path.join(stateDir(homeDir), 'workspace')),
      false,
      'state workspace dir removed'
    );
    assert.equal(
      fs.existsSync(path.join(stateDir(homeDir), 'vector')),
      false,
      'state vector dir removed'
    );
    assert.equal(fs.existsSync(path.join(doctorRoot(homeDir), 'log.jsonl')), false, 'doctor-root state removed');
  });

  it('preserves ask-risk items by default', async () => {
    await silently(() =>
      runUninstall(['--yes', `--cwd=${projectDir}`, `--home=${homeDir}`])
    );
    assert.ok(fs.existsSync(path.join(projectDir, '.construct')), 'project .construct state preserved');
    assert.ok(fs.existsSync(path.join(projectDir, 'AGENTS.md')), 'AGENTS.md preserved');
    assert.ok(fs.existsSync(path.join(projectDir, 'plan.md')), 'plan.md preserved');
    assert.ok(
      fs.existsSync(path.join(cacheDir(homeDir), 'embeddings', 'model.onnx')),
      'embedding cache preserved'
    );
    assert.ok(
      fs.existsSync(path.join(configDir(homeDir), 'config.env')),
      'config.env preserved'
    );
  });
});

describe('runUninstall --yes --all', () => {
  it('also removes ask-risk items (except Docker container, which detection skips)', async () => {
    await silently(() =>
      runUninstall(['--yes', '--all', `--cwd=${projectDir}`, `--home=${homeDir}`])
    );
    assert.equal(fs.existsSync(path.join(projectDir, '.construct')), false, '.construct state removed (subsumes launcher)');
    assert.equal(fs.existsSync(path.join(projectDir, 'AGENTS.md')), false);
    assert.equal(fs.existsSync(path.join(projectDir, 'plan.md')), false);
    assert.equal(
      fs.existsSync(path.join(cacheDir(homeDir), 'embeddings')),
      false,
      'embedding cache removed'
    );
    assert.equal(
      fs.existsSync(path.join(configDir(homeDir), 'config.env')),
      false,
      'config.env removed'
    );
  });
});

describe('runUninstall --scope=project', () => {
  it('leaves machine state untouched', async () => {
    await silently(() =>
      runUninstall(['--yes', '--scope=project', `--cwd=${projectDir}`, `--home=${homeDir}`])
    );
    assert.equal(fs.existsSync(path.join(projectDir, '.construct', 'launcher')), false, '.construct/launcher removed');
    assert.ok(fs.existsSync(path.join(stateDir(homeDir), 'workspace')), 'machine workspace untouched');
    assert.ok(fs.existsSync(path.join(doctorRoot(homeDir), 'log.jsonl')), 'doctor-root state untouched');
  });
});

describe('runUninstall --scope=machine', () => {
  it('leaves project state untouched', async () => {
    await silently(() =>
      runUninstall(['--yes', '--scope=machine', `--cwd=${projectDir}`, `--home=${homeDir}`])
    );
    assert.ok(fs.existsSync(path.join(projectDir, '.construct')), '.construct untouched');
    assert.ok(fs.existsSync(path.join(projectDir, '.claude', 'agents', 'construct.md')), 'agents untouched');
    assert.equal(fs.existsSync(path.join(doctorRoot(homeDir), 'log.jsonl')), false);
  });
});

describe('runUninstall --keep-state', () => {
  it('removes only .construct/launcher + adapters + settings; preserves .construct/ state, scaffold files, all machine state', async () => {
    await silently(() =>
      runUninstall(['--yes', '--all', '--keep-state', `--cwd=${projectDir}`, `--home=${homeDir}`])
    );
    assert.equal(fs.existsSync(path.join(projectDir, '.construct', 'launcher')), false, '.construct/launcher removed');
    assert.equal(fs.existsSync(path.join(projectDir, '.claude', 'agents', 'cx-engineer.md')), false);
    assert.ok(fs.existsSync(path.join(projectDir, '.construct')), '.construct state preserved');
    assert.ok(fs.existsSync(path.join(projectDir, 'AGENTS.md')), 'AGENTS.md preserved');
    assert.ok(fs.existsSync(path.join(stateDir(homeDir), 'workspace')), 'machine workspace preserved');
    assert.ok(fs.existsSync(path.join(doctorRoot(homeDir), 'log.jsonl')), 'doctor-root state preserved');
  });
});

describe('runUninstall when nothing exists', () => {
  it('reports clean and exits without error', async () => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.mkdirSync(projectDir);
    fs.mkdirSync(homeDir);

    const { result, out } = await silently(() =>
      runUninstall(['--yes', `--cwd=${projectDir}`, `--home=${homeDir}`])
    );
    assert.equal(result.canceled, false);
    assert.match(out, /No Construct state detected/);
  });
});

describe('settings.json un-merge edge cases', () => {
  it('keeps settings.json when non-registry MCP entries remain after hook removal', async () => {
    fs.writeFileSync(
      path.join(projectDir, '.claude', 'settings.json'),
      JSON.stringify(
        {
          hooks: { 'pre:session': [{ command: 'node .construct/run.mjs hook x' }] },
          mcpServers: { memory: { command: 'node' }, github: { command: 'gh' } },
        },
        null,
        2
      )
    );
    await silently(() =>
      runUninstall(['--yes', `--cwd=${projectDir}`, `--home=${homeDir}`])
    );
    assert.equal(
      fs.existsSync(path.join(projectDir, '.claude', 'settings.json')),
      true,
      'settings.json kept because mcpServers remain'
    );
  });

  it('leaves a malformed settings.json untouched', async () => {
    const settingsPath = path.join(projectDir, '.claude', 'settings.json');
    fs.writeFileSync(settingsPath, '{not valid json');
    await silently(() =>
      runUninstall(['--yes', `--cwd=${projectDir}`, `--home=${homeDir}`])
    );
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{not valid json');
  });
});

describe('.mcp.json un-merge (construct-ranh project scope)', () => {
  it('strips Construct-managed servers from .mcp.json, preserves user entries', async () => {
    const mcpJsonPath = path.join(projectDir, '.mcp.json');
    fs.writeFileSync(
      mcpJsonPath,
      JSON.stringify(
        {
          mcpServers: {
            context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
            'construct-mcp': { command: 'node', args: ['run.mjs', 'mcp'] },
            'user-private-server': { command: 'node', args: ['private.mjs'] },
          },
        },
        null,
        2
      )
    );

    const { result } = await silently(() =>
      runUninstall(['--yes', `--cwd=${projectDir}`, `--home=${homeDir}`])
    );
    assert.ok(result.removed.some((r) => r.id === 'project-settings'), 'project-settings category must run');

    const mcpJson = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf8'));
    assert.equal('context7' in mcpJson.mcpServers, false, 'context7 stripped');
    assert.equal('construct-mcp' in mcpJson.mcpServers, false, 'construct-mcp stripped');
    assert.ok(mcpJson.mcpServers['user-private-server'], 'user mcp preserved');
  });

  it('deletes .mcp.json when it becomes empty after stripping', async () => {
    const mcpJsonPath = path.join(projectDir, '.mcp.json');
    fs.writeFileSync(
      mcpJsonPath,
      JSON.stringify({ mcpServers: { 'construct-mcp': { command: 'node' } } }, null, 2)
    );

    await silently(() =>
      runUninstall(['--yes', `--cwd=${projectDir}`, `--home=${homeDir}`])
    );
    assert.equal(fs.existsSync(mcpJsonPath), false, '.mcp.json removed once Construct-only');
  });

  it('leaves a malformed .mcp.json untouched', async () => {
    const mcpJsonPath = path.join(projectDir, '.mcp.json');
    fs.writeFileSync(mcpJsonPath, '{not valid json');
    await silently(() =>
      runUninstall(['--yes', `--cwd=${projectDir}`, `--home=${homeDir}`])
    );
    assert.equal(fs.readFileSync(mcpJsonPath, 'utf8'), '{not valid json');
  });

  it('leaves .mcp.json alone when it has no Construct-managed entries', async () => {
    const mcpJsonPath = path.join(projectDir, '.mcp.json');
    fs.writeFileSync(
      mcpJsonPath,
      JSON.stringify({ mcpServers: { 'user-private-server': { command: 'node' } } }, null, 2)
    );
    await silently(() =>
      runUninstall(['--yes', `--cwd=${projectDir}`, `--home=${homeDir}`])
    );
    const mcpJson = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf8'));
    assert.ok(mcpJson.mcpServers['user-private-server'], 'user mcp preserved');
  });
});
