/**
 * tests/hooks/hook-failsafe.test.ts — an installed host hook never becomes
 * the error the person sees.
 *
 * The exact command the Claude Code pack installs is run as the host runs it,
 * with the event on stdin, across every way things go wrong: no project, a
 * corrupt, locked, or newer store, empty, malformed, or huge input, input
 * that never ends, a missing or broken launcher, an unwritable state
 * directory, nonsense fields, and switched off. Every run exits 0 within two
 * seconds and prints nothing or one line of JSON within 400 bytes; only a
 * run that can still read a healthy store says anything. Each state runs twice here;
 * CX_HOOK_SOAK=<n> runs each n times.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sterile } from '../harness/sterile.ts';
import { envFor, LAUNCHER } from '../concurrency/support.ts';
import { openStateStore } from '../../src/kernel/state/open.ts';
import { registerSession } from '../../src/kernel/state/sessions.ts';
import { claimWork, createWork } from '../../src/kernel/work/service.ts';

const REPEAT = Math.max(1, Number(process.env.CX_HOOK_SOAK ?? 2));
const LIMIT_MS = 2000;

interface Outcome { readonly code: number | null; readonly ms: number; readonly out: string }

function runHook(command: string, cwd: string, env: NodeJS.ProcessEnv, input: string | null): Promise<Outcome> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('/bin/sh', ['-c', command], { cwd, env });
    let out = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.resume();
    const kill = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.on('close', (code) => {
      clearTimeout(kill);
      resolve({ code, ms: Date.now() - started, out });
    });
    child.stdin.on('error', () => {});
    if (input !== null) child.stdin.end(input);
  });
}

test('an installed hook exits 0 within two seconds, saying nothing or one bounded line, whatever breaks', { timeout: 600_000 }, async () => {
  const fx = sterile();
  try {
    const repo = join(fx.root, 'repo');
    mkdirSync(repo, { recursive: true });
    mkdirSync(join(fx.root, 'home'), { recursive: true });
    const env = envFor(fx, { GIT_CONFIG_NOSYSTEM: '1' });
    assert.equal(spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, env }).status, 0);
    assert.equal(spawnSync(process.execPath, [LAUNCHER, 'init', '--no-wire', '--name=failsafe', '--scale=solo'], { cwd: repo, env }).status, 0);
    assert.equal(spawnSync(process.execPath, [LAUNCHER, 'hooks', 'install', '--host=claude-code'], { cwd: repo, env }).status, 0);
    const settings = JSON.parse(readFileSync(join(repo, '.claude', 'settings.local.json'), 'utf8')) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
    const postEdit = settings.hooks.PostToolUse!.at(-1)!.hooks[0]!.command;
    const sessionStart = settings.hooks.SessionStart!.at(-1)!.hooks[0]!.command;

    const stateDir = join(repo, '.construct', 'state');
    const db = join(stateDir, 'construct.sqlite');
    const store = openStateStore(db);
    const now = new Date().toISOString();
    registerSession(store, { id: 'ses_peer', host: 'cursor', surface: 'interactive', machine: 'test', at: now });
    createWork(store, { id: 'w-peer', kind: 'task', title: 'peer', description: 'x', at: now, actor: 'test' });
    claimWork(store, { id: 'w-peer', owner: 'ses_peer/main', session: 'ses_peer', until: new Date(Date.now() + 3_600_000).toISOString(), now, paths: ['src/'] });
    store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    store.close();
    const pristine = join(fx.root, 'pristine.sqlite');
    copyFileSync(db, pristine);
    const restore = (): void => {
      for (const side of ['-wal', '-shm']) rmSync(`${db}${side}`, { force: true });
      copyFileSync(pristine, db);
    };
    const launcher = join(stateDir, 'launcher');
    const launcherText = readFileSync(launcher, 'utf8');
    const edit = JSON.stringify({ cwd: repo, session_id: 'host-x', hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: join(repo, 'src', 'x.ts') } });
    const empty = join(fx.root, 'empty');
    mkdirSync(empty);

    const states: { name: string; command?: string; cwd?: string; input: string | null; env?: NodeJS.ProcessEnv; before?: () => void | (() => void); speaks?: boolean }[] = [
      { name: 'healthy, with a held file', input: edit, speaks: true },
      { name: 'healthy session start', command: sessionStart, input: JSON.stringify({ cwd: repo, source: 'startup' }), speaks: true },
      { name: 'no project', cwd: empty, input: JSON.stringify({ cwd: empty, tool_name: 'Edit', tool_input: { file_path: join(empty, 'a.ts') } }) },
      { name: 'corrupt store', input: edit, before: () => (writeFileSync(db, 'this is not a database'), restore) },
      { name: 'newer store', input: edit, before: () => {
        const d = new DatabaseSync(db);
        d.exec(`UPDATE meta SET value = '99' WHERE key = 'format_version'`);
        d.close();
        return restore;
      } },
      { name: 'locked store', input: edit, before: () => {
        const d = new DatabaseSync(db);
        d.exec('PRAGMA locking_mode = EXCLUSIVE');
        d.exec('BEGIN EXCLUSIVE');
        d.exec(`UPDATE meta SET value = value WHERE key = 'format_version'`);
        return () => {
          d.exec('ROLLBACK');
          d.close();
          restore();
        };
      } },
      { name: 'empty input', input: '' },
      { name: 'malformed input', input: '{"cwd": ' },
      { name: 'huge input', input: `{"cwd":"${repo}","pad":"${'x'.repeat(5_000_000)}"}` },
      { name: 'input that never ends', input: null },
      { name: 'nonsense fields', input: JSON.stringify({ cwd: 42, tool_name: ['Edit'], tool_input: { file_path: 7 } }) },
      { name: 'launcher missing', input: edit, before: () => (renameSync(launcher, `${launcher}.away`), () => renameSync(`${launcher}.away`, launcher)) },
      { name: 'launcher broken', input: edit, before: () => (writeFileSync(launcher, '/no/such/node\n/no/such/construct.mjs\n'), () => writeFileSync(launcher, launcherText)) },
      { name: 'state directory unwritable', input: edit, speaks: true, before: () => (chmodSync(stateDir, 0o500), () => chmodSync(stateDir, 0o700)) },
      { name: 'switched off', input: edit, env: { CONSTRUCT_HOOKS: 'off' } },
    ];

    const failures: string[] = [];
    let runs = 0;
    for (const state of states) {
      for (let i = 0; i < REPEAT; i += 1) {
        const undo = state.before?.();
        try {
          const r = await runHook(state.command ?? postEdit, state.cwd ?? repo, { ...env, ...state.env }, state.input);
          runs += 1;
          if (r.code !== 0) failures.push(`${state.name}: exit ${String(r.code)}`);
          if (r.ms > LIMIT_MS) failures.push(`${state.name}: ${String(r.ms)}ms`);
          const out = r.out.trim();
          if (out) {
            if (Buffer.byteLength(out) > 400) failures.push(`${state.name}: ${String(Buffer.byteLength(out))} bytes`);
            try {
              JSON.parse(out);
            } catch {
              failures.push(`${state.name}: output is not JSON: ${out.slice(0, 80)}`);
            }
          }
          if (state.speaks === true && !out) failures.push(`${state.name}: said nothing`);
          if (state.speaks !== true && out) failures.push(`${state.name}: spoke: ${out.slice(0, 80)}`);
        } finally {
          if (typeof undo === 'function') undo();
        }
      }
    }
    assert.deepEqual(failures, [], `${String(failures.length)} of ${String(runs)} runs misbehaved`);
    const health = JSON.parse(readFileSync(join(stateDir, 'hook-health.json'), 'utf8')) as Record<string, { runs: number; said: number; failed: number }>;
    const edits = health['claude-code:post-tool-use']!;
    assert.ok(edits.said >= REPEAT, 'what it said is counted');
    assert.ok(edits.failed >= REPEAT * 3, 'a corrupt, newer, or locked store counts as a failed run, not a quiet one');
  } finally {
    fx.cleanup();
  }
});
