/**
 * tests/cli/first-run.test.ts — cheap first-run checks that stay on ordinary CI.
 *
 * Locks the mechanism, not a phrase table. Published first-run is
 * `construct init`, then talk in the host — session-bound MCP and the
 * operational skill. Keyword map is not first-run. Empty staff after a
 * named domain is a fail. First output is not doctor or a verb wall.
 *
 * Product path: construct init, then interactive MCP (next_work / submit_work).
 * claim_task and construct wire are not the product door.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ask, outcome, work } from '../../src/cli/index.ts';
import { createCursorAdapter } from '../../src/hosts/cursor/adapter.ts';
import {
  createInteractiveHandler,
  INTERACTIVE_TOOLS,
  sessionFromBinding,
} from '../../src/hosts/mcp/interactive.ts';
import type { JsonRpcRequest } from '../../src/hosts/mcp/jsonrpc.ts';
import { initializeProject } from '../../src/kernel/project/initialize.ts';
import { resolveProjectContext } from '../../src/kernel/project/context.ts';
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

/** Staff via named domains on the home-store path (no MCP projection). */
async function staffViaDomains(
  words: string,
  domains: string[],
): Promise<{ tasksQueued: number; implicated: string[]; out: string }> {
  const { result, out } = await capture(() =>
    outcome([`--domains=${domains.join(',')}`, words], undefined, {}),
  );
  assert.equal(result, 0);
  const store = openStore(storePath(resolvePaths()));
  try {
    const tasks = listTasks(store);
    return {
      tasksQueued: tasks.length,
      implicated: [...new Set(tasks.map((t) => t.role))],
      out,
    };
  } finally {
    store.close();
  }
}

test('first-run lead is init then talk — not bare serve or a verb wall', () => {
  const page = readFileSync(join(ROOT, 'docs/first-run.md'), 'utf8');
  const lead = firstHeadingLead(page);
  assert.match(lead, /Talk in the host you already have/);
  assert.match(lead, /construct init/);
  assert.match(lead, /A run starts/);
  assert.match(lead, /Two surfaces only/);
  assert.match(lead, /next_work/);
  assert.match(lead, /submit_work/);
  assert.match(lead, /start_run/);
  assert.doesNotMatch(lead, /You talk\. Staff shows up/);
  assert.doesNotMatch(lead, /Staff shows up/);
  assert.doesNotMatch(lead, /\bclaim_task\b/);
  assert.doesNotMatch(page, /verdict, or log/);
  assert.doesNotMatch(page, /host decides the path/);
  assert.match(lead, /investigative-research/);
  assert.match(lead, /decision-framing/);
  assert.match(lead, /intake/);
  assert.doesNotMatch(page, /\bconstruct wire\b/);
  assert.doesNotMatch(page, /construct doctor/);
  assert.doesNotMatch(page, /Starting work/);
  assert.doesNotMatch(page, /record_outcome/);
  assertNoPhraseTable(page, 'docs/first-run.md');
  const fence = firstShellFence(lead);
  assert.match(fence, /construct init/);
  assert.doesNotMatch(fence, /construct serve/);
  assert.doesNotMatch(fence, /construct doctor/);
  assert.doesNotMatch(fence, /\bconstruct wire\b/);
  // Manual serve may appear as Bob/Codex fallback prose, not the product door.
  assert.match(page, /fallback/);
});

test('first-run inbox is the only Construct-shaped surface', () => {
  const page = readFileSync(join(ROOT, 'docs/first-run.md'), 'utf8');
  assert.match(page, /only Construct-shaped surface is an inbox card/);
  assert.match(page, /construct inbox decide/);
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
  assert.match(serve, /next_work/);
  assert.match(serve, /submit_work/);
  assert.doesNotMatch(serve, /\bclaim_task\b/);
});

test('README short version opens with init, not bare serve or a verb wall', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const from = readme.indexOf('docs/first-run.md');
  const until = readme.indexOf('## Which seat');
  assert.ok(from >= 0 && until > from);
  const short = readme.slice(from, until);
  assert.match(short, /construct init/);
  assert.match(short, /Two surfaces only/);
  assert.match(short, /next_work/);
  assert.match(short, /submit_work/);
  assert.match(short, /start_run/);
  assert.doesNotMatch(short, /Staff shows up/);
  assert.doesNotMatch(short, /\bclaim_task\b/);
  assert.doesNotMatch(short, /verdict, or log/);
  assert.match(short, /They are not beat two/);
  assertNoPhraseTable(short, 'README short version');
  const fence = firstShellFence(short);
  assert.match(fence, /construct init/);
  assert.doesNotMatch(fence, /construct serve/);
  assert.doesNotMatch(fence, /construct doctor/);
  assert.doesNotMatch(fence, /\bconstruct wire\b/);
  assert.doesNotMatch(short, /construct outcome/, 'keyword-map outcome is not on the first-run door');
});

