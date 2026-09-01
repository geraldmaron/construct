/**
 * tests/cli/init.test.ts — construct init creates project-local v1 state.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { init } from '../../src/cli/init.ts';
import { reset } from '../../src/cli/reset.ts';
import { projectConfigPath, projectDbPath } from '../../src/kernel/project/layout.ts';
import { STATE_FORMAT_ID } from '../../src/kernel/state/format.ts';

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

function withRepo(fn: (cwd: string) => Promise<void> | void): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), 'construct-init-'));
  const home = mkdtempSync(join(tmpdir(), 'construct-init-home-'));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  return Promise.resolve(fn(cwd)).finally(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
}

async function capture(fn: () => number | Promise<number>): Promise<Capture> {
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (chunk: string) => {
    out.push(String(chunk));
    return true;
  };
  (process.stderr as { write: unknown }).write = (chunk: string) => {
    err.push(String(chunk));
    return true;
  };
  let code: number;
  try {
    code = await fn();
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
  }
  return { code, out: out.join(''), err: err.join('') };
}

test('bare init creates project config, v1 state, and gitignore without --yes', async () => {
  await withRepo(async (cwd) => {
    const { code, out } = await capture(() => init([], cwd, {}));
    assert.equal(code, 0);
    assert.match(out, /Initialized Construct project/);
    assert.ok(existsSync(projectConfigPath(cwd)));
    assert.ok(existsSync(projectDbPath(cwd)));
    assert.match(readFileSync(join(cwd, '.gitignore'), 'utf8'), /\.construct\/state\//);

    const db = new DatabaseSync(projectDbPath(cwd));
    const format = db.prepare(`SELECT value FROM meta WHERE key = 'format'`).get() as {
      value: string;
    };
    assert.equal(format.value, STATE_FORMAT_ID);
    db.close();
  });
});

test('init --dry-run writes nothing', async () => {
  await withRepo(async (cwd) => {
    const { code, out } = await capture(() => init(['--dry-run'], cwd, { CLAUDECODE: '1' }));
    assert.equal(code, 0);
    assert.match(out, /dry-run/);
    assert.match(out, /write-mcp|claude/);
    assert.match(out, /would install operational skill construct/);
    assert.equal(existsSync(projectConfigPath(cwd)), false);
    assert.equal(existsSync(projectDbPath(cwd)), false);
  });
});

test('init with Claude ambient installs session-bound MCP entry', async () => {
  await withRepo(async (cwd) => {
    const home = process.env.HOME!;
    const { code, out } = await capture(() =>
      init([], cwd, { CLAUDECODE: '1', HOME: home }),
    );
    assert.equal(code, 0);
    assert.match(out, /integration: claude-code installed/);
    assert.match(out, /operational skill construct/);
    assert.ok(existsSync(join(home, '.claude', 'skills', 'construct', 'SKILL.md')));
    const mcp = JSON.parse(readFileSync(join(cwd, '.mcp.json'), 'utf8')) as {
      mcpServers: { 'construct-mcp': { args: string[] } };
    };
    const args = mcp.mcpServers['construct-mcp'].args;
    assert.ok(args.some((a) => a === '--client=claude-code'));
    assert.ok(args.some((a) => a.startsWith('--project=')));
  });
});

test('init --client=opencode installs without ambient detection', async () => {
  await withRepo(async (cwd) => {
    const home = process.env.HOME!;
    const { code, out } = await capture(() =>
      init(['--client=opencode'], cwd, { HOME: home }),
    );
    assert.equal(code, 0);
    assert.match(out, /integration: opencode installed/);
    assert.match(out, /operational skill construct/);
    assert.ok(existsSync(join(home, '.config', 'opencode', 'skills', 'construct', 'SKILL.md')));
    const raw = JSON.parse(readFileSync(join(cwd, 'opencode.json'), 'utf8')) as {
      mcp: { 'construct-mcp': { type: string; command: string[] } };
    };
    assert.equal(raw.mcp['construct-mcp'].type, 'local');
    assert.ok(raw.mcp['construct-mcp'].command.some((a) => a === '--client=opencode'));
  });
});

test('init with bob ambient reports unsupported without throwing', async () => {
  await withRepo(async (cwd) => {
    const home = process.env.HOME!;
    const { code, out } = await capture(() =>
      init([], cwd, { BOB_SHELL_CLI_IDE_SERVER_PORT: '42991', HOME: home }),
    );
    assert.equal(code, 0);
    assert.match(out, /native MCP install unsupported/);
    assert.match(out, /operational skill construct/);
    assert.ok(existsSync(join(home, '.bob', 'skills', 'construct', 'SKILL.md')));
    assert.equal(existsSync(join(cwd, '.mcp.json')), false);
    assert.equal(existsSync(join(cwd, 'opencode.json')), false);
  });
});

test('init is idempotent on a second call', async () => {
  await withRepo(async (cwd) => {
    assert.equal((await capture(() => init([], cwd, {}))).code, 0);
    const { code, out } = await capture(() => init([], cwd, {}));
    assert.equal(code, 0);
    assert.match(out, /\(kept\)/);
    assert.match(out, /\(opened\)/);
  });
});

test('init refuses legacy schema_version sqlite at the project path', async () => {
  await withRepo(async (cwd) => {
    const dbPath = projectDbPath(cwd);
    mkdirSync(join(cwd, '.construct', 'state'), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    db.prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', '23')`).run();
    db.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY)`);
    db.close();

    const { code, err } = await capture(() => init([], cwd, {}));
    assert.equal(code, 1);
    assert.match(err, /unsupported alpha format/);
  });
});

test('reset --yes recreates state after legacy refuse path', async () => {
  await withRepo(async (cwd) => {
    const dbPath = projectDbPath(cwd);
    mkdirSync(join(cwd, '.construct', 'state'), { recursive: true });
    writeFileSync(
      projectConfigPath(cwd),
      '{"format":"construct-project","formatVersion":1,"integrations":{}}\n',
    );
    const db = new DatabaseSync(dbPath);
    db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    db.prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', '23')`).run();
    db.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY)`);
    db.close();

    assert.equal((await capture(() => reset([], cwd))).code, 2);
    const { code, out } = await capture(() => reset(['--yes'], cwd));
    assert.equal(code, 0);
    assert.match(out, /Reset Construct state/);
    const opened = new DatabaseSync(dbPath);
    const format = opened.prepare(`SELECT value FROM meta WHERE key = 'format'`).get() as {
      value: string;
    };
    assert.equal(format.value, STATE_FORMAT_ID);
    opened.close();
  });
});
