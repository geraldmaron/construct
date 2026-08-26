/**
 * tests/cli/first-run.test.ts — cheap first-run checks that stay on ordinary CI.
 *
 * Locks the mechanism, not a phrase table. The host names concerns or we
 * say we need the host. Keyword map is not first-run. Empty staff after a
 * host read is a fail. First output is not doctor or a verb wall.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ask, outcome, work } from '../../src/cli/index.ts';
import { createCursorAdapter } from '../../src/hosts/cursor/adapter.ts';
import { HOST_PULL_TOOLS } from '../../src/hosts/mcp/hostpull.ts';
import { createProjectionHandler } from '../../src/hosts/mcp/projection.ts';
import { mapImplications } from '../../src/kernel/implication/map.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { listTasks } from '../../src/kernel/store/tasks.ts';
import { sterileAmbientEnv, sterileHome } from '../harness/sterile.ts';

sterileHome();
sterileAmbientEnv();

const CURSOR_ENV = { CURSOR_AGENT: '1' };
const ROOT = join(import.meta.dirname, '..', '..');

const NODE_WARNING =
  '(node:1) ExperimentalWarning: SQLite is an experimental feature. ' +
  'Please provide feedback at https://github.com/nodejs/node/issues';
const ENGINEER_ASK = 'why does this TypeScript file fail typecheck';

async function capture<T>(fn: () => T | Promise<T>): Promise<{ result: T; out: string; err: string }> {
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  let out = '';
  let err = '';
  process.stdout.write = ((chunk: string) => {
    out += chunk;
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => {
    err += chunk;
    return true;
  }) as typeof process.stderr.write;
  try {
    return { result: await fn(), out, err };
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
}

async function isolated<T>(fn: () => Promise<T> | T): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'construct-first-run-'));
  const previous = { data: process.env.XDG_DATA_HOME, state: process.env.XDG_STATE_HOME };
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_STATE_HOME = join(root, 'state');
  try {
    return await fn();
  } finally {
    if (previous.data === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous.data;
    if (previous.state === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previous.state;
    rmSync(root, { recursive: true, force: true });
  }
}

function firstHeadingLead(markdown: string): string {
  const start = markdown.indexOf('\n## ');
  assert.ok(start > 0, 'expected a heading after the lead');
  return markdown.slice(0, start);
}

function firstShellFence(markdown: string): string {
  const match = markdown.match(/```(?:bash|sh|shell|zsh)?\n([\s\S]*?)```/);
  assert.ok(match?.[1], 'expected a shell fence');
  return match[1];
}

function assertNotDoctorStatusVerbWall(text: string, label: string): void {
  const head = text.slice(0, 500);
  assert.doesNotMatch(head, /\bconstruct doctor\b/, `${label} must not open with doctor`);
  assert.doesNotMatch(head, /\bconstruct status\b/, `${label} must not open with status`);
  assert.doesNotMatch(head, /Starting work \|/, `${label} must not open with the verb catalog`);
  assert.doesNotMatch(head, /Those six are the spine/, `${label} must not open with the verb wall`);
}

function assertNoPhraseTable(body: string, label: string): void {
  assert.doesNotMatch(body, /is this ready/i, `${label} still encodes a sacred first-run phrase`);
  assert.doesNotMatch(body, /do the claims match/i, `${label} still encodes a sacred first-run phrase`);
  assert.doesNotMatch(body, /product shape/i, `${label} still encodes a sacred first-run phrase`);
}

async function hostNamedRecord(
  words: string,
  namings: Array<{ domain: string; why: string }> | undefined,
  at: string,
): Promise<{ tasksQueued: number; implicated: string[]; out: string; isError?: boolean }> {
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
    return { tasksQueued: 0, implicated: [], out: result.content[0]?.text ?? '', isError: true };
  }
  const body = JSON.parse(result.content[0]!.text) as {
    tasksQueued: number;
    implicated: Array<{ domain: string }>;
  };
  store.close();
  return {
    tasksQueued: body.tasksQueued,
    implicated: body.implicated.map((row) => row.domain),
    out: JSON.stringify(body),
  };
}

test('first-run lead is talk then staff, not init plus doctor', () => {
  const page = readFileSync(join(ROOT, 'docs/first-run.md'), 'utf8');
  const lead = firstHeadingLead(page);
  assert.match(lead, /You talk\. Staff shows up/);
  assert.match(lead, /ordinary\s+language/);
  assert.match(lead, /The host infers/);
  assert.match(lead, /does not classify intent/);
  assert.match(lead, /Two surfaces only/);
  assert.match(lead, /record_outcome/);
  assert.match(lead, /claim_task/);
  assert.match(lead, /submit_work/);
  assert.doesNotMatch(page, /verdict, or log/);
  assert.doesNotMatch(page, /host decides the path/);
  assert.match(lead, /investigative-research/);
  assert.match(lead, /decision-framing/);
  assert.match(lead, /intake/);
  assert.doesNotMatch(page, /construct init/);
  assert.doesNotMatch(page, /construct doctor/);
  assert.doesNotMatch(page, /Starting work/);
  assertNoPhraseTable(page, 'docs/first-run.md');
  const fence = firstShellFence(lead);
  assert.match(fence, /construct serve/);
  assert.doesNotMatch(fence, /construct init/);
  assert.doesNotMatch(fence, /construct doctor/);
});

test('first-run inbox is the only Construct-shaped surface', () => {
  const page = readFileSync(join(ROOT, 'docs/first-run.md'), 'utf8');
  assert.match(page, /only Construct-shaped surface is an inbox card/);
  assert.match(page, /construct decide/);
  assert.doesNotMatch(page, /verdict, or log/);
  assert.doesNotMatch(page, /construct outcome/);
  assert.doesNotMatch(page, /construct work/);
  assert.doesNotMatch(page, /construct status/);
});

test('user-facing docs do not claim construct serve cannot dispatch', () => {
  for (const rel of ['docs/first-run.md', 'docs/consumer-install.md', 'README.md']) {
    const body = readFileSync(join(ROOT, rel), 'utf8');
    assert.doesNotMatch(body, /can(?:no)?'?t dispatch/i, `${rel} still says serve cannot dispatch`);
    assert.doesNotMatch(body, /surface cannot\s+dispatch/i, `${rel} still says the surface cannot dispatch`);
  }
  const serve = readFileSync(join(ROOT, 'docs/first-run.md'), 'utf8');
  assert.match(serve, /The surface can dispatch work/);
  assert.match(serve, /claim_task/);
  assert.match(serve, /submit_work/);
});

test('README short version opens with serve, not a phrase table or verb wall', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const from = readme.indexOf('docs/first-run.md');
  const until = readme.indexOf('## Which seat');
  assert.ok(from >= 0 && until > from);
  const short = readme.slice(from, until);
  assert.match(short, /Staff shows up/);
  assert.match(short, /The host infers/);
  assert.match(short, /Two surfaces only/);
  assert.doesNotMatch(short, /verdict, or log/);
  assert.match(short, /They are not beat two/);
  assertNoPhraseTable(short, 'README short version');
  const fence = firstShellFence(short);
  assert.match(fence, /construct serve/);
  assert.doesNotMatch(fence, /construct init/);
  assert.doesNotMatch(fence, /construct doctor/);
});

test('a host naming staffs those domains; empty staff after that read is a fail', async () => {
  await isolated(async () => {
    const recorded = await hostNamedRecord(
      'look at this',
      [
        { domain: 'privacy', why: 'the host named privacy after reading the words' },
        { domain: 'security', why: 'the host named security after reading the words' },
      ],
      '2026-08-26T14:00:00.000Z',
    );
    assert.equal(recorded.isError, undefined);
    assert.ok(recorded.tasksQueued > 0, 'empty staff after a host read');
    assert.deepEqual(recorded.implicated, ['privacy', 'security']);
    assertNotDoctorStatusVerbWall(recorded.out, 'record_outcome');

    const { result, out } = await capture(() => work([], undefined, undefined, CURSOR_ENV));
    assert.equal(result, 0);
    assertNotDoctorStatusVerbWall(out, 'work after host naming');
    assert.match(out, /In-session dispatch through cursor/);
    assert.match(out, /will not spawn a second cursor CLI/);
    assert.match(out, /claim_task/);
    assert.match(out, /submit_work/);
    assert.match(out, /privacy/);
    assert.match(out, /security/);
    assert.doesNotMatch(out, /cursor-agent/);
    assert.doesNotMatch(out, /Record an outcome first/i);
  });
});

test('omitting namings on serve is need-the-host, not keyword staff', async () => {
  await isolated(async () => {
    const recorded = await hostNamedRecord('look at this', undefined, '2026-08-26T14:01:00.000Z');
    assert.equal(recorded.isError, true);
    assert.match(recorded.out, /requires namings|keyword map is not first-run/);
    const store = openStore(storePath(resolvePaths()));
    try {
      assert.equal(listTasks(store).length, 0);
    } finally {
      store.close();
    }
  });
});

test('in-session words without a host naming do not fake keyword staff', async () => {
  await isolated(async () => {
    const { result, out } = await capture(() => outcome(['look at this'], undefined, CURSOR_ENV));
    assert.equal(result, 0);
    assertNotDoctorStatusVerbWall(out, 'in-session outcome');
    assert.match(out, /This session infers the intent/);
    assert.match(out, /keyword map is not consulted/);
    assert.match(out, /this session dispatches/);
    assert.match(out, /inbox/);
    assert.doesNotMatch(out, /record_outcome/);
    assert.doesNotMatch(out, /\bnamer\b/i);
    assert.doesNotMatch(out, /implicated domains/);
    const store = openStore(storePath(resolvePaths()));
    try {
      assert.equal(listTasks(store).length, 0);
    } finally {
      store.close();
    }
  });
});

test('Node ExperimentalWarning does not staff measurement', () => {
  const mapped = mapImplications({ outcome: NODE_WARNING });
  const domains = mapped.implicated.map((row) => row.domain);
  assert.ok(!domains.includes('measurement'), `warning staffed ${domains.join(',')}`);
});

test('engineer ask does not staff measurement from ExperimentalWarning', async () => {
  await isolated(async () => {
    const leaked = `${ENGINEER_ASK}\n${NODE_WARNING}`;
    for (const question of [ENGINEER_ASK, leaked]) {
      const { result, out } = await capture(() => ask([question]));
      assert.equal(result, 0);
      assert.doesNotMatch(out, /measurement/);
      const store = openStore(storePath(resolvePaths()));
      try {
        assert.ok(
          listTasks(store).every((task) => task.role !== 'measurement'),
          `ask staffed measurement from ${JSON.stringify(question)}`,
        );
      } finally {
        store.close();
      }
    }
  });
});

test('work finds the run the host just named', async () => {
  await isolated(async () => {
    await hostNamedRecord(
      'look at this',
      [{ domain: 'privacy', why: 'the host named privacy after reading the words' }],
      '2026-08-26T14:02:00.000Z',
    );
    const { result, out } = await capture(() => work([], undefined, undefined, CURSOR_ENV));
    assert.equal(result, 0);
    assert.match(out, /privacy/);
    assert.doesNotMatch(out, /Record an outcome first/i);
  });
});

test('in-session Cursor work does not spawn cursor-agent', async () => {
  await isolated(async () => {
    await hostNamedRecord(
      'look at this',
      [{ domain: 'privacy', why: 'the host named privacy after reading the words' }],
      '2026-08-26T14:03:00.000Z',
    );
    let spawned = 0;
    const adapter = createCursorAdapter({
      env: CURSOR_ENV,
      spawn: () => {
        spawned += 1;
        throw new Error('must not spawn');
      },
    });
    await adapter.init();
    assert.equal(spawned, 0);
    await assert.rejects(() => adapter.invoke({ role: 'privacy', task: 'look' }), /second runtime|construct serve/);
    assert.equal(spawned, 0);

    const { result, out } = await capture(() => work([], undefined, undefined, CURSOR_ENV));
    assert.equal(result, 0);
    assert.equal(spawned, 0);
    assert.match(out, /will not spawn a second cursor CLI/);
    assert.doesNotMatch(out, /cursor-agent/);
  });
});

test('product serve lists host-pull dispatch tools', () => {
  const names = HOST_PULL_TOOLS.map((tool) => tool.name);
  assert.ok(names.includes('claim_task'));
  assert.ok(names.includes('submit_work'));
});
