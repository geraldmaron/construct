/**
 * tests/concurrency/serve-binding.test.ts — a real `construct serve` process
 * against a project other processes are using.
 *
 * The handshake is answered at once even while another process holds the
 * write lock; a tool call during the lock says to call again and nothing else;
 * the same call binds once the lock is gone. A store written by a newer, older,
 * or foreign build yields an unbound server whose advice fits (upgrade,
 * migrate, ask before reset), and a bound server stops writing when another
 * build re-stamps the store's format.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { sterile, type SterileFixture } from '../harness/sterile.ts';

const LAUNCHER = fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url));

function envFor(fx: SterileFixture): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: join(fx.root, 'home'),
    XDG_CONFIG_HOME: fx.paths.configDir,
    XDG_STATE_HOME: fx.paths.stateDir,
    XDG_DATA_HOME: fx.paths.dataDir,
    XDG_CACHE_HOME: fx.paths.cacheDir,
    NO_COLOR: '1',
  };
}

function initProject(fx: SterileFixture): { dir: string; db: string } {
  const dir = join(fx.root, 'project');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(fx.root, 'home'), { recursive: true });
  const made = spawnSync(process.execPath, [LAUNCHER, 'init', '--no-wire', '--name=binding', '--scale=solo'], { cwd: dir, env: envFor(fx), encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  return { dir, db: join(dir, '.construct', 'state', 'construct.sqlite') };
}

interface Reply {
  readonly result?: { instructions?: string; isError?: boolean; structuredContent?: Record<string, unknown> };
  readonly error?: { code: number; message: string };
}

/** A serve process driven one request at a time. */
class Session {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private readonly waiting = new Map<number, (r: Reply) => void>();
  private nextId = 1;

  constructor(dir: string, env: NodeJS.ProcessEnv) {
    this.child = spawn(process.execPath, [LAUNCHER, 'serve', '--client=claude-code'], { cwd: dir, env });
    this.child.stdout.on('data', (d) => {
      this.buffer += String(d);
      for (let nl = this.buffer.indexOf('\n'); nl >= 0; nl = this.buffer.indexOf('\n')) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line) as Reply & { id: number };
        this.waiting.get(msg.id)?.(msg);
        this.waiting.delete(msg.id);
      }
    });
  }

  request(method: string, params: unknown = {}): Promise<Reply> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  call(name: string, args: Record<string, unknown> = {}): Promise<Reply> {
    return this.request('tools/call', { name, arguments: args });
  }

  close(): Promise<void> {
    this.child.stdin.end();
    return new Promise((resolve) => this.child.on('close', () => resolve()));
  }
}

const INIT = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'binding', version: '0' } };

test('under another process’s write lock the handshake answers at once and a call binds once the lock is gone', { timeout: 60_000 }, async () => {
  const fx = sterile();
  try {
    const { dir, db } = initProject(fx);
    // A store an older build last wrote is in the rollback journal, where an
    // exclusive lock blocks readers too: the worst case for a starting server.
    const holder = new DatabaseSync(db);
    holder.exec('PRAGMA journal_mode = DELETE');
    holder.exec('BEGIN EXCLUSIVE');
    holder.exec(`INSERT INTO meta (key, value) VALUES ('lock-probe', 'x')`);
    const lockedAt = Date.now();
    const session = new Session(dir, envFor(fx));
    try {
      const init = await session.request('initialize', INIT);
      const answeredAfter = Date.now() - lockedAt;
      assert.ok(answeredAfter < 3000, `the handshake waited ${String(answeredAfter)} ms on a lock held for 4 s`);
      assert.doesNotMatch(init.result?.instructions ?? '', /could not bind|construct init/);
      const during = await session.call('bootstrap');
      if (Date.now() - lockedAt < 3800) {
        assert.equal(during.result?.isError, true, 'while the lock is held, a call is told to wait');
        assert.match(String(during.result?.structuredContent?.next ?? ''), /call again/);
      }
      const wait = 4000 - (Date.now() - lockedAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      holder.exec('ROLLBACK');
      holder.close();
      const after = await session.call('bootstrap');
      assert.notEqual(after.result?.isError, true, JSON.stringify(after.result?.structuredContent));
      assert.ok(after.result?.structuredContent?.profile, 'a bound bootstrap reports the project profile');
    } finally {
      await session.close();
    }
  } finally {
    fx.cleanup();
  }
});

async function unboundAdvice(fx: SterileFixture, dir: string): Promise<string> {
  const session = new Session(dir, envFor(fx));
  try {
    const init = await session.request('initialize', INIT);
    const boot = await session.call('bootstrap');
    return `${init.result?.instructions ?? ''}\n${String(boot.result?.structuredContent?.next ?? '')}`;
  } finally {
    await session.close();
  }
}

test('a store written by a newer build yields advice to upgrade, never to init or reset', { timeout: 60_000 }, async () => {
  const fx = sterile();
  try {
    const { dir, db } = initProject(fx);
    const d = new DatabaseSync(db);
    d.prepare(`UPDATE meta SET value = '99' WHERE key = 'format_version'`).run();
    d.close();
    const advice = await unboundAdvice(fx, dir);
    assert.match(advice, /newer version of Construct/);
    assert.match(advice, /Upgrade Construct/);
    assert.doesNotMatch(advice, /construct init|run `construct reset`/i);
  } finally {
    fx.cleanup();
  }
});

test('an older store yields the migrate step; a foreign one says to ask the person before any reset', { timeout: 60_000 }, async () => {
  const fx = sterile();
  try {
    const { dir, db } = initProject(fx);
    const d = new DatabaseSync(db);
    d.exec('PRAGMA foreign_keys = OFF');
    for (const table of ['run_bindings', 'reviews', 'work_runs', 'work_legacy_ids', 'work_events', 'work_dependencies', 'work_items']) d.exec(`DROP TABLE IF EXISTS ${table}`);
    d.prepare(`UPDATE meta SET value = '2' WHERE key = 'format_version'`).run();
    d.close();
    assert.match(await unboundAdvice(fx, dir), /construct migrate/);

    const f = new DatabaseSync(db);
    f.prepare(`UPDATE meta SET value = 'someone-else' WHERE key = 'format'`).run();
    f.close();
    const foreign = await unboundAdvice(fx, dir);
    assert.match(foreign, /Ask the person whether to run `construct reset`/);
    assert.doesNotMatch(foreign, /construct init/);
  } finally {
    fx.cleanup();
  }
});

test('a bound server stops writing when another process re-stamps the store’s format', { timeout: 60_000 }, async () => {
  const fx = sterile();
  try {
    const { dir, db } = initProject(fx);
    const session = new Session(dir, envFor(fx));
    try {
      await session.request('initialize', INIT);
      const first = await session.call('work', { action: 'add', title: 'before the other build' });
      assert.notEqual(first.result?.isError, true);
      const other = new DatabaseSync(db);
      other.prepare(`UPDATE meta SET value = '99' WHERE key = 'format_version'`).run();
      other.close();
      const second = await session.call('work', { action: 'add', title: 'after the other build' });
      assert.equal(second.result?.isError, true);
      assert.match(String(second.result?.structuredContent?.error ?? ''), /Restart the MCP server/);
    } finally {
      await session.close();
    }
    const check = new DatabaseSync(db, { readOnly: true });
    const titles = (check.prepare('SELECT title FROM work_items').all() as Array<{ title: string }>).map((r) => r.title);
    check.close();
    assert.deepEqual(titles, ['before the other build']);
  } finally {
    fx.cleanup();
  }
});
