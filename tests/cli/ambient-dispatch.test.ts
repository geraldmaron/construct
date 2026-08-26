/**
 * tests/cli/ambient-dispatch.test.ts — the CLI-surface half of ambient-host
 * detection: `parseWorkArgs` defaulting `--host` to the session Construct is
 * already running inside, `work` dispatching straight there instead of
 * asking the cost-based census, and every relayed next-step command (the
 * no-host hint, the two `outcome` hints, `doctor`) naming that host.
 *
 * Every case hands its own env object rather than touching `process.env`, so
 * nothing here depends on what actually launched the test runner — which is
 * itself very likely a detected host (an agent session running its own
 * tests carries exactly the markers this module looks for).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, outcome, parseWorkArgs, work, doctor } from '../../src/cli/index.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';
import type { ProbeExec } from '../../src/hosts/presence.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { readWorkLog } from '../../src/kernel/store/worklog.ts';
import { sterileAmbientEnv, sterileHome } from '../harness/sterile.ts';

sterileHome();
// The parseWorkArgs-level cases below hand env explicitly, so this only
// protects the work()/outcome()/doctor() integration cases that call
// detectAmbientHost() through their own default `process.env` parameter.
sterileAmbientEnv();

const CLAUDE_ENV = { CLAUDECODE: '1' };
const CURSOR_ENV = { CURSOR_AGENT: '1' };
const BOB_ENV = { BOB_SHELL_CLI_IDE_SERVER_PORT: '42991' };

test('parseWorkArgs defaults --host to claude under Claude Code markers', () => {
  assert.equal(parseWorkArgs([], CLAUDE_ENV).host, 'claude');
  assert.equal(parseWorkArgs([], CLAUDE_ENV).hostExplicit, false, 'a default is not a typed choice');
});

test('parseWorkArgs defaults --host to cursor under Cursor markers', () => {
  assert.equal(parseWorkArgs([], CURSOR_ENV).host, 'cursor');
});

test('parseWorkArgs does not default --host to bob: bob has no wired adapter', () => {
  // bob is detected (ambientHost), but HOST_NAMES has no adapter for it, so
  // the validated `host` field falls all the way through to opencode — the
  // last resort, never a silent swap to a host that cannot dispatch.
  const args = parseWorkArgs([], BOB_ENV);
  assert.equal(args.host, 'opencode');
  assert.equal(args.ambientHost, 'bob');
  assert.equal(args.ambientWired, false);
});

test('with no ambient markers, --host still defaults to opencode — the regression case', () => {
  const args = parseWorkArgs([], {});
  assert.equal(args.host, 'opencode');
  assert.equal(args.ambientHost, undefined);
  assert.equal(args.ambientWired, false);
});

test('a typed --host beats ambient detection outright', () => {
  const args = parseWorkArgs(['--host=opencode'], CLAUDE_ENV);
  assert.equal(args.host, 'opencode');
  assert.equal(args.hostExplicit, true);
});

function standInHost(): HostAdapter {
  return {
    name: 'stand-in',
    kind: 'general',
    capabilities: [],
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (request: unknown): Promise<HostResult> => ({
      id: (request as { role?: string }).role ?? 'x',
      status: 'ok',
      output: { text: 'ISSUE: a thing worth raising.', usage: { cost: 0.01, steps: 1 } },
      error: null,
    }),
  };
}

const OUTCOME = 'launch a paid beta to EU users next month';

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
  readonly entries: readonly { readonly action: string; readonly detail: unknown }[];
}

/** A probe that always answers as if every host binary were present, so a
 * census that ran would have something to choose from — used to prove the
 * census did NOT run when an ambient host is expected to bypass it. */
const worldWithEverything: ProbeExec = (file) => {
  if (file === 'claude') return '2.1.216 (Claude Code)';
  if (file === 'codex') return 'codex-cli 0.145.0';
  if (file === 'cursor') return '1.0.0';
  if (file === 'opencode') return '1.15.4';
  return null;
};

