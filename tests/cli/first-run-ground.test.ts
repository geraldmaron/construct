/**
 * tests/cli/first-run-ground.test.ts — 1+3 first-run: talk creates a run,
 * and a seat that lives only in visible ground has to show up.
 *
 * The keyword map on the Poland sentence is employment-only. That result
 * is a fail here. Seats come from artifact identity, not from stemming
 * contractor into contracts or adding Poland to a phrase table.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { doctor } from '../../src/cli/index.ts';
import { createProjectionHandler } from '../../src/hosts/mcp/projection.ts';
import { mapImplications } from '../../src/kernel/implication/map.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { addSource } from '../../src/kernel/store/sources.ts';
import { readWorkLog } from '../../src/kernel/store/worklog.ts';
import { sterileAmbientEnv, sterileHome } from '../harness/sterile.ts';

sterileHome();
sterileAmbientEnv();

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const VERITY_GROUND = join(ROOT, 'fixtures/first-run/verity-case-1');
const POLAND = 'We want to hire a contractor in Poland';

async function captureDoctor(env: NodeJS.ProcessEnv): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'construct-doctor-fr-'));
  const previous = { data: process.env.XDG_DATA_HOME, state: process.env.XDG_STATE_HOME };
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_STATE_HOME = join(root, 'state');
  const realOut = process.stdout.write.bind(process.stdout);
  let out = '';
  process.stdout.write = ((chunk: string) => {
    out += chunk;
    return true;
  }) as typeof process.stdout.write;
  try {
    await doctor(root, env);
    return out;
  } finally {
    process.stdout.write = realOut;
    if (previous.data === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous.data;
    if (previous.state === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previous.state;
    rmSync(root, { recursive: true, force: true });
  }
}

async function isolated<T>(fn: (cwd: string) => Promise<T> | T): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'construct-first-run-ground-'));
  const previous = { data: process.env.XDG_DATA_HOME, state: process.env.XDG_STATE_HOME };
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_STATE_HOME = join(root, 'state');
  try {
    return await fn(root);
  } finally {
    if (previous.data === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous.data;
    if (previous.state === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previous.state;
    rmSync(root, { recursive: true, force: true });
  }
}

async function recordOnServe(
  words: string,
  namings: Array<{ domain: string; why: string }> | undefined,
  at: string,
  opts: { cwd?: string; declareGround?: string } = {},
): Promise<{
  tasksQueued: number;
  implicated: string[];
  inferredBy?: string;
  isError?: boolean;
  out: string;
  run?: string;
  logActions: string[];
}> {
  const store = openStore(storePath(resolvePaths()));
  if (opts.declareGround !== undefined) {
    addSource(store, {
      id: 'src-verity-ground',
      workspace: 'default',
      kind: 'directory',
      locator: opts.declareGround,
      addedAt: at,
    });
  }
  const handle = createProjectionHandler({
    store,
    clock: () => at,
    serverVersion: 'test',
    secret: 'test-secret-not-a-real-key',
    cwd: opts.cwd,
    workspace: 'default',
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
      tasksQueued: 0,
      implicated: [],
      out: result.content[0]?.text ?? '',
      isError: true,
      logActions: [],
    };
  }
  const body = JSON.parse(result.content[0]!.text) as {
    run: string;
    tasksQueued: number;
    implicated: Array<{ domain: string }>;
    inferredBy?: string;
  };
  const log = readWorkLog(store, body.run);
  store.close();
  return {
    tasksQueued: body.tasksQueued,
    implicated: body.implicated.map((row) => row.domain),
    inferredBy: body.inferredBy,
    out: JSON.stringify(body),
    run: body.run,
    logActions: log.map((entry) => entry.action),
  };
}

test('omitting namings on serve is not an error and creates a run', async () => {
  await isolated(async () => {
    const recorded = await recordOnServe(POLAND, undefined, '2026-08-28T15:00:00.000Z');
    assert.equal(recorded.isError, undefined);
    assert.ok(recorded.run, 'talk must create a run');
    assert.ok(recorded.logActions.includes('outcome-received'), 'log must not be empty');
    assert.notEqual(recorded.inferredBy, 'keywords');
    assert.doesNotMatch(recorded.out, /requires namings/);
  });
});

test('an empty namings array is not an error; ground may still add seats', async () => {
  await isolated(async () => {
    const recorded = await recordOnServe(POLAND, [], '2026-08-28T15:01:00.000Z');
    assert.equal(recorded.isError, undefined);
    assert.ok(recorded.logActions.includes('outcome-received'));
    assert.notEqual(recorded.inferredBy, 'keywords');
  });
});

test('an artifact-only seat appears without the host naming it', async () => {
  await isolated(async (cwd) => {
    const docs = join(cwd, 'docs', 'privacy');
    mkdirSync(docs, { recursive: true });
    writeFileSync(join(docs, 'notice.md'), '# Privacy\n\nPersonal data on this project.\n');
    const recorded = await recordOnServe(
      'look at this',
      undefined,
      '2026-08-28T15:02:00.000Z',
      { cwd },
    );
    assert.equal(recorded.isError, undefined);
    assert.ok(recorded.implicated.includes('privacy'), `artifact seat missing: ${recorded.implicated.join(',')}`);
    assert.equal(recorded.inferredBy, 'ground');
    assert.notEqual(recorded.inferredBy, 'keywords');
    assert.ok(recorded.tasksQueued > 0, 'empty staff after a visible privacy artifact');
  });
});

test('Verity Case 1: Poland talk plus contracts/privacy ground is not employment-only', async () => {
  await isolated(async () => {
    const keywordOnly = mapImplications({ outcome: POLAND }).implicated.map((row) => row.domain);
    assert.deepEqual(keywordOnly, ['employment'], 'the keyword map still misses the dark corners');

    const recorded = await recordOnServe(POLAND, undefined, '2026-08-28T15:03:00.000Z', {
      declareGround: VERITY_GROUND,
    });
    assert.equal(recorded.isError, undefined);
    assert.ok(recorded.logActions.includes('outcome-received'), 'talk-plus-empty-log is a miss');
    assert.ok(recorded.implicated.includes('contracts'), `missing contracts: ${recorded.implicated.join(',')}`);
    assert.ok(recorded.implicated.includes('privacy'), `missing privacy: ${recorded.implicated.join(',')}`);
    assert.notDeepEqual(recorded.implicated, ['employment'], 'keyword-map-only result is a fail');
    assert.notEqual(recorded.inferredBy, 'keywords');
    assert.equal(recorded.inferredBy, 'ground');
  });
});

test('host-named employment still gains the unnamed contracts and privacy seats', async () => {
  await isolated(async () => {
    const recorded = await recordOnServe(
      POLAND,
      [{ domain: 'employment', why: 'the host named hiring after reading the words' }],
      '2026-08-28T15:04:00.000Z',
      { declareGround: VERITY_GROUND },
    );
    assert.equal(recorded.isError, undefined);
    assert.ok(recorded.implicated.includes('employment'));
    assert.ok(recorded.implicated.includes('contracts'));
    assert.ok(recorded.implicated.includes('privacy'));
    assert.equal(recorded.inferredBy, 'session');
  });
});

test('doctor on a hostless box does not send first-run to construct outcome', async () => {
  const out = await captureDoctor({});
  assert.match(out, /talk in a host you already have/i);
  assert.doesNotMatch(out, /construct outcome/);
  assert.doesNotMatch(out, /Record your first outcome/);
});

test('first-run docs no longer lock host-namer-only or omitted-namings-as-error', () => {
  const page = readFileSync(join(ROOT, 'docs/first-run.md'), 'utf8');
  assert.doesNotMatch(page, /does not classify intent/);
  assert.doesNotMatch(page, /omitting namings is an error/);
  assert.doesNotMatch(page, /empty namings array is a real answer that this implicates nothing/i);
  assert.doesNotMatch(page, /construct outcome/);
  assert.match(page, /visible ground|add seats/i);
});
