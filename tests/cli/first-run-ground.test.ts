/**
 * tests/cli/first-run-ground.test.ts — first-run talk creates a run.
 *
 * The phrase-table namer is gone. Folder names that match a catalog word
 * are not seats. What this file locks: ordinary words, including a
 * Cursor/Claude hook payload, record a run without `record_outcome`,
 * without `construct outcome`, and without writing `inferredBy: namer`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hear } from '../../src/cli/index.ts';
import { createProjectionHandler } from '../../src/hosts/mcp/projection.ts';
import { mapImplications } from '../../src/kernel/implication/map.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { readWorkLog } from '../../src/kernel/store/worklog.ts';
import { sterileAmbientEnv, sterileHome } from '../harness/sterile.ts';

sterileHome();
sterileAmbientEnv();

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const POLAND = 'We want to hire a contractor in Poland';

async function isolated<T>(fn: (cwd: string) => Promise<T> | T): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'construct-first-run-ground-'));
  const previous = {
    data: process.env.XDG_DATA_HOME,
    state: process.env.XDG_STATE_HOME,
    cursorKey: process.env.CURSOR_API_KEY,
  };
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_STATE_HOME = join(root, 'state');
  delete process.env.CURSOR_API_KEY;
  try {
    return await fn(root);
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

async function captureHear(
  argv: string[],
  opts: { stdinText?: string; now?: () => string } = {},
): Promise<{
  code: number;
  out: string;
}> {
  const realOut = process.stdout.write.bind(process.stdout);
  let out = '';
  process.stdout.write = ((chunk: string) => {
    out += chunk;
    return true;
  }) as typeof process.stdout.write;
  try {
    return { code: await hear(argv, opts), out };
  } finally {
    process.stdout.write = realOut;
  }
}

async function recordOnServe(
  words: string,
  namings: Array<{ domain: string; why: string }> | undefined,
  at: string,
): Promise<{
  implicated: string[];
  inferredBy?: string;
  isError?: boolean;
  out: string;
  run?: string;
  logActions: string[];
}> {
  const store = openStore(storePath(resolvePaths()));
  const handle = createProjectionHandler({
    store,
    clock: () => at,
    serverVersion: 'test',
    secret: 'test-secret-not-a-real-key',
  });
  const named = await handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'record_outcome',
      arguments: namings === undefined ? { outcome: words } : { outcome: words, namings },
    },
  });
  const result = named?.result as { content: Array<{ text: string }>; isError?: boolean };
  if (result.isError) {
    store.close();
    return {
      implicated: [],
      out: result.content[0]?.text ?? '',
      isError: true,
      logActions: [],
    };
  }
  const body = JSON.parse(result.content[0]!.text) as {
    run: string;
    implicated: Array<{ domain: string }>;
    inferredBy?: string;
  };
  const log = readWorkLog(store, body.run);
  store.close();
  return {
    implicated: body.implicated.map((row) => row.domain),
    inferredBy: body.inferredBy,
    out: JSON.stringify(body),
    run: body.run,
    logActions: log.map((entry) => entry.action),
  };
}

test('omitting namings on serve is not an error and creates a run', async () => {
  await isolated(async () => {
    const recorded = await recordOnServe('is this ready', undefined, '2026-08-28T15:00:00.000Z');
    assert.equal(recorded.isError, undefined);
    assert.ok(recorded.run, 'talk must create a run');
    assert.ok(recorded.logActions.includes('outcome-received'), 'empty log is a miss');
    assert.notEqual(recorded.inferredBy, 'keywords');
    assert.notEqual(recorded.inferredBy, 'namer');
    assert.doesNotMatch(recorded.out, /requires namings/);
  });
});

test('Cursor beforeSubmitPrompt stdin creates a run without record_outcome', async () => {
  await isolated(async () => {
    const { code, out } = await captureHear([], {
      stdinText: JSON.stringify({ prompt: POLAND, hook_event_name: 'beforeSubmitPrompt' }),
      now: () => '2026-08-28T16:00:00.000Z',
    });
    assert.equal(code, 0);
    const reply = JSON.parse(out) as { continue: boolean; run?: string };
    assert.equal(reply.continue, true);
    assert.ok(reply.run, 'hook talk must create a run');

    const store = openStore(storePath(resolvePaths()));
    try {
      const log = readWorkLog(store, reply.run);
      assert.ok(log.some((entry) => entry.action === 'outcome-received'), 'talk-plus-empty-log is a miss');
      const received = log.find((entry) => entry.action === 'outcome-received');
      assert.equal((received?.detail as { outcome?: string }).outcome, POLAND);
      const unnamed = log.find((entry) => entry.action === 'no-domains-implicated');
      assert.equal((unnamed?.detail as { inferredBy?: string }).inferredBy, 'none');
      assert.ok(!log.some((entry) => entry.action === 'implication-named'));
    } finally {
      store.close();
    }
  });
});

test('Claude UserPromptSubmit stdin creates a run without record_outcome', async () => {
  await isolated(async () => {
    const { code, out } = await captureHear([], {
      stdinText: JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        prompt: POLAND,
      }),
      now: () => '2026-08-28T16:01:00.000Z',
    });
    assert.equal(code, 0);
    const reply = JSON.parse(out) as { continue: boolean; run?: string };
    assert.equal(reply.continue, true);
    assert.ok(reply.run);
    const store = openStore(storePath(resolvePaths()));
    try {
      assert.ok(readWorkLog(store, reply.run).some((entry) => entry.action === 'outcome-received'));
    } finally {
      store.close();
    }
  });
});

test('the same spoken words do not write inferredBy namer or staff from a phrase table', async () => {
  await isolated(async () => {
    const keywordOnly = mapImplications({ outcome: POLAND }).implicated.map((row) => row.domain);
    assert.deepEqual(keywordOnly, ['employment'], 'the keyword map still misses the dark corners');

    await captureHear([POLAND], { now: () => '2026-08-28T16:02:00.000Z' });
    const store = openStore(storePath(resolvePaths()));
    try {
      const log = readWorkLog(store);
      assert.ok(log.some((entry) => entry.action === 'outcome-received'), 'Poland talk must create a run');
      const unnamed = log.find((entry) => entry.action === 'no-domains-implicated');
      assert.equal((unnamed?.detail as { inferredBy?: string }).inferredBy, 'none');
      assert.ok(!log.some((entry) => {
        const detail = entry.detail as { inferredBy?: string } | null;
        return detail?.inferredBy === 'namer';
      }));
    } finally {
      store.close();
    }
  });
});

test('the phrase-table namer is not in the tree', () => {
  assert.equal(existsSync(join(ROOT, 'src/kernel/implication/concern-namer.ts')), false);
  const projection = readFileSync(join(ROOT, 'src/hosts/mcp/projection.ts'), 'utf8');
  assert.doesNotMatch(projection, /OUTSIDE_PARTY|nameFromCatalogConcerns|in CapitalizedPlace/);
  assert.doesNotMatch(projection, /seatFromVisibleGround/);
});

test('first-run docs keep the honesty line and do not claim staff from talk', () => {
  const page = readFileSync(join(ROOT, 'docs/first-run.md'), 'utf8');
  assert.match(page, /does not meet that bar/);
  assert.doesNotMatch(page, /You talk\. Staff shows up/);
  assert.doesNotMatch(page, /Staff shows up/);
  assert.doesNotMatch(page, /omitting namings is an error/);
  assert.doesNotMatch(page, /empty namings array is a real answer that this implicates nothing/i);
  assert.doesNotMatch(page, /construct outcome/);
  assert.doesNotMatch(page, /construct hear/);
  assert.doesNotMatch(page, /construct wire/);
});