async function runAgainst(
  env: NodeJS.ProcessEnv,
  options: { readonly argv?: string[]; readonly probe?: ProbeExec } = {},
): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-ambient-'));
  const previous = { data: process.env.XDG_DATA_HOME, cache: process.env.XDG_CACHE_HOME };
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_CACHE_HOME = join(root, 'cache');

  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  (process.stderr as { write: unknown }).write = (c: string) => (err.push(String(c)), true);

  try {
    await main(['outcome', OUTCOME]);
    const code = await work(
      options.argv ?? ['--all'],
      standInHost(),
      options.probe ?? worldWithEverything,
      env,
    );
    const store = openStore(storePath(resolvePaths()));
    try {
      const entries = readWorkLog(store).map((e) => ({ action: e.action, detail: e.detail }));
      return { code, out: out.join(''), err: err.join(''), entries };
    } finally {
      store.close();
    }
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
    if (previous.data === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous.data;
    if (previous.cache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previous.cache;
    rmSync(root, { recursive: true, force: true });
  }
}

test('a wired ambient host is dispatched to directly, bypassing the cost-based census', async () => {
  const capture = await runAgainst(CLAUDE_ENV);
  assert.equal(capture.code, 0);
  assert.doesNotMatch(capture.out, /resource: /, 'the census never ran — ambient already answered');
  assert.equal(
    capture.entries.filter((e) => e.action === 'resource-selected').length,
    0,
    'nothing was selected because nothing was asked',
  );
});

test('with no ambient markers, the cost-based census still runs exactly as before', async () => {
  const capture = await runAgainst({});
  assert.match(capture.out, /resource: /, 'the pre-existing census path is unaffected');
});

test('bob is ambiently detected but never bypasses the census: it has no wired adapter', async () => {
  const capture = await runAgainst(BOB_ENV);
  assert.match(capture.out, /resource: /, 'no wired adapter for bob, so the census still decides');
});

test('the no-host refusal names a detected-but-unwired ambient host as projection-only', async () => {
  const capture = await runAgainst(BOB_ENV, { probe: (): null => null });
  assert.equal(capture.code, 1);
  assert.match(capture.err, /Running inside bob/);
  assert.match(capture.err, /no wired dispatch adapter — presence only, not execution/);
  assert.match(capture.err, /Name one yourself to dispatch anyway/);
});

test('the no-host refusal names nothing extra when no ambient host is detected', async () => {
  const capture = await runAgainst({}, { probe: (): null => null });
  assert.equal(capture.code, 1);
  assert.doesNotMatch(capture.err, /running inside/);
  assert.match(capture.err, /Name one yourself to dispatch anyway/);
});

test('in-session outcome does not staff from the keyword map or name a run to work next', async () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-ambient-outcome-'));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  const out: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  try {
    const code = await outcome([OUTCOME], undefined, CLAUDE_ENV);
    assert.equal(code, 0);
    const text = out.join('');
    assert.match(text, /Talk here/);
    assert.match(text, /A packet is not a seat/);
    assert.match(text, /how: namer/);
    assert.match(text, /where: session/);
    assert.match(text, /inbox/);
    assert.doesNotMatch(text, /implicated domains/);
    assert.doesNotMatch(text, /Run them: {2}construct work --run/);
    assert.doesNotMatch(text, /record_outcome/);
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('outcome names no host in the next-step hint with no ambient markers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-ambient-outcome-none-'));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  const out: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  try {
    const code = await outcome([OUTCOME], undefined, {});
    assert.equal(code, 0);
    assert.match(out.join(''), /Run them: {2}construct work --run run-\S+\n/);
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

async function captureStdout<T>(fn: () => T | Promise<T>): Promise<{ result: T; out: string }> {
  const realOut = process.stdout.write.bind(process.stdout);
  let out = '';
  process.stdout.write = ((chunk: string) => {
    out += chunk;
    return true;
  }) as typeof process.stdout.write;
  try {
    return { result: await fn(), out };
  } finally {
    process.stdout.write = realOut;
  }
}

test('doctor names in-session dispatch through serve when the ambient host is present', async () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-ambient-doctor-'));
  const previousData = process.env.XDG_DATA_HOME;
  const previousState = process.env.XDG_STATE_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_STATE_HOME = join(root, 'state');
  try {
    const { out } = await captureStdout(() => doctor(root, CLAUDE_ENV));
    assert.match(out, /ok {3}ambient {2}running inside claude \(detected via CLAUDECODE\); in-session dispatch: this session via construct serve \(will not spawn claude\)/);
  } finally {
    if (previousData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousData;
    if (previousState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousState;
    rmSync(root, { recursive: true, force: true });
  }
});

test('doctor names in-session dispatch through serve for Bob, which has no spawn adapter', async () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-ambient-doctor-bob-'));
  const previousData = process.env.XDG_DATA_HOME;
  const previousState = process.env.XDG_STATE_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_STATE_HOME = join(root, 'state');
  try {
    const { out } = await captureStdout(() => doctor(root, BOB_ENV));
    assert.match(
      out,
      /ok {3}ambient {2}running inside bob \(detected via BOB_SHELL_CLI_IDE_SERVER_PORT\); in-session dispatch: this session via construct serve/,
    );
  } finally {
    if (previousData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousData;
    if (previousState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousState;
    rmSync(root, { recursive: true, force: true });
  }
});

test('doctor names no detected host session with no ambient markers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-ambient-doctor-none-'));
  const previousData = process.env.XDG_DATA_HOME;
  const previousState = process.env.XDG_STATE_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_STATE_HOME = join(root, 'state');
  try {
    const { out } = await captureStdout(() => doctor(root, {}));
    assert.match(out, /ok {3}ambient {2}not running inside a detected host session/);
  } finally {
    if (previousData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousData;
    if (previousState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousState;
    rmSync(root, { recursive: true, force: true });
  }
});
