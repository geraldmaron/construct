/**
 * tests/cli/host-submit.test.ts — Send, not a typed verb.
 *
 * Cursor `beforeSubmitPrompt` and Claude `UserPromptSubmit` launch the
 * command stored in the hook file, with the user text on stdin. This
 * file reads those committed (or init-planted) commands and runs them
 * the way the host does. It does not construct `construct hear` itself.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../../src/cli/init.ts';
import { isHearCommand } from '../../src/hosts/prompthook.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { readWorkLog } from '../../src/kernel/store/worklog.ts';
import { sterileAmbientEnv, sterileHome } from '../harness/sterile.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const POLAND = 'We want to hire a contractor in Poland';

sterileHome();
sterileAmbientEnv();

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function commandsIn(entry: unknown): string[] {
  if (entry === null || typeof entry !== 'object') return [];
  const direct = (entry as { command?: unknown }).command;
  const inner = (entry as { hooks?: unknown }).hooks;
  const nested = Array.isArray(inner) ? inner.flatMap((item) => commandsIn(item)) : [];
  return typeof direct === 'string' ? [direct, ...nested] : nested;
}

function hearCommandFrom(config: Record<string, unknown>, event: string): string {
  const entries = asObject(config.hooks)[event];
  assert.ok(Array.isArray(entries), `hook event ${event} missing`);
  const found = entries.flatMap((entry) => commandsIn(entry)).find(isHearCommand);
  assert.ok(found, `${event} does not launch the talk recorder`);
  assert.doesNotMatch(found, /^construct hear\b/, 'the host command is not a verb the user types');
  return found;
}

function isolatedEnv(): { env: NodeJS.ProcessEnv; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'construct-host-submit-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_DATA_HOME: join(root, 'share'),
    XDG_STATE_HOME: join(root, 'state'),
    XDG_CACHE_HOME: join(root, 'cache'),
    HOME: join(root, 'home'),
  };
  delete env.CURSOR_AGENT;
  delete env.CLAUDECODE;
  return {
    env,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function submitThroughHook(
  command: string,
  payload: Record<string, unknown>,
  cwd: string,
  env: NodeJS.ProcessEnv,
): { status: number | null; stdout: string; stderr: string } {
  const spawned = spawnSync('sh', ['-c', command], {
    cwd,
    env,
    encoding: 'utf8',
    input: `${JSON.stringify(payload)}\n`,
  });
  return { status: spawned.status, stdout: spawned.stdout, stderr: spawned.stderr };
}

function assertPolandRun(env: NodeJS.ProcessEnv): void {
  const previous = {
    data: process.env.XDG_DATA_HOME,
    state: process.env.XDG_STATE_HOME,
  };
  process.env.XDG_DATA_HOME = env.XDG_DATA_HOME;
  process.env.XDG_STATE_HOME = env.XDG_STATE_HOME;
  const store = openStore(storePath(resolvePaths()));
  try {
    const received = readWorkLog(store).filter((entry) => entry.action === 'outcome-received');
    assert.equal(received.length, 1, 'Send must leave one outcome-received');
    assert.equal((received[0]?.detail as { outcome?: string }).outcome, POLAND);
    const unnamed = readWorkLog(store).find((entry) => entry.action === 'no-domains-implicated');
    assert.equal((unnamed?.detail as { inferredBy?: string }).inferredBy, 'none');
    assert.ok(
      !readWorkLog(store).some((entry) => (entry.detail as { inferredBy?: string } | null)?.inferredBy === 'namer'),
    );
  } finally {
    store.close();
    if (previous.data === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous.data;
    if (previous.state === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previous.state;
  }
}

test('Cursor beforeSubmitPrompt in this checkout records Send, not a typed verb', () => {
  const isolated = isolatedEnv();
  try {
    const config = JSON.parse(readFileSync(join(ROOT, '.cursor', 'hooks.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    const command = hearCommandFrom(config, 'beforeSubmitPrompt');
    const result = submitThroughHook(
      command,
      { hook_event_name: 'beforeSubmitPrompt', prompt: POLAND },
      ROOT,
      isolated.env,
    );
    assert.equal(result.status, 0, result.stderr);
    const reply = JSON.parse(result.stdout) as { continue: boolean; run?: string };
    assert.equal(reply.continue, true);
    assert.ok(reply.run);
    assertPolandRun(isolated.env);
  } finally {
    isolated.cleanup();
  }
});

test('Claude UserPromptSubmit in this checkout records Send, not a typed verb', () => {
  const isolated = isolatedEnv();
  try {
    const config = JSON.parse(readFileSync(join(ROOT, '.claude', 'settings.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    const command = hearCommandFrom(config, 'UserPromptSubmit');
    const result = submitThroughHook(
      command,
      { hook_event_name: 'UserPromptSubmit', prompt: POLAND },
      ROOT,
      isolated.env,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.ok(JSON.parse(result.stdout).run);
    assertPolandRun(isolated.env);
  } finally {
    isolated.cleanup();
  }
});

test('init --yes plants the hook; Send through that file records a run', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'construct-init-submit-'));
  const isolated = isolatedEnv();
  try {
    const code = init(['--yes'], cwd, { ...isolated.env, CLAUDECODE: '1', HOME: isolated.env.HOME });
    assert.equal(code, 0);
    const planted = JSON.parse(readFileSync(join(cwd, '.claude', 'settings.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    const command = hearCommandFrom(planted, 'UserPromptSubmit');
    const result = submitThroughHook(
      command,
      { hook_event_name: 'UserPromptSubmit', prompt: POLAND },
      cwd,
      isolated.env,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.ok(JSON.parse(result.stdout).run);
    assertPolandRun(isolated.env);
  } finally {
    isolated.cleanup();
    rmSync(cwd, { recursive: true, force: true });
  }
});
