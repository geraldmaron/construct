/**
 * tests/cli/first-run.test.ts — cheap first-run checks that stay on ordinary CI.
 *
 * Locks the mechanism, not a phrase table. The host names concerns or we
 * say we need the host. Keyword map is not first-run. Empty staff after a
 * host read is a fail. First output is not doctor or a verb wall.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ask, inbox, main, outcome, work } from '../../src/cli/index.ts';
import { latestOutcomeReceivedRun } from '../../src/kernel/store/worklog.ts';
import { createCursorAdapter } from '../../src/hosts/cursor/adapter.ts';
import { HOST_PULL_TOOLS } from '../../src/hosts/mcp/hostpull.ts';
import { createProjectionHandler } from '../../src/hosts/mcp/projection.ts';
import { mapImplications } from '../../src/kernel/implication/map.ts';
import { lensForDomain } from '../../src/kernel/plan/lenses.ts';
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

function assertSameFirstRunStory(page: string, label: string): void {
  const lead = firstHeadingLead(page);
  assert.match(lead, /You talk\. Staff shows up/);
  assert.match(lead, /ordinary\s+language/);
  assert.match(lead, /The host infers/);
  assert.match(lead, /does\s+not classify intent/);
  assert.match(lead, /Two surfaces only/);
  assert.match(lead, /one button/);
  assert.match(lead, /investigative-research/);
  assert.match(lead, /decision-framing/);
  assert.match(lead, /intake/);
  assert.doesNotMatch(page, /verdict, or log/);
  assert.doesNotMatch(page, /host decides the path/);
  assert.doesNotMatch(page, /construct init/);
  assert.doesNotMatch(page, /construct doctor/);
  assert.doesNotMatch(page, /Starting work/);
  assert.doesNotMatch(page, /construct decide/);
  assert.doesNotMatch(page, /construct serve/);
  assert.doesNotMatch(lead, /```(?:bash|sh|shell|zsh)?/);
  assert.doesNotMatch(lead, /record_outcome/);
  assertNoPhraseTable(page, label);
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
): Promise<{
  tasksQueued: number;
  implicated: string[];
  inferredBy?: string;
  ranIn?: string;
  how?: string;
  where?: string;
  staff?: string[];
  out: string;
  isError?: boolean;
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
    return { tasksQueued: 0, implicated: [], out: result.content[0]?.text ?? '', isError: true };
  }
  const body = JSON.parse(result.content[0]!.text) as {
    tasksQueued: number;
    implicated: Array<{ domain: string }>;
    inferredBy?: string;
    ranIn?: string;
    how?: string;
    where?: string;
    staff?: string[];
  };
  store.close();
  return {
    tasksQueued: body.tasksQueued,
    implicated: body.implicated.map((row) => row.domain),
    inferredBy: body.inferredBy,
    ranIn: body.ranIn,
    how: body.how,
    where: body.where,
    staff: body.staff,
    out: JSON.stringify(body),
  };
}

test('first-run lead is talk then staff, not init plus doctor', () => {
  assertSameFirstRunStory(readFileSync(join(ROOT, 'docs/first-run.md'), 'utf8'), 'docs/first-run.md');
});

test('the shipped /start story matches first-run', () => {
  assertSameFirstRunStory(readFileSync(join(ROOT, 'docs/start.md'), 'utf8'), 'docs/start.md');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { files: string[]; version: string };
  assert.ok(pkg.files.includes('docs/first-run.md'), 'first-run story ships in the package');
  assert.ok(pkg.files.includes('docs/start.md'), '/start story ships in the package');
  assert.notEqual(pkg.version, '3.0.0-alpha.18');
});

test('first-run inbox is the only Construct-shaped surface', () => {
  const page = readFileSync(join(ROOT, 'docs/first-run.md'), 'utf8');
  assert.match(page, /only Construct-shaped surface is an inbox card/);
  assert.match(page, /one button/);
  assert.match(page, /Your call is the button/);
  assert.doesNotMatch(page, /construct decide/);
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

test('README first-run opens with talk, not a phrase table or verb wall', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const from = readme.indexOf('## First run');
  const until = readme.indexOf('## Status');
  assert.ok(from >= 0 && until > from);
  const short = readme.slice(from, until);
  assert.match(short, /Staff shows up/);
  assert.match(short, /The host infers/);
  assert.match(short, /Two surfaces only/);
  assert.match(short, /one button/);
  assert.doesNotMatch(short, /verdict, or log/);
  assert.match(short, /are not beat two/);
  assertNoPhraseTable(short, 'README first-run');
  assert.doesNotMatch(short, /```(?:bash|sh|shell|zsh)?/);
  assert.doesNotMatch(short, /construct serve/);
  assert.doesNotMatch(short, /construct init/);
  assert.doesNotMatch(short, /construct doctor/);
  assert.doesNotMatch(short, /construct decide/);
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
    assert.equal(recorded.inferredBy, 'namer', 'how: a host model named the concerns');
    assert.equal(recorded.ranIn, 'session', 'where: this session ran');
    assert.equal(recorded.how, 'namer');
    assert.equal(recorded.where, 'session');
    assert.notEqual(recorded.how, recorded.where, 'do not alias namer to session');
    assert.notEqual(recorded.inferredBy, 'session');
    assert.notEqual(recorded.inferredBy, 'keywords');
    assert.deepEqual(recorded.staff, ['legal', 'security']);
    assert.ok(!recorded.staff?.includes('engineering'), 'engineering-only staff is a miss');
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

test('host-named catalog domains staff the lenses that equip them', async () => {
  await isolated(async () => {
    const recorded = await hostNamedRecord(
      'look at this',
      [
        { domain: 'security', why: 'who can reach the new credential path' },
        { domain: 'operations', why: 'what happens on each run after it ships' },
        { domain: 'program-sequencing', why: 'the run now depends on a prior step' },
        { domain: 'privacy', why: 'personal data crosses a jurisdiction' },
        { domain: 'compliance', why: 'a regulator-facing placement' },
        { domain: 'product-scoping', why: 'a product surface and who it is for' },
        { domain: 'contracts', why: 'an agreement with another party' },
      ],
      '2026-08-26T15:00:00.000Z',
    );
    assert.equal(recorded.isError, undefined);
    assert.ok(recorded.tasksQueued > 0, 'empty staff after a host read');
    assert.equal(recorded.how, 'namer');
    assert.equal(recorded.where, 'session');
    assert.notEqual(recorded.how, recorded.where);
    const lenses = new Set(
      recorded.implicated
        .map((domain) => lensForDomain(domain)?.lens)
        .filter((lens): lens is string => lens !== undefined),
    );
    for (const need of ['security', 'operations', 'program', 'legal', 'compliance', 'product']) {
      assert.ok(lenses.has(need), `host-named domains must staff ${need}, got ${[...lenses].join(',')}`);
      assert.ok(recorded.staff?.includes(need), `reply staff missing ${need}: ${recorded.staff?.join(',')}`);
    }
    assert.ok(!recorded.staff?.includes('engineering'), 'engineering-only staff is a miss');
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
    assert.match(out, /Talk here\. Staff shows up/);
    assert.match(out, /how: namer/);
    assert.match(out, /where: session/);
    assert.match(out, /one button/);
    assert.match(out, /inbox/);
    assert.doesNotMatch(out, /record_outcome/);
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

test('bare construct is talk, not the verb catalog', async () => {
  await isolated(async () => {
    const { result, out } = await capture(() => main([], CURSOR_ENV));
    assert.equal(result, 0);
    assertNotDoctorStatusVerbWall(out, 'bare construct in-session');
    assert.match(out, /Talk here\. Staff shows up/);
    assert.match(out, /how: namer/);
    assert.match(out, /where: session/);
    assert.doesNotMatch(out, /Starting work/);
    assert.doesNotMatch(out, /Those six are the spine/);
    const store = openStore(storePath(resolvePaths()));
    try {
      assert.equal(listTasks(store).length, 0);
    } finally {
      store.close();
    }
  });
});

test('a host-less bounce creates no hollow run and teaches no --host', async () => {
  await isolated(async () => {
    const { result, out } = await capture(() => main(['is this actually ready']));
    assert.equal(result, 0);
    assertNotDoctorStatusVerbWall(out, 'host-less ordinary sentence');
    assert.match(out, /Talk in the host you already use/);
    assert.match(out, /does not staff a run/);
    assert.doesNotMatch(out, /--host/);
    assert.doesNotMatch(out, /construct serve/);
    assert.doesNotMatch(out, /Starting work/);
    assert.doesNotMatch(out, /run run-/);
    assert.doesNotMatch(out, /implicated domains/);
    const store = openStore(storePath(resolvePaths()));
    try {
      assert.equal(listTasks(store).length, 0);
    } finally {
      store.close();
    }
  });
});

test('host-less outcome with no domains creates no run', async () => {
  await isolated(async () => {
    const { result, out, err } = await capture(() => outcome(['xyzzy plugh frobnicate']));
    assert.equal(result, 0);
    assert.match(out, /does not staff a run/);
    assert.doesNotMatch(out, /--host/);
    assert.doesNotMatch(out, /run run-/);
    assert.doesNotMatch(out, /recorded, not silently dropped/);
    assert.doesNotMatch(err, /shared 'default' workspace/);
    const store = openStore(storePath(resolvePaths()));
    try {
      assert.equal(listTasks(store).length, 0);
      assert.equal(latestOutcomeReceivedRun(store), undefined);
    } finally {
      store.close();
    }

    const after = await capture(() => work([]));
    assert.equal(after.result, 0);
    assert.match(after.out, /Record an outcome first/);
    assert.doesNotMatch(after.out, /is on record but has no named work/);
    assert.doesNotMatch(after.out, /--host/);
  });
});

test('a host-less bounce does not steal work from a prior run', async () => {
  await isolated(async () => {
    const staffed = await capture(() => outcome(['We want to hire a contractor in Poland']));
    assert.equal(staffed.result, 0);
    assert.match(staffed.out, /run run-/);
    const store = openStore(storePath(resolvePaths()));
    let prior: string | undefined;
    try {
      prior = latestOutcomeReceivedRun(store);
      assert.ok(prior);
      assert.ok(listTasks(store).length > 0);
    } finally {
      store.close();
    }

    const bounced = await capture(() => outcome(['xyzzy plugh frobnicate']));
    assert.equal(bounced.result, 0);
    assert.match(bounced.out, /does not staff a run/);
    assert.doesNotMatch(bounced.err, /shared 'default' workspace/);

    const after = openStore(storePath(resolvePaths()));
    try {
      assert.equal(latestOutcomeReceivedRun(after), prior);
    } finally {
      after.close();
    }

    const { result, out } = await capture(() => work([], undefined, undefined, CURSOR_ENV));
    assert.equal(result, 0);
    assert.doesNotMatch(out, /is on record but has no named work/);
    assert.match(out, new RegExp(prior!));
  });
});

test('in-session talk plants method skills or says they did not', async () => {
  await isolated(async () => {
    const home = mkdtempSync(join(tmpdir(), 'construct-talk-home-'));
    const previous = process.env.HOME;
    process.env.HOME = home;
    try {
      const { result, out } = await capture(() => main([], { ...CURSOR_ENV, HOME: home }));
      assert.equal(result, 0);
      const planted = existsSync(join(home, '.cursor', 'skills', 'investigative-research', 'SKILL.md'));
      if (planted) {
        assert.match(out, /Method skills (planted|already)/);
        assert.equal(existsSync(join(home, '.cursor', 'skills', 'construct-analyst', 'SKILL.md')), false);
      } else {
        assert.match(out, /Method skills (did not plant|were not planted)/);
      }
    } finally {
      if (previous === undefined) delete process.env.HOME;
      else process.env.HOME = previous;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

test('inbox records the call as one action', async () => {
  await isolated(async () => {
    const { createProjectionHandler } = await import('../../src/hosts/mcp/projection.ts');
    const { raiseDecision, getDecision } = await import('../../src/kernel/store/decisions.ts');
    const store = openStore(storePath(resolvePaths()));
    raiseDecision(store, {
      id: 'run-x:stance',
      run: 'run-x',
      question: 'ship now or wait?',
      positions: [
        { role: 'strategy-alignment', stance: 'ship now', citation: 'task:t-1#L1' },
        { role: 'compliance', stance: 'wait', citation: 'task:t-2#L1' },
      ],
      raisedAt: '2026-08-26T14:10:00.000Z',
    });
    const handle = createProjectionHandler({
      store,
      clock: () => '2026-08-26T14:10:01.000Z',
      serverVersion: 'test',
    });
    const named = await handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'inbox', arguments: { id: 'run-x:stance', resolution: 'wait' } },
    });
    const result = named?.result as { content: Array<{ text: string }> };
    assert.match(result.content[0]!.text, /"decided":"run-x:stance"/);
    assert.equal(getDecision(store, 'run-x:stance')?.resolution, 'wait');
    store.close();

    const { result: listed, out } = await capture(() => inbox([]));
    assert.equal(listed, 0);
    assert.doesNotMatch(out, /construct decide/);
  });
});
