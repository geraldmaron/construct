/**
 * tests/concurrency/serve-binding.test.ts — a real `construct serve` process
 * binds to its project while another process holds the write lock, and a
 * store written by a newer build yields an unbound server whose advice is to
 * upgrade, never to initialize or reset.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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

function initProject(fx: SterileFixture): string {
  const project = join(fx.root, 'project');
  mkdirSync(project, { recursive: true });
  mkdirSync(join(fx.root, 'home'), { recursive: true });
  const made = spawnSync(process.execPath, [LAUNCHER, 'init', '--no-wire', '--name=binding', '--scale=solo'], { cwd: project, env: envFor(fx), encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  return project;
}

interface Handshake {
  readonly instructions: string;
  readonly bootstrap: { bound?: boolean; next?: string };
  readonly ms: number;
}

function handshake(project: string, env: NodeJS.ProcessEnv): Promise<Handshake> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(process.execPath, [LAUNCHER, 'serve', '--client=claude-code'], { cwd: project, env });
    let buffer = '';
    let instructions = '';
    child.stdout.on('data', (d) => {
      buffer += String(d);
      for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const msg = JSON.parse(line) as { id: number; result: { instructions?: string; structuredContent?: { bound?: boolean; next?: string } } };
        if (msg.id === 1) instructions = msg.result.instructions ?? '';
        if (msg.id === 2) {
          child.stdin.end();
          resolve({ instructions, bootstrap: msg.result.structuredContent ?? {}, ms: Date.now() - started });
        }
      }
    });
    child.on('error', reject);
    const send = (m: unknown): boolean => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'binding', version: '0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bootstrap', arguments: {} } });
  });
}

test('a server started while another process holds the write lock still binds', { timeout: 60_000 }, async () => {
  const fx = sterile();
  try {
    const project = initProject(fx);
    // A store an older build last wrote is in the rollback journal, where an
    // exclusive lock blocks readers too: the worst case for a starting server.
    const holder = new DatabaseSync(join(project, '.construct', 'state', 'construct.sqlite'));
    holder.exec('PRAGMA journal_mode = DELETE');
    holder.exec('BEGIN EXCLUSIVE');
    holder.exec(`INSERT INTO meta (key, value) VALUES ('lock-probe', 'x')`);
    const release = setTimeout(() => {
      holder.exec('ROLLBACK');
      holder.close();
    }, 1500);
    const result = await handshake(project, envFor(fx));
    clearTimeout(release);
    assert.doesNotMatch(result.instructions, /could not bind|construct init/);
    assert.notEqual(result.bootstrap.bound, false);
    assert.ok(result.ms >= 1000, `the lock was held for 1.5 s, yet the server answered after ${String(result.ms)} ms`);
    assert.ok(result.ms < 15_000, `bound after ${String(result.ms)} ms`);
  } finally {
    fx.cleanup();
  }
});

test('a store written by a newer build yields advice to upgrade, never to init or reset', { timeout: 60_000 }, async () => {
  const fx = sterile();
  try {
    const project = initProject(fx);
    const db = new DatabaseSync(join(project, '.construct', 'state', 'construct.sqlite'));
    db.prepare(`UPDATE meta SET value = '99' WHERE key = 'format_version'`).run();
    db.close();
    const result = await handshake(project, envFor(fx));
    assert.match(result.instructions, /newer version of Construct/);
    assert.match(result.bootstrap.next ?? '', /Upgrade Construct/);
    assert.doesNotMatch(`${result.instructions} ${result.bootstrap.next ?? ''}`, /construct init|run `construct reset`/i);
  } finally {
    fx.cleanup();
  }
});
