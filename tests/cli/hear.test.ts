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

function isolated<T>(fn: () => T): T {
  const root = mkdtempSync(join(tmpdir(), 'construct-hear-'));
  const previous = { data: process.env.XDG_DATA_HOME, state: process.env.XDG_STATE_HOME };
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_STATE_HOME = join(root, 'state');
  try {
    return fn();
  } finally {
    if (previous.data === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous.data;
    if (previous.state === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previous.state;
    rmSync(root, { recursive: true, force: true });
  }
}

function capture(fn: () => number): { code: number; out: string } {
  const realOut = process.stdout.write.bind(process.stdout);
  let out = '';
  process.stdout.write = ((chunk: string) => {
    out += chunk;
    return true;
  }) as typeof process.stdout.write;
  try {
    return { code: fn(), out };
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

test('the same words twice keep one run', () => {
  isolated(() => {
    const first = capture(() => hear([POLAND], { now: () => '2026-08-28T17:00:00.000Z' }));
    const second = capture(() => hear([POLAND], { now: () => '2026-08-28T17:01:00.000Z' }));
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

test('empty words create no run and still allow the prompt', () => {
  isolated(() => {
    const { code, out } = capture(() => hear([], { stdinText: '' }));
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
