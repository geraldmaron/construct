/**
 * tests/functional/reconcile-tasks.functional.test.mjs
 *
 * Functional coverage for the five ADR-0027 reconciliation tasks registered in
 * lib/reconcile/index.mjs beyond legacy-skills-cleanup:
 *   - gitignore-coverage        (auto, project scope)
 *   - agent-instructions-rewrap (auto, project scope)
 *   - mcp-entry-reconcile       (auto, home + project scope)
 *   - adapter-prune             (ask,  project scope)
 *   - postgres-namespace        (ask,  home scope)
 *
 * Every test isolates HOME (CX_HOME_OVERRIDE + HOME) under a tmpdir and runs
 * project-scoped tasks from a tmp cwd, so the real machine is never touched.
 * For each task: a needsRepair case, apply() fixes it, and a second detect()
 * returns needsRepair:false (idempotency). Ask tasks additionally assert they
 * are excluded from runAutoReconciliations' applied set. postgres-namespace
 * asserts apply() invokes no docker binary and deletes no data.
 */

import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RECONCILE_MOD = join(REPO_ROOT, 'lib', 'reconcile', 'index.mjs');

function freshReconcileModule() {
  return import(`${pathToFileURL(RECONCILE_MOD).href}?ts=${Date.now()}-${Math.random()}`);
}

async function taskModule(file) {
  const full = join(REPO_ROOT, 'lib', 'reconcile', file);
  const mod = await import(`${pathToFileURL(full).href}?ts=${Date.now()}-${Math.random()}`);
  return mod.default;
}

// Each test gets an isolated HOME plus its own project cwd. The env is restored
// and tmp trees are removed in finally so parallel test files never collide.

function withSandbox(fn) {
  const home = mkdtempSync(join(tmpdir(), 'cx-rec-home-'));
  const project = mkdtempSync(join(tmpdir(), 'cx-rec-proj-'));
  const prev = {
    HOME: process.env.HOME,
    CX_HOME_OVERRIDE: process.env.CX_HOME_OVERRIDE,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    CONSTRUCT_PG_CONTAINER: process.env.CONSTRUCT_PG_CONTAINER,
    CONSTRUCT_PG_PORT: process.env.CONSTRUCT_PG_PORT,
    PATH: process.env.PATH,
    cwd: process.cwd(),
  };
  process.env.HOME = home;
  process.env.CX_HOME_OVERRIDE = home;
  delete process.env.GITHUB_TOKEN;
  delete process.env.CONSTRUCT_PG_CONTAINER;
  delete process.env.CONSTRUCT_PG_PORT;
  process.chdir(project);
  return Promise.resolve(fn({ home, project })).finally(() => {
    process.chdir(prev.cwd);
    for (const key of ['HOME', 'CX_HOME_OVERRIDE', 'GITHUB_TOKEN', 'CONSTRUCT_PG_CONTAINER', 'CONSTRUCT_PG_PORT', 'PATH']) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  });
}

function markProject(project) {
  mkdirSync(join(project, '.cx'), { recursive: true });
}

