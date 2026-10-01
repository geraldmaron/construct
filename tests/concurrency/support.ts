/**
 * tests/concurrency/support.ts — real `construct serve` processes against a
 * sterile project, driven one JSON-RPC request at a time.
 */

import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SterileFixture } from '../harness/sterile.ts';

export const LAUNCHER = fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url));

export function envFor(fx: SterileFixture, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: join(fx.root, 'home'),
    XDG_CONFIG_HOME: fx.paths.configDir,
    XDG_STATE_HOME: fx.paths.stateDir,
    XDG_DATA_HOME: fx.paths.dataDir,
    XDG_CACHE_HOME: fx.paths.cacheDir,
    NO_COLOR: '1',
    ...extra,
  };
}

export function initProject(fx: SterileFixture, name = 'concurrency'): { dir: string; db: string } {
  const dir = join(fx.root, 'project');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(fx.root, 'home'), { recursive: true });
  const made = spawnSync(process.execPath, [LAUNCHER, 'init', '--no-wire', `--name=${name}`, '--scale=solo'], { cwd: dir, env: envFor(fx), encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  return { dir, db: join(dir, '.construct', 'state', 'construct.sqlite') };
}

export interface Reply {
  readonly result?: { instructions?: string; isError?: boolean; structuredContent?: Record<string, unknown> };
  readonly error?: { code: number; message: string };
}

export const INITIALIZE = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-host', version: '1.0' } };

/** A serve process driven one request at a time. */
export class Session {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private readonly waiting = new Map<number, (r: Reply) => void>();
  private nextId = 1;

  constructor(dir: string, env: NodeJS.ProcessEnv, args: readonly string[] = ['--client=claude-code']) {
    this.child = spawn(process.execPath, [LAUNCHER, 'serve', ...args], { cwd: dir, env });
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

  /** The tool's structured result, failing the test when the call errored. */
  async ok(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const r = await this.call(name, args);
    assert.notEqual(r.result?.isError, true, `${name} failed: ${JSON.stringify(r.result?.structuredContent ?? r.error)}`);
    return r.result?.structuredContent ?? {};
  }

  close(): Promise<void> {
    this.child.stdin.end();
    return new Promise((resolve) => this.child.on('close', () => resolve()));
  }

  /** Stop the server the way a host or the operating system would, by signal. */
  kill(signal: NodeJS.Signals): Promise<void> {
    return new Promise((resolve) => {
      this.child.on('close', () => resolve());
      this.child.kill(signal);
    });
  }
}
