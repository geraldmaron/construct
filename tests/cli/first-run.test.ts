/**
 * tests/cli/first-run.test.ts — cheap first-run checks that stay on ordinary CI.
 *
 * Locks the mechanism, not a phrase table. Published first-run is talk,
 * a run exists, and a seat nobody named can show up from the ground —
 * and the page must not claim the binary already does that. Keyword map
 * is not first-run. Empty staff after a host read is a fail. First
 * output is not doctor or a verb wall. The first-run page does not
 * teach a CLI verb, a catalog concern name, or a host tool name as
 * the thing the user types.
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
): Promise<{
  tasksQueued: number;
  implicated: string[];
  inferredBy?: string;
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
  };
  store.close();
  return {
    tasksQueued: body.tasksQueued,
    implicated: body.implicated.map((row) => row.domain),
    inferredBy: body.inferredBy,
    out: JSON.stringify(body),
  };
}

test('first-run lead is talk, a run, and an unnamed seat — not host-namer success', () => {
  const page = readFileSync(join(ROOT, 'docs/first-run.md'), 'utf8');
  const lead = firstHeadingLead(page);
  assert.match(lead, /Talk in the host you already have/);
  assert.match(lead, /A run exists/);
  assert.match(lead, /seat you did not\s+name/);
  assert.match(lead, /from the ground/);
  assert.match(lead, /does not meet that bar/);
  assert.match(lead, /old first-run rule/);
  assert.match(lead, /not the product/);
  assert.doesNotMatch(lead, /You talk\. Staff shows up/);
  assert.doesNotMatch(lead, /Staff shows up/);
  assert.match(lead, /Two surfaces only/);
  assert.match(lead, /record_outcome/);
  assert.doesNotMatch(page, /claim_task/);
  assert.doesNotMatch(page, /submit_work/);
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
  assert.match(page, /What happened/);
  assert.match(page, /What you decide/);
  assert.match(page, /One action/);
  assert.match(page, /host relays/);
  assert.doesNotMatch(page, /Resolve with:\s*construct decide/);
  assert.doesNotMatch(page, /construct decide/);
  assert.doesNotMatch(page, /evidence-provenance/);
  assert.doesNotMatch(page, /coverage-gaps/);
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
  assert.doesNotMatch(serve, /claim_task/);
  assert.doesNotMatch(serve, /submit_work/);
});

test('README short version opens with serve, not a phrase table or verb wall', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const from = readme.indexOf('docs/first-run.md');
  const until = readme.indexOf('## Which seat');
  assert.ok(from >= 0 && until > from);
  const short = readme.slice(from, until);
  assert.match(short, /a run exists/);
  assert.match(short, /seat you did not name/);
  assert.match(short, /from the\s+ground/);
  assert.match(short, /does not meet that bar/);
  assert.match(short, /old first-run rule/);
  assert.match(short, /not the product/);
  assert.doesNotMatch(short, /Staff shows up/);
  assert.match(short, /Two surfaces only/);
  assert.match(short, /host relays/);
  assert.doesNotMatch(short, /claim_task/);
  assert.doesNotMatch(short, /submit_work/);
  assert.doesNotMatch(short, /construct decide/);
  assert.doesNotMatch(short, /verdict, or log/);
  assert.match(short, /They are not beat two/);
  assertNoPhraseTable(short, 'README short version');
  const fence = firstShellFence(short);
  assert.match(fence, /construct serve/);
  assert.doesNotMatch(fence, /construct init/);
  assert.doesNotMatch(fence, /construct doctor/);
  assert.doesNotMatch(short, /construct outcome/, 'keyword-map outcome is not on the first-run door');
});

test('user-facing first-run copy does not say staff already shows up', () => {
  for (const rel of [
    'docs/first-run.md',
    'docs/README.md',
    'docs/consumer-install.md',
    'README.md',
    'skills/README.md',
    'skills/first-run/SKILL.md',
  ]) {
    const body = readFileSync(join(ROOT, rel), 'utf8');
    assert.doesNotMatch(body, /You talk\. Staff shows up/, `${rel} still opens with staff-shows-up`);
    assert.doesNotMatch(body, /Staff shows up\./, `${rel} still says staff shows up`);
    assert.doesNotMatch(body, /This session names and records\. Staff shows up/, `${rel} still sells host-namer success`);
    assert.doesNotMatch(body, /talk, then staff/, `${rel} still teaches talk-then-staff as first-run`);
    assert.doesNotMatch(body, /namings optional/i, `${rel} still sells namings-optional as the inferrer`);
  }
});

test('tarball first-run skill keeps the contract and the honesty line', () => {
  const skill = readFileSync(join(ROOT, 'skills/first-run/SKILL.md'), 'utf8');
  assert.match(skill, /a run exists/i);
  assert.match(skill, /seat they did not name|seat you did not name/i);
  assert.match(skill, /does not meet that bar/);
  assert.match(skill, /empty work log|empty log/);
  assert.match(skill, /record_outcome/);
  assert.match(skill, /omitting namings is still an error|still requires namings|omitting namings is still an error/);
  assert.match(skill, /This box has no host session/);
  assert.match(skill, /What happened|what happened/);
  assert.match(skill, /host relays/);
  assert.doesNotMatch(skill, /construct decide/);
  assert.doesNotMatch(skill, /evidence-provenance/);
  assert.doesNotMatch(skill, /coverage-gaps/);
  assert.doesNotMatch(skill, /claim_task/);
  assert.doesNotMatch(skill, /submit_work/);
  assert.doesNotMatch(skill, /You talk\. This session names/);
});

test('README first-run names the hostless box without construct outcome', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const from = readme.indexOf('docs/first-run.md');
  const until = readme.indexOf('## Which seat');
  const short = readme.slice(from, until);
  assert.match(short, /This box has no host session/);
  assert.match(short, /First-run is talk in a host you already have/);
  assert.doesNotMatch(short, /construct outcome/);
});

test('walkthrough Poland sample is not the stale two-domain capture', () => {
  const page = readFileSync(join(ROOT, 'docs/cli-walkthrough.md'), 'utf8');
  assert.doesNotMatch(page, /run-20260805134446726/);
  assert.doesNotMatch(page, /implicated domains \(2\):/);
  assert.doesNotMatch(page, /queued 2 task\(s\)/);
  assert.doesNotMatch(page, /plan plan-run-\S+: 2 steps/);
  assert.match(page, /implicated domains \(1\):/);
  assert.match(page, /queued 1 task\(s\)/);
});

test('published install fences name the alpha tag', () => {
  for (const rel of ['README.md', 'docs/cli-walkthrough.md', 'docs/first-run.md', 'skills/README.md']) {
    const body = readFileSync(join(ROOT, rel), 'utf8');
    for (const fence of body.matchAll(/```(?:bash|sh|shell|zsh)?\n([\s\S]*?)```/g)) {
      for (const line of fence[1]!.split('\n')) {
        const install = line.match(/npm i(?:nstall)?(?:\s+-g)?\s+@geraldmaron\/construct(\S*)/);
        if (!install) continue;
        assert.match(install[1] ?? '', /^@alpha/, `${rel} install fence omits @alpha: ${line}`);
      }
    }
  }
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
    assert.equal(recorded.inferredBy, 'session', 'host-supplied namings are this session, not Construct\'s namer');
    assert.notEqual(recorded.inferredBy, 'namer');
    assert.notEqual(recorded.inferredBy, 'keywords');
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