test('walkthrough Poland sample is named domains, not keyword fallthrough', () => {
  const page = readFileSync(join(ROOT, 'docs/cli-walkthrough.md'), 'utf8');
  assert.doesNotMatch(page, /run-20260805134446726/);
  assert.doesNotMatch(page, /implicated domains \(2\):/);
  assert.doesNotMatch(page, /queued 2 task\(s\)/);
  assert.doesNotMatch(page, /plan plan-run-\S+: 2 steps/);
  assert.doesNotMatch(page, /signals: contractor/);
  assert.match(page, /implicated domains \(1\):/);
  assert.match(page, /queued 1 task\(s\)/);
  assert.match(page, /reason: named by the user/);
  assert.match(page, /exit 2/);
  assert.match(page, /construct work claim --pin=/);
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

test('named domains staff those roles; empty staff after that naming is a fail', async () => {
  await isolated(async () => {
    const recorded = await staffViaDomains('look at this', ['privacy', 'security']);
    assert.ok(recorded.tasksQueued > 0, 'empty staff after a named domain');
    assert.deepEqual(recorded.implicated.sort(), ['privacy', 'security']);
    assertNotDoctorStatusVerbWall(recorded.out, 'outcome --domains');

    // Home-store ambient work is gone: without init the verb refuses and
    // points at MCP / headless claim on an initialized project.
    const { result, err } = await capture(() => work([], undefined, undefined, CURSOR_ENV));
    assert.equal(result, 1);
    assert.match(err, /requires an initialized project/);
    assert.match(err, /next_work|submit_work|MCP/);
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

test('engineer ask without a host refuses keyword staffing rather than staffing from a warning', async () => {
  await isolated(async () => {
    const leaked = `${ENGINEER_ASK}\n${NODE_WARNING}`;
    for (const question of [ENGINEER_ASK, leaked]) {
      const { result, err } = await capture(() => ask([question]));
      assert.equal(result, 2);
      assert.match(err, /Keyword routing is not a product staffing path/);
      const store = openStore(storePath(resolvePaths()));
      try {
        assert.equal(listTasks(store).length, 0, `ask queued work from ${JSON.stringify(question)}`);
      } finally {
        store.close();
      }
    }
  });
});

test('named-domain outcome queues tasks; work without init still refuses', async () => {
  await isolated(async () => {
    await staffViaDomains('look at this', ['privacy']);
    const store = openStore(storePath(resolvePaths()));
    try {
      assert.ok(listTasks(store).some((task) => task.role === 'privacy'));
    } finally {
      store.close();
    }
    const { result, err } = await capture(() => work([], undefined, undefined, CURSOR_ENV));
    assert.equal(result, 1);
    assert.match(err, /requires an initialized project/);
  });
});

test('in-session Cursor adapter refuses a second runtime; work without init refuses too', async () => {
  await isolated(async () => {
    await staffViaDomains('look at this', ['privacy']);
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

    const { result, err } = await capture(() => work([], undefined, undefined, CURSOR_ENV));
    assert.equal(result, 1);
    assert.equal(spawned, 0);
    assert.match(err, /requires an initialized project/);
  });
});

test('interactive MCP tools include next_work and submit_work, not claim_task', async () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-first-run-mcp-'));
  try {
    const init = initializeProject(resolveProjectContext({ cwd: root, allowCwdFallback: true }));
    const handle = createInteractiveHandler({
      store: init.store,
      projectRoot: root,
      clock: () => '2026-08-31T12:00:00.000Z',
      serverVersion: 'test',
      session: sessionFromBinding({ client: 'cursor', projectRoot: root }),
    });
    const listed = await handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    } as JsonRpcRequest);
    const names = (listed as { result: { tools: Array<{ name: string }> } }).result.tools.map(
      (t) => t.name,
    );
    assert.deepEqual(
      names.sort(),
      [...INTERACTIVE_TOOLS.map((t) => t.name)].sort(),
    );
    assert.ok(names.includes('next_work'));
    assert.ok(names.includes('submit_work'));
    assert.ok(!names.includes('claim_task'));
    init.store.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
