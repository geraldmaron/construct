/**
 * tests/uninstall.test.mjs — coverage for the `construct uninstall` command.
 *
 * Verifies:
 *   - --dry-run reports the plan and changes nothing on disk.
 *   - --yes (default risk: auto) removes .construct/, agents listed in the
 *     manifest, the Construct hooks block + known mcpServers from settings.json,
 *     and the ~/.construct/workspace and ~/.cx state dirs.
 *   - User-added mcpServers and user-added top-level settings keys are preserved.
 *   - ask-risk items (.cx/, AGENTS.md/plan.md, embedding cache, config.env)
 *     are skipped unless --all is also passed.
 *   - --scope=project leaves machine state alone, and vice versa.
 *   - --keep-state limits to .construct/ + .claude/ adapters + settings.json.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { runUninstall, parseArgs } from '../lib/uninstall/uninstall.mjs';

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
  fs.mkdirSync(path.join(dir, '.construct', 'cache', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.construct', 'version'), '0.1.0\n');
  fs.writeFileSync(path.join(dir, '.construct', 'run.mjs'), '// stub\n');

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
        hooks: { 'pre:session': [{ command: 'node .construct/run.mjs hook pre-session' }] },
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

  fs.mkdirSync(path.join(dir, '.cx', 'inbox'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.cx', 'context.json'), '{}');

  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# scaffolded\n');
  fs.writeFileSync(path.join(dir, 'plan.md'), '# plan\n');
}

function seedHome(dir) {
  const constructDir = path.join(dir, '.construct');
  fs.mkdirSync(path.join(constructDir, 'workspace'), { recursive: true });
  fs.mkdirSync(path.join(constructDir, 'vector'), { recursive: true });
  fs.writeFileSync(path.join(constructDir, 'vector', 'index.json'), '{}');
  fs.mkdirSync(path.join(constructDir, 'cache', 'embeddings'), { recursive: true });
  fs.writeFileSync(path.join(constructDir, 'cache', 'embeddings', 'model.onnx'), 'pretend');
  fs.writeFileSync(path.join(constructDir, 'config.env'), 'ANTHROPIC_API_KEY=sk-test\n');
  fs.mkdirSync(path.join(constructDir, 'services', 'postgres'), { recursive: true });
  fs.writeFileSync(path.join(constructDir, 'services', 'postgres', 'docker-compose.yml'), 'version: "3"\n');

  fs.mkdirSync(path.join(dir, '.cx'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.cx', 'log.jsonl'), '{"x":1}\n');
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
    assert.ok(fs.existsSync(path.join(projectDir, '.construct')));
    assert.ok(fs.existsSync(path.join(projectDir, '.claude', 'agents', 'construct.md')));
    assert.ok(fs.existsSync(path.join(projectDir, '.claude', 'settings.json')));
    assert.ok(fs.existsSync(path.join(homeDir, '.construct', 'workspace')));
  });
});

describe('runUninstall --yes (auto-risk only)', () => {
  it('removes .construct, manifest entries, hooks block, known mcpServers, workspace, ~/.cx', async () => {
    const { result } = await silently(() =>
      runUninstall(['--yes', `--cwd=${projectDir}`, `--home=${homeDir}`])
    );

    assert.equal(result.canceled, false);

    assert.equal(fs.existsSync(path.join(projectDir, '.construct')), false, '.construct removed');
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
    assert.equal(settings.mcpServers.memory, undefined, 'known memory mcp removed');
    assert.equal(settings.mcpServers.github, undefined, 'known github mcp removed');
    assert.ok(settings.mcpServers['user-private-server'], 'user mcp preserved');
    assert.deepEqual(settings.userOnlyKey, { keepMe: true }, 'unrelated top-level key preserved');

    assert.equal(
      fs.existsSync(path.join(homeDir, '.construct', 'workspace')),
      false,
      '~/.construct/workspace removed'
    );
    assert.equal(
      fs.existsSync(path.join(homeDir, '.construct', 'vector')),
      false,
      '~/.construct/vector removed'
    );
    assert.equal(fs.existsSync(path.join(homeDir, '.cx')), false, '~/.cx removed');
  });

  it('preserves ask-risk items by default', async () => {
    await silently(() =>
      runUninstall(['--yes', `--cwd=${projectDir}`, `--home=${homeDir}`])
    );
    assert.ok(fs.existsSync(path.join(projectDir, '.cx')), 'project .cx preserved');
    assert.ok(fs.existsSync(path.join(projectDir, 'AGENTS.md')), 'AGENTS.md preserved');
    assert.ok(fs.existsSync(path.join(projectDir, 'plan.md')), 'plan.md preserved');
    assert.ok(
      fs.existsSync(path.join(homeDir, '.construct', 'cache', 'embeddings', 'model.onnx')),
      'embedding cache preserved'
    );
    assert.ok(
      fs.existsSync(path.join(homeDir, '.construct', 'config.env')),
      'config.env preserved'
    );
  });
});

describe('runUninstall --yes --all', () => {
  it('also removes ask-risk items (except Docker container, which detection skips)', async () => {
    await silently(() =>
      runUninstall(['--yes', '--all', `--cwd=${projectDir}`, `--home=${homeDir}`])
    );
    assert.equal(fs.existsSync(path.join(projectDir, '.cx')), false);
    assert.equal(fs.existsSync(path.join(projectDir, 'AGENTS.md')), false);
    assert.equal(fs.existsSync(path.join(projectDir, 'plan.md')), false);
    assert.equal(
      fs.existsSync(path.join(homeDir, '.construct', 'cache', 'embeddings')),
      false,
      'embedding cache removed'
    );
    assert.equal(
      fs.existsSync(path.join(homeDir, '.construct', 'config.env')),
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
    assert.equal(fs.existsSync(path.join(projectDir, '.construct')), false);
    assert.ok(fs.existsSync(path.join(homeDir, '.construct', 'workspace')), 'machine workspace untouched');
    assert.ok(fs.existsSync(path.join(homeDir, '.cx')), '~/.cx untouched');
  });
});

describe('runUninstall --scope=machine', () => {
  it('leaves project state untouched', async () => {
    await silently(() =>
      runUninstall(['--yes', '--scope=machine', `--cwd=${projectDir}`, `--home=${homeDir}`])
    );
    assert.ok(fs.existsSync(path.join(projectDir, '.construct')), '.construct untouched');
    assert.ok(fs.existsSync(path.join(projectDir, '.claude', 'agents', 'construct.md')), 'agents untouched');
    assert.equal(fs.existsSync(path.join(homeDir, '.cx')), false);
  });
});

describe('runUninstall --keep-state', () => {
  it('removes only .construct + adapters + settings; preserves .cx/, scaffold files, all machine state', async () => {
    await silently(() =>
      runUninstall(['--yes', '--all', '--keep-state', `--cwd=${projectDir}`, `--home=${homeDir}`])
    );
    assert.equal(fs.existsSync(path.join(projectDir, '.construct')), false);
    assert.equal(fs.existsSync(path.join(projectDir, '.claude', 'agents', 'cx-engineer.md')), false);
    assert.ok(fs.existsSync(path.join(projectDir, '.cx')), '.cx preserved');
    assert.ok(fs.existsSync(path.join(projectDir, 'AGENTS.md')), 'AGENTS.md preserved');
    assert.ok(fs.existsSync(path.join(homeDir, '.construct', 'workspace')), 'machine workspace preserved');
    assert.ok(fs.existsSync(path.join(homeDir, '.cx')), '~/.cx preserved');
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
  it('deletes the file entirely when it is Construct-only', async () => {
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
      false,
      'Construct-only settings.json removed entirely'
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
