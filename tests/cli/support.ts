/**
 * tests/cli/support.ts — capture what a command prints, and a throwaway
 * initialized project with its own HOME.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { run } from '../../src/cli/index.ts';
import { createContext, type CliContext } from '../../src/cli/context.ts';
import { AMBIENT_ENV_KEYS } from '../../src/hosts/ambient.ts';

export interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

export async function capture(fn: () => number | Promise<number>): Promise<Capture> {
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (chunk: string) => (out.push(String(chunk)), true);
  (process.stderr as { write: unknown }).write = (chunk: string) => (err.push(String(chunk)), true);
  let code: number;
  try {
    code = await fn();
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
  }
  return { code, out: out.join(''), err: err.join('') };
}

export interface Sandbox {
  readonly cwd: string;
  readonly home: string;
  readonly ctx: CliContext;
  cleanup(): void;
}

/** A git repository with a README and its own HOME, no ambient host, deterministic clock and ids. */
export function sandbox(): Sandbox {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'construct-cli-')));
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'construct-cli-home-')));
  mkdirSync(join(cwd, '.git'));
  writeFileSync(join(cwd, 'README.md'), '# Demo\n\nA demo project for the CLI tests.\n', 'utf8');
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'demo', description: 'A demo project' }), 'utf8');
  const env: NodeJS.ProcessEnv = { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_STATE_HOME: join(home, '.state'), XDG_DATA_HOME: join(home, '.data'), XDG_CACHE_HOME: join(home, '.cache'), PATH: process.env.PATH };
  for (const key of AMBIENT_ENV_KEYS) delete env[key];
  let n = 0;
  let t = Date.parse('2026-09-02T12:00:00.000Z');
  const base = createContext(cwd, env);
  const ctx: CliContext = {
    ...base,
    now: () => new Date((t += 1000)).toISOString(),
    nextId: (prefix) => `${prefix}-${String(++n).padStart(4, '0')}`,
  };
  return { cwd, home, ctx, cleanup: () => { rmSync(cwd, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); } };
}

/** An initialized, fully answered project. */
export async function inProject(fn: (ctx: CliContext, box: Sandbox) => Promise<void> | void): Promise<void> {
  const box = sandbox();
  try {
    const init = await capture(() => run(['init', '--scale=solo', '--outcome=ship it', '--constraint=never break the API', `--skills-dir=${join(box.home, 'skills')}`], box.ctx));
    if (init.code !== 0) throw new Error(`init failed: ${init.err}${init.out}`);
    await fn(box.ctx, box);
  } finally {
    box.cleanup();
  }
}
