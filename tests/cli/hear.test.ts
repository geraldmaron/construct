/**
 * tests/cli/hear.test.ts — hook-shaped talk records a run, and only once.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hear, wordsFromHookInput } from '../../src/cli/hear.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { readWorkLog } from '../../src/kernel/store/worklog.ts';
import { sterileAmbientEnv, sterileHome } from '../harness/sterile.ts';

sterileHome();
sterileAmbientEnv();

const POLAND = 'We want to hire a contractor in Poland';

async function isolated<T>(fn: () => Promise<T> | T): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'construct-hear-'));
  const previous = {
    data: process.env.XDG_DATA_HOME,
    state: process.env.XDG_STATE_HOME,
    cursorKey: process.env.CURSOR_API_KEY,
  };
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_STATE_HOME = join(root, 'state');
  delete process.env.CURSOR_API_KEY;
  try {
    return await fn();
  } finally {
    if (previous.data === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous.data;
    if (previous.state === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previous.state;
    if (previous.cursorKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = previous.cursorKey;
    rmSync(root, { recursive: true, force: true });
  }
}

async function capture(fn: () => Promise<number> | number): Promise<{ code: number; out: string }> {
  const realOut = process.stdout.write.bind(process.stdout);
  let out = '';
  process.stdout.write = ((chunk: string) => {
    out += chunk;
    return true;
  }) as typeof process.stdout.write;
  try {
    return { code: await fn(), out };
  } finally {
    process.stdout.write = realOut;
  }
}

test('wordsFromHookInput reads Cursor and Claude prompt fields', () => {
  assert.equal(
    wordsFromHookInput([], JSON.stringify({ prompt: POLAND, attachments: [] })),
    POLAND,
  );
  assert.equal(
    wordsFromHookInput([], JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: POLAND })),
    POLAND,
  );
  assert.equal(wordsFromHookInput(['--prompt', POLAND], ''), POLAND);
  assert.equal(wordsFromHookInput([], ''), '');
});

test('the same words twice keep one run', async () => {
  await isolated(async () => {
    const first = await capture(() => hear([POLAND], { now: () => '2026-08-28T17:00:00.000Z' }));
    const second = await capture(() => hear([POLAND], { now: () => '2026-08-28T17:01:00.000Z' }));
    assert.equal(first.code, 0);
    assert.equal(second.code, 0);
    const a = JSON.parse(first.out) as { run: string };
    const b = JSON.parse(second.out) as { run: string };
    assert.equal(a.run, b.run);
    const store = openStore(storePath(resolvePaths()));
    try {
      const received = readWorkLog(store).filter((entry) => entry.action === 'outcome-received');
      assert.equal(received.length, 1);
    } finally {
      store.close();
    }
  });
});

test('empty words create no run and still allow the prompt', async () => {
  await isolated(async () => {
    const { code, out } = await capture(() => hear([], { stdinText: '' }));
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(out), { continue: true });
    const store = openStore(storePath(resolvePaths()));
    try {
      assert.equal(
        readWorkLog(store).filter((entry) => entry.action === 'outcome-received').length,
        0,
      );
    } finally {
      store.close();
    }
  });
});

test('a Construct-spawned host does not record the namer prompt as a run', async () => {
  await isolated(async () => {
    const { code, out } = await capture(() =>
      hear([POLAND], { env: { ...process.env, CONSTRUCT_SKIP_HEAR: '1' } }),
    );
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(out), { continue: true });
    const store = openStore(storePath(resolvePaths()));
    try {
      assert.equal(
        readWorkLog(store).filter((entry) => entry.action === 'outcome-received').length,
        0,
      );
    } finally {
      store.close();
    }
  });
});

test('an injected namer that reads the outcome writes namer seats', async () => {
  await isolated(async () => {
    const { code, out } = await capture(() =>
      hear([POLAND], {
        now: () => '2026-08-28T17:10:00.000Z',
        namer: async () => [
          { domain: 'employment', why: 'the words hire a contractor' },
          { domain: 'contracts', why: 'a contractor is an outside party' },
          { domain: 'privacy', why: 'Poland is a place the hire happens in' },
        ],
      }),
    );
    assert.equal(code, 0);
    const store = openStore(storePath(resolvePaths()));
    try {
      const log = readWorkLog(store, JSON.parse(out).run);
      assert.ok(log.some((entry) => entry.action === 'outcome-received'));
      const named = log.filter((entry) => entry.action === 'implication-named');
      assert.ok(named.length >= 1, 'a model that named seats must leave them on the log');
      assert.ok(
        log.some((entry) => (entry.detail as { inferredBy?: string } | null)?.inferredBy === 'namer'),
      );
      assert.ok(
        !log.some((entry) => (entry.detail as { inferredBy?: string } | null)?.inferredBy === 'keywords'),
      );
    } finally {
      store.close();
    }
  });
});

test('a namer that throws stays empty and is not the keyword map', async () => {
  await isolated(async () => {
    const { code } = await capture(() =>
      hear([POLAND], {
        now: () => '2026-08-28T17:11:00.000Z',
        namer: async () => {
          throw new Error('host not logged in');
        },
      }),
    );
    assert.equal(code, 0);
    const store = openStore(storePath(resolvePaths()));
    try {
      const log = readWorkLog(store);
      const unnamed = log.find((entry) => entry.action === 'no-domains-implicated');
      assert.equal((unnamed?.detail as { inferredBy?: string }).inferredBy, 'none');
      assert.ok(
        !log.some((entry) => (entry.detail as { inferredBy?: string } | null)?.inferredBy === 'keywords'),
      );
      assert.ok(
        !log.some((entry) => (entry.detail as { inferredBy?: string } | null)?.inferredBy === 'namer'),
      );
    } finally {
      store.close();
    }
  });
});
