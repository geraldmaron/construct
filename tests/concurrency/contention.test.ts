/**
 * tests/concurrency/contention.test.ts — several OS processes share one
 * project's state database at the same time, the way parallel host sessions
 * and the command line do, and none of them fails for a lock.
 *
 * Every writer runs in its own process against a sterile project: command-line
 * workers each loop `work add`, and MCP servers each answer a stream of `work`
 * calls over stdio. The database must end with exactly one row per call, pass
 * SQLite's integrity check, and be in WAL mode.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { sterile, type SterileFixture } from '../harness/sterile.ts';

const LAUNCHER = fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url));
const WORKER = fileURLToPath(new URL('./worker.ts', import.meta.url));

const CLI_WORKERS = 12;
const CLI_ADDS = 15;
const SERVERS = 3;
const SERVER_CALLS = 40;

function envFor(fx: SterileFixture): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: join(fx.root, 'home'),
    XDG_CONFIG_HOME: fx.paths.configDir,
    XDG_STATE_HOME: fx.paths.stateDir,
    XDG_DATA_HOME: fx.paths.dataDir,
    XDG_CACHE_HOME: fx.paths.cacheDir,
    NO_COLOR: '1',
  };
  return env;
}

function initProject(fx: SterileFixture): string {
  const project = join(fx.root, 'project');
  spawnSync('mkdir', ['-p', project, join(fx.root, 'home')]);
  const made = spawnSync(process.execPath, [LAUNCHER, 'init', '--no-wire', '--name=contention', '--scale=solo'], { cwd: project, env: envFor(fx), encoding: 'utf8' });
  assert.equal(made.status, 0, `init failed: ${made.stderr}`);
  return project;
}

interface WorkerResult {
  readonly exits: number[];
  readonly locked: number;
}

function runWorker(project: string, env: NodeJS.ProcessEnv, label: string): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER, label, String(CLI_ADDS)], { cwd: project, env });
    let err = '';
    child.stderr.on('data', (d) => (err += String(d)));
    child.on('error', reject);
    child.on('close', () => {
      const line = err.trim().split('\n').filter((l) => l.startsWith('{')).pop();
      if (!line) return reject(new Error(`worker ${label} printed no result: ${err.slice(0, 400)}`));
      resolve(JSON.parse(line) as WorkerResult);
    });
  });
}

interface ServerResult {
  readonly ok: number;
  readonly errors: string[];
}

function runServer(project: string, env: NodeJS.ProcessEnv, label: string): Promise<ServerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [LAUNCHER, 'serve', '--client=claude-code'], { cwd: project, env });
    let buffer = '';
    let ok = 0;
    const errors: string[] = [];
    const expected = SERVER_CALLS + 1;
    let seen = 0;
    child.stdout.on('data', (d) => {
      buffer += String(d);
      for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line) as { id?: number; result?: { isError?: boolean; content?: Array<{ text: string }> }; error?: { message: string } };
        seen += 1;
        if (msg.id !== 0) {
          if (msg.error) errors.push(msg.error.message);
          else if (msg.result?.isError) errors.push(msg.result.content?.[0]?.text ?? 'isError');
          else ok += 1;
        }
        if (seen >= expected) child.stdin.end();
      }
    });
    child.on('error', reject);
    child.on('close', () => resolve({ ok, errors }));
    const send = (m: unknown): boolean => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'contention', version: '0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    for (let i = 1; i <= SERVER_CALLS; i += 1) {
      const add = i % 3 !== 0;
      send({ jsonrpc: '2.0', id: i, method: 'tools/call', params: { name: 'work', arguments: add ? { action: 'add', title: `${label}-${String(i)}` } : { action: 'list' } } });
    }
  });
}

test('parallel command-line writers and MCP servers never fail for a lock', { timeout: 180_000 }, async () => {
  const fx = sterile();
  try {
    const project = initProject(fx);
    const env = envFor(fx);
    const [workers, servers] = await Promise.all([
      Promise.all(Array.from({ length: CLI_WORKERS }, (_, i) => runWorker(project, env, `cli${String(i)}`))),
      Promise.all(Array.from({ length: SERVERS }, (_, i) => runServer(project, env, `mcp${String(i)}`))),
    ]);

    const cliFailures = workers.flatMap((w) => w.exits.filter((code) => code !== 0));
    assert.deepEqual(cliFailures, [], `command-line calls failed: ${JSON.stringify(workers.map((w) => w.locked))}`);
    assert.equal(workers.reduce((n, w) => n + w.locked, 0), 0, 'no call may report a lock');
    const serverErrors = servers.flatMap((s) => s.errors);
    assert.deepEqual(serverErrors, [], 'no MCP call may fail');

    const db = new DatabaseSync(join(project, '.construct', 'state', 'construct.sqlite'), { readOnly: true });
    try {
      const adds = CLI_WORKERS * CLI_ADDS + SERVERS * Math.ceil((SERVER_CALLS * 2) / 3);
      const rows = (db.prepare('SELECT COUNT(*) AS n FROM work_items').get() as { n: number }).n;
      assert.equal(rows, adds, 'exactly one row per add');
      assert.equal((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
      assert.equal((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode, 'wal');
    } finally {
      db.close();
    }
  } finally {
    fx.cleanup();
  }
});

function startOutcome(project: string, env: NodeJS.ProcessEnv): Promise<{ created: boolean; runId: string } | { error: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [LAUNCHER, 'serve', '--client=cursor'], { cwd: project, env });
    let buffer = '';
    child.stdout.on('data', (d) => {
      buffer += String(d);
      for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const msg = JSON.parse(line) as { id: number; result?: { isError?: boolean; structuredContent?: { created?: boolean; run?: { id: string }; error?: string } } };
        if (msg.id !== 2) continue;
        child.stdin.end();
        const sc = msg.result?.structuredContent;
        resolve(msg.result?.isError ? { error: sc?.error ?? 'error' } : { created: sc?.created === true, runId: sc?.run?.id ?? '' });
      }
    });
    child.on('error', reject);
    const send = (m: unknown): boolean => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'race', version: '0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'start_outcome', arguments: { workflowId: 'design-conformance', input: { target: 'README.md' } } } });
  });
}

test('sessions starting the same outcome at once get one run between them', { timeout: 120_000 }, async () => {
  const fx = sterile();
  try {
    const project = initProject(fx);
    writeFileSync(join(project, 'README.md'), '# Race\n');
    const env = envFor(fx);
    const results = await Promise.all(Array.from({ length: 4 }, () => startOutcome(project, env)));
    const errors = results.filter((r) => 'error' in r);
    assert.deepEqual(errors, []);
    const runs = new Set(results.map((r) => ('runId' in r ? r.runId : '')));
    assert.equal(runs.size, 1, `one run for one piece of work, got ${JSON.stringify(results)}`);
    assert.equal(results.filter((r) => 'created' in r && r.created).length, 1);
  } finally {
    fx.cleanup();
  }
});