test('reconcile/gitignore-coverage: partial .gitignore is completed + idempotent', async () => {
  await withSandbox(async ({ project }) => {
    markProject(project);
    writeFileSync(join(project, '.gitignore'), 'node_modules/\n.cx/\n');
    const task = await taskModule('gitignore-coverage.mjs');
    const before = await task.detect();
    assert.equal(before.needsRepair, true, 'partial .gitignore needs repair');
    const applied = await task.apply();
    assert.match(applied.summary, /Appended \d+ Construct ignore/);
    const content = readFileSync(join(project, '.gitignore'), 'utf8');
    assert.match(content, /# Construct — generated adapters, launcher, and runtime state\./);
    assert.match(content, /\.construct\//);
    assert.match(content, /plan\.md/);
    const after = await task.detect();
    assert.equal(after.needsRepair, false, 'idempotent: second detect is no-op');
  });
});

test('reconcile/gitignore-coverage: no .gitignore is left to init (no repair)', async () => {
  await withSandbox(async ({ project }) => {
    markProject(project);
    const task = await taskModule('gitignore-coverage.mjs');
    const before = await task.detect();
    assert.equal(before.needsRepair, false, 'absent .gitignore is init\'s job');
    assert.equal(existsSync(join(project, '.gitignore')), false, 'apply() never creates it');
  });
});

test('reconcile/gitignore-coverage: skips the Construct package repo itself', async () => {
  await withSandbox(async ({ project }) => {
    markProject(project);
    writeFileSync(join(project, '.gitignore'), 'node_modules/\n.cx/\n');
    writeFileSync(join(project, 'package.json'), JSON.stringify({
      name: '@geraldmaron/construct',
      bin: { construct: 'bin/construct' },
    }));
    const task = await taskModule('gitignore-coverage.mjs');
    const result = await task.detect();
    assert.equal(result.needsRepair, false, 'reconcile must not fire on the Construct repo itself');
    assert.match(result.summary, /Construct package repo/, 'summary names the skip reason');
  });
});

test('reconcile/agent-instructions-rewrap: stale block refreshed, blockless file untouched', async () => {
  await withSandbox(async ({ project }) => {
    markProject(project);
    const stale = '# Project\n\n<!-- BEGIN CONSTRUCT INTEGRATION v:1 hash:deadbeef0000 -->\nold body\n<!-- END CONSTRUCT INTEGRATION -->\n';
    writeFileSync(join(project, 'AGENTS.md'), stale);
    const blockless = '# Notes with no construct block\n';
    writeFileSync(join(project, 'CLAUDE.md'), blockless);
    const task = await taskModule('agent-instructions-rewrap.mjs');
    const before = await task.detect();
    assert.equal(before.needsRepair, true, 'stale block detected');
    assert.deepEqual(before.details.stale, ['AGENTS.md']);
    await task.apply();
    const agents = readFileSync(join(project, 'AGENTS.md'), 'utf8');
    assert.match(agents, /## Construct integration/, 'block body refreshed');
    assert.ok(!/hash:deadbeef0000/.test(agents), 'stale hash replaced');
    assert.equal(readFileSync(join(project, 'CLAUDE.md'), 'utf8'), blockless, 'blockless file untouched');
    const after = await task.detect();
    assert.equal(after.needsRepair, false, 'idempotent: second detect is no-op');
  });
});

test('reconcile/agent-instructions-rewrap: no agent file is no-op', async () => {
  await withSandbox(async ({ project }) => {
    markProject(project);
    const task = await taskModule('agent-instructions-rewrap.mjs');
    const before = await task.detect();
    assert.equal(before.needsRepair, false);
    assert.equal(existsSync(join(project, 'AGENTS.md')), false, 'apply() never creates files');
  });
});

test('reconcile/mcp-entry-reconcile: unresolved token table stripped + idempotent', async () => {
  await withSandbox(async ({ home }) => {
    const codexDir = join(home, '.codex');
    mkdirSync(codexDir, { recursive: true });
    const config = [
      '[agents]',
      'max_threads = 6',
      '',
      '[mcp_servers.memory]',
      'command = "node"',
      'startup_timeout_sec = 20',
      '',
      '[mcp_servers.github]',
      'url = "https://api.githubcopilot.com/mcp/"',
      'startup_timeout_sec = 20',
      'tool_timeout_sec = 60',
      'bearer_token_env_var = "GITHUB_TOKEN"',
      '',
    ].join('\n');
    writeFileSync(join(codexDir, 'config.toml'), config);
    const task = await taskModule('mcp-entry-reconcile.mjs');
    const before = await task.detect();
    assert.equal(before.needsRepair, true, 'unset GITHUB_TOKEN table detected');
    await task.apply();
    const after = readFileSync(join(codexDir, 'config.toml'), 'utf8');
    assert.ok(!/mcp_servers\.github/.test(after), 'github table removed');
    assert.match(after, /\[mcp_servers\.memory\]/, 'credential-free table preserved');
    assert.match(after, /\[agents\]/, 'unrelated table preserved');
    const detect2 = await task.detect();
    assert.equal(detect2.needsRepair, false, 'idempotent: second detect is no-op');
  });
});

test('reconcile/mcp-entry-reconcile: resolved token table is kept', async () => {
  await withSandbox(async ({ home }) => {
    process.env.GITHUB_TOKEN = 'ghp_test_value';
    const codexDir = join(home, '.codex');
    mkdirSync(codexDir, { recursive: true });
    const config = [
      '[mcp_servers.github]',
      'url = "https://api.githubcopilot.com/mcp/"',
      'bearer_token_env_var = "GITHUB_TOKEN"',
      '',
    ].join('\n');
    writeFileSync(join(codexDir, 'config.toml'), config);
    const task = await taskModule('mcp-entry-reconcile.mjs');
    const before = await task.detect();
    assert.equal(before.needsRepair, false, 'resolved token is not drift');
  });
});

// The expected prune set is derived from the real machine's installed hosts so
// the assertion holds whether or not a given host is present. `.claude` is the
// protected baseline and must stay out of the set regardless.

async function expectedPrunable() {
  const { detectHostCapabilities } = await import('../../lib/host-capabilities.mjs');
  const hostToDir = {
    'Claude Code': '.claude', OpenCode: '.opencode', Codex: '.codex', 'VS Code': '.vscode', Cursor: '.cursor',
  };
  const installed = new Set(
    detectHostCapabilities().filter((h) => h.availability === 'installed').map((h) => hostToDir[h.host]).filter(Boolean),
  );
  return ['.codex', '.cursor', '.vscode', '.opencode'].filter((dir) => !installed.has(dir));
}

test('reconcile/adapter-prune: ask task removes uninstalled-host dirs, never .claude', async () => {
  await withSandbox(async ({ project }) => {
    markProject(project);
    for (const dir of ['.claude', '.codex', '.cursor', '.vscode', '.opencode']) {
      mkdirSync(join(project, dir), { recursive: true });
      writeFileSync(join(project, dir, 'marker'), 'x');
    }
    const expected = await expectedPrunable();
    const task = await taskModule('adapter-prune.mjs');
    const before = await task.detect();
    assert.equal(before.needsRepair, expected.length > 0, 'repair flag tracks uninstalled-host dirs');
    if (expected.length === 0) {
      assert.equal(existsSync(join(project, '.claude')), true, '.claude preserved');
      return;
    }
    assert.deepEqual([...before.details.prunable].sort(), [...expected].sort(), 'prune set is uninstalled hosts only');
    assert.ok(!before.details.prunable.includes('.claude'), '.claude excluded from prune set');
    await task.apply();
    assert.equal(existsSync(join(project, '.claude')), true, '.claude preserved');
    for (const dir of before.details.prunable) {
      assert.equal(existsSync(join(project, dir)), false, `${dir} pruned`);
    }
    const after = await task.detect();
    assert.equal(after.needsRepair, false, 'idempotent: second detect is no-op');
  });
});

test('reconcile/adapter-prune: excluded from auto reconciliations (ask safety)', async () => {
  await withSandbox(async ({ project }) => {
    markProject(project);
    mkdirSync(join(project, '.cursor'), { recursive: true });
    const { runAutoReconciliations } = await freshReconcileModule();
    const { applied, skipped } = await runAutoReconciliations();
    assert.ok(!applied.some((a) => a.id === 'adapter-prune'), 'ask task never auto-applies');
    assert.ok(skipped.some((s) => s.id === 'adapter-prune' && s.reason === 'safety:ask'), 'skipped as safety:ask');
    assert.equal(existsSync(join(project, '.cursor')), true, '.cursor untouched by auto pass');
  });
});

// A fake docker on PATH records every invocation. apply() must rewrite the
// compose without spawning docker, so the sentinel stays absent.

function installFakeDocker(home) {
  const binDir = join(home, 'fakebin');
  mkdirSync(binDir, { recursive: true });
  const sentinel = join(home, 'docker-invoked');
  const script = `#!/bin/sh\necho "$@" >> "${sentinel}"\nexit 0\n`;
  const dockerPath = join(binDir, 'docker');
  writeFileSync(dockerPath, script);
  chmodSync(dockerPath, 0o755);
  process.env.PATH = `${binDir}:${process.env.PATH}`;
  return sentinel;
}

test('reconcile/postgres-namespace: rewrites compose, invokes no docker, deletes no data', async () => {
  await withSandbox(async ({ home }) => {
    const sentinel = installFakeDocker(home);
    const composeDir = join(home, '.construct', 'services', 'postgres');
    mkdirSync(composeDir, { recursive: true });
    const composePath = join(composeDir, 'docker-compose.yml');
    const legacy = [
      'services:',
      '  postgres:',
      '    image: pgvector/pgvector:pg16',
      '    container_name: construct-postgres',
      '    ports:',
      '      - "127.0.0.1:54329:5432"',
      '    volumes:',
      '      - construct-postgres-data:/var/lib/postgresql/data',
      'volumes:',
      '  construct-postgres-data:',
      '',
    ].join('\n');
    writeFileSync(composePath, legacy);

    const task = await taskModule('postgres-namespace.mjs');
    const before = await task.detect();
    assert.equal(before.needsRepair, true, 'legacy compose detected');

    const applied = await task.apply();
    assert.match(applied.summary, /construct down && construct up/, 'summary instructs recreate');

    const rewritten = readFileSync(composePath, 'utf8');
    assert.ok(!/container_name:\s*construct-postgres\s*$/m.test(rewritten), 'singular name replaced');
    assert.match(rewritten, /container_name: construct-postgres-[0-9a-f]{8}/, 'namespaced container present');
    assert.match(rewritten, /:\/var\/lib\/postgresql\/data/, 'volume mount still references data');

    assert.equal(existsSync(sentinel), false, 'apply() invoked no docker command');

    const after = await task.detect();
    assert.equal(after.needsRepair, false, 'idempotent: second detect is no-op');
  });
});

test('reconcile/postgres-namespace: excluded from auto reconciliations (ask safety)', async () => {
  await withSandbox(async ({ home }) => {
    const composeDir = join(home, '.construct', 'services', 'postgres');
    mkdirSync(composeDir, { recursive: true });
    writeFileSync(join(composeDir, 'docker-compose.yml'), 'services:\n  postgres:\n    container_name: construct-postgres\n');
    const { runAutoReconciliations } = await freshReconcileModule();
    const { applied, skipped } = await runAutoReconciliations();
    assert.ok(!applied.some((a) => a.id === 'postgres-namespace'), 'ask task never auto-applies');
    assert.ok(skipped.some((s) => s.id === 'postgres-namespace' && s.reason === 'safety:ask'), 'skipped as safety:ask');
  });
});
