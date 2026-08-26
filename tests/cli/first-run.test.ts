/**
 * tests/cli/first-run.test.ts — cheap first-run checks that stay on ordinary CI.
 *
 * Talk, then staff shows up. These run under `npm test` (the CI `test` job),
 * not as a lint-only extra. A first path that is doctor, status, or a verb
 * wall fails here. A page that says construct serve cannot dispatch fails
 * here. In-session Cursor work does not spawn cursor-agent.
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

async function sessionRecord(
  outcomeText: string,
  namings: Array<{ domain: string; why: string }>,
  at: string,
): Promise<{ tasksQueued: number; implicated: string[]; out: string }> {
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
      arguments: { outcome: outcomeText, namings },
    },
  });
  const body = JSON.parse(
    ((named?.result as { content: Array<{ text: string }> }).content[0] as { text: string }).text,
  ) as { tasksQueued: number; implicated: Array<{ domain: string }> };
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
  assert.match(lead, /ordinary language/);
  assert.match(lead, /record_outcome/);
  assert.match(lead, /claim_task/);
  assert.match(lead, /submit_work/);
  assert.match(lead, /They are not beat two/);
  assert.doesNotMatch(lead, /construct init/);
  assert.doesNotMatch(lead, /construct doctor/);
  const fence = firstShellFence(lead);
  assert.match(fence, /construct serve/);
  assert.doesNotMatch(fence, /construct init/);
  assert.doesNotMatch(fence, /construct doctor/);
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

test('README short version opens with serve, not init or the verb table', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const from = readme.indexOf('docs/first-run.md');
  const until = readme.indexOf('## Which seat');
  assert.ok(from >= 0 && until > from);
  const short = readme.slice(from, until);
  assert.match(short, /Staff shows up/);
  assert.match(short, /They are not beat two/);
  const fence = firstShellFence(short);
  assert.match(fence, /construct serve/);
  assert.doesNotMatch(fence, /construct init/);
  assert.doesNotMatch(fence, /construct doctor/);
});

test('is this ready staffs product through this session', async () => {
  await isolated(async () => {
    const recorded = await sessionRecord(
      'is this ready',
      [{ domain: 'product-scoping', why: 'readiness is a scope and success-signal question' }],
      '2026-08-26T13:00:00.000Z',
    );
    assert.equal(recorded.tasksQueued, 1);
    assert.deepEqual(recorded.implicated, ['product-scoping']);
    assertNotDoctorStatusVerbWall(recorded.out, 'record_outcome');

    const { result, out } = await capture(() => work([], undefined, undefined, CURSOR_ENV));
    assert.equal(result, 0);
    assertNotDoctorStatusVerbWall(out, 'work after is-this-ready');
    assert.match(out, /In-session dispatch through cursor/);
    assert.match(out, /will not spawn a second cursor CLI/);
    assert.match(out, /claim_task/);
    assert.match(out, /submit_work/);
    assert.match(out, /product-scoping/);
    assert.doesNotMatch(out, /cursor-agent/);
  });
});

test('do the claims match staffs provenance and coverage through this session', async () => {
  await isolated(async () => {
    const recorded = await sessionRecord(
      'do the claims match',
      [
        {
          domain: 'evidence-provenance',
          why: 'matching claims is a question of where each claim comes from and whether it can be checked',
        },
        {
          domain: 'coverage-gaps',
          why: 'whether the claims cover the ground, or leave a hole, is a coverage question',
        },
      ],
      '2026-08-26T13:01:00.000Z',
    );
    assert.equal(recorded.tasksQueued, 2);
    assert.deepEqual(recorded.implicated, ['evidence-provenance', 'coverage-gaps']);

    const { result, out } = await capture(() => work([], undefined, undefined, CURSOR_ENV));
    assert.equal(result, 0);
    assert.match(out, /evidence-provenance/);
    assert.match(out, /coverage-gaps/);
    assert.match(out, /claim_task/);
    assert.doesNotMatch(out, /cursor-agent/);
  });
});

test('product shape staffs system-design, not program-sequencing from ship', () => {
  const mapped = mapImplications({ outcome: 'what is the product shape' });
  const domains = mapped.implicated.map((row) => row.domain);
  assert.ok(domains.includes('system-design'), `expected system-design, got ${domains.join(',')}`);
  assert.ok(!domains.includes('program-sequencing'), 'ship must not pull sequencing from product shape');
});

test('product shape through this session staffs system-design', async () => {
  await isolated(async () => {
    const recorded = await sessionRecord(
      'what is the product shape',
      [
        {
          domain: 'system-design',
          why: 'the shape of the product is a boundaries and coupling question',
        },
      ],
      '2026-08-26T13:02:00.000Z',
    );
    assert.deepEqual(recorded.implicated, ['system-design']);
    const { result, out } = await capture(() => work([], undefined, undefined, CURSOR_ENV));
    assert.equal(result, 0);
    assert.match(out, /system-design/);
    assert.doesNotMatch(out, /program-sequencing/);
  });
});

test('an in-session outcome first prints the naming packet, not doctor or verbs', async () => {
  await isolated(async () => {
    const { result, out } = await capture(() => outcome(['is this ready'], undefined, CURSOR_ENV));
    assert.equal(result, 0);
    assertNotDoctorStatusVerbWall(out, 'in-session outcome');
    assert.match(out, /This session is the namer/);
    assert.match(out, /record_outcome/);
    assert.doesNotMatch(out, /implicated domains/);
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

test('work finds the outcome this session just recorded', async () => {
  await isolated(async () => {
    await sessionRecord(
      'is this ready',
      [{ domain: 'product-scoping', why: 'readiness is a scope and success-signal question' }],
      '2026-08-26T13:03:00.000Z',
    );
    const { result, out } = await capture(() => work([], undefined, undefined, CURSOR_ENV));
    assert.equal(result, 0);
    assert.match(out, /product-scoping/);
    assert.doesNotMatch(out, /Record an outcome first/i);
  });
});

test('in-session Cursor work does not spawn cursor-agent', async () => {
  await isolated(async () => {
    await sessionRecord(
      'is this ready',
      [{ domain: 'product-scoping', why: 'readiness is a scope and success-signal question' }],
      '2026-08-26T13:04:00.000Z',
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
    await assert.rejects(() => adapter.invoke({ role: 'product-scoping', task: 'look' }), /second runtime|construct serve/);
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
