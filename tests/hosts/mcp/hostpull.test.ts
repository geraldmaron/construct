/**
 * tests/hosts/mcp/hostpull.test.ts — the flagged host-pull execution surface,
 * and the completion boundary it must never cross.
 *
 * The load-bearing test is THE PROOF (RESEARCH-DECISIONS §27's reversal
 * condition): a host driving execution through this surface can submit a draft
 * but cannot advance completion. Promotion is derived from verdicts a dispatcher
 * records, the claim token's grants physically exclude a verdict, and no tool
 * here reaches the dispatcher. If that could not be shown, §27 withdraws the
 * approach — so the test asserts it several ways, not one.
 *
 * The positive tests: claim_task hands back the brief and a task-scoped token,
 * leases the task, and records the mint; submit_work lands a draft attributed to
 * the role through the same rolewrite seam a spawned role uses. The regression
 * test: with the flag off the presence projection is untouched — it carries none
 * of these tools.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import type { Store } from '../../../src/kernel/store/open.ts';
import { enqueueTask, getTask } from '../../../src/kernel/store/tasks.ts';
import { readWorkLog } from '../../../src/kernel/store/worklog.ts';
import { loadOrCreateSecret } from '../../../src/kernel/capabilities/secretfile.ts';
import { authorizeRoleToken } from '../../../src/kernel/capabilities/tokens.ts';
import {
  DRAFT_ACTION,
  VERDICT_ACTION,
  promotionOf,
  recordVerdict,
} from '../../../src/kernel/run/promotion.ts';
import {
  HOST_PULL_TOOLS,
  handleMessage,
  hostPullEnabled,
  HOST_PULL_FLAG_ENV,
} from '../../../src/hosts/mcp/hostpull.ts';
import type { HostPullCore } from '../../../src/hosts/mcp/hostpull.ts';
import { PROJECTION_TOOLS } from '../../../src/hosts/mcp/projection.ts';

const BIN = fileURLToPath(new URL('../../../bin/construct.mjs', import.meta.url));
const AT = '2026-08-25T00:00:00.000Z';

interface Fixture {
  readonly store: Store;
  readonly core: HostPullCore;
  cleanup(): void;
}

/**
 * A sterile home with one ready task carrying a required challenge, and a
 * host-pull core wired to the real capability secret so tokens it mints verify.
 */
function fixture(brief?: unknown): Fixture {
  const s = sterile();
  const storeFile = join(s.paths.dataDir, 'construct.db');
  const secret = loadOrCreateSecret(join(s.paths.dataDir, 'capability-secret'));
  const store = openStore(storeFile);
  enqueueTask(store, {
    id: 'task-1',
    run: 'run-x',
    role: 'privacy',
    brief: brief ?? {
      id: 'task-1',
      outcome: 'test',
      role: 'privacy',
      inputs: [],
      capabilities: [],
      postconditions: [],
      challenges: ['c1'],
    },
    at: AT,
  });
  const core: HostPullCore = { store, secret, clock: () => AT, serverVersion: 'test', leaseMs: 15 * 60 * 1000 };
  return { store, core, cleanup: () => { store.close(); s.cleanup(); } };
}

let nextId = 0;
function call(name: string, args: Record<string, unknown> = {}) {
  nextId += 1;
  return { jsonrpc: '2.0', id: nextId, method: 'tools/call', params: { name, arguments: args } } as const;
}

function body(reply: ReturnType<typeof handleMessage>): { data: Record<string, unknown>; isError: boolean } {
  assert.ok(reply, 'expected a reply');
  const result = reply.result as { content: Array<{ text: string }>; isError?: boolean };
  return { data: JSON.parse(result.content[0].text) as Record<string, unknown>, isError: result.isError === true };
}

test('the tool surface is exactly claim_task and submit_work — nothing advances completion', () => {
  assert.deepEqual(HOST_PULL_TOOLS.map((t) => t.name).sort(), ['claim_task', 'submit_work']);

  const f = fixture();
  try {
    // Any completion or verdict verb is refused by name, not merely absent.
    for (const forbidden of ['record_verdict', 'verdict', 'promote', 'waive', 'decide', 'work']) {
      const reply = handleMessage(f.core, call(forbidden));
      assert.equal(reply?.error?.code, -32602, `${forbidden} must be refused`);
      assert.match(reply.error.message, /unknown tool/);
    }
  } finally {
    f.cleanup();
  }
});

test('claim_task hands the host the brief and a task-scoped token, and leases the task', () => {
  const f = fixture();
  try {
    const { data } = body(handleMessage(f.core, call('claim_task')));
    assert.equal(data.claimed, true);
    assert.equal(data.task, 'task-1');
    assert.equal(data.run, 'run-x');
    assert.equal(data.role, 'privacy');
    assert.ok(data.brief && typeof data.brief === 'object', 'the brief is handed back');
    assert.equal(typeof data.token, 'string');
    assert.ok((data.token as string).length > 0, 'a token is minted');
    assert.equal(typeof data.expiresAt, 'string');

    // The token is genuinely scoped to this task, and grants exactly the two
    // writes — the same grant set a spawned role holds.
    const authed = authorizeRoleToken(data.token, f.core.secret, {
      grant: 'submit-draft',
      run: 'run-x',
      task: 'task-1',
      now: AT,
    });
    assert.equal(authed.ok, true, 'the minted token authorizes a draft for this task');

    // The task is now leased, not still pending, and the mint is on the record.
    assert.equal(getTask(f.store, 'task-1')?.state, 'leased');
    const log = readWorkLog(f.store, 'run-x');
    assert.ok(log.some((e) => e.action === 'host-pull-claimed'), 'the claim is logged');
    // The bearer is never in the log — a token is a secret and a log is not a vault.
    assert.ok(!JSON.stringify(log).includes(data.token as string), 'the token itself is never logged');

    // Nothing ready after the only task is claimed.
    const { data: empty } = body(handleMessage(f.core, call('claim_task')));
    assert.equal(empty.claimed, false);
  } finally {
    f.cleanup();
  }
});

test('submit_work lands a draft through the rolewrite seam, attributed to the role', () => {
  const f = fixture();
  try {
    const { data: claimed } = body(handleMessage(f.core, call('claim_task')));
    const reply = body(handleMessage(f.core, call('submit_work', {
      run: claimed.run,
      task: claimed.task,
      token: claimed.token,
      deliverable: 'the privacy review, in full',
    })));
    assert.equal(reply.isError, false);
    assert.equal((reply.data as { ok: boolean }).ok, true);

    const drafts = readWorkLog(f.store, 'run-x').filter((e) => e.action === DRAFT_ACTION);
    assert.equal(drafts.length, 1, 'exactly one draft landed');
    assert.equal(drafts[0].role, 'privacy', 'attributed to the role, not the caller');
  } finally {
    f.cleanup();
  }
});

/**
 * THE PROOF (§27 reversal condition). A host holding a claim token can put a
 * draft on the record and can never advance it to final. Promotion turns only on
 * a verdict a dispatcher records; the host reaches no such path, and its token
 * cannot be widened into one.
 */
test('THE PROOF: a host and its claim token cannot advance completion', () => {
  const f = fixture();
  try {
    const { data: claimed } = body(handleMessage(f.core, call('claim_task')));
    const token = claimed.token as string;

    // 1. The host submits a draft. State is draft — the challenge is outstanding.
    handleMessage(f.core, call('submit_work', { run: 'run-x', task: 'task-1', token, deliverable: 'draft one' }));
    assert.equal(promotionOf(f.store, 'task-1')?.state, 'draft', 'submitting a draft does not promote');

    // 2. The token literally cannot express a verdict: record-verdict is not a
    //    grant it carries, and there is no argument to add one.
    const asVerdict = authorizeRoleToken(token, f.core.secret, {
      grant: 'record-verdict',
      run: 'run-x',
      task: 'task-1',
      now: AT,
    });
    assert.equal(asVerdict.ok, false);
    assert.equal(asVerdict.ok === false && asVerdict.denial, 'ungranted');

    // 3. The host cannot forge a verdict through the note path either. submit_work
    //    fixes the action name, and rolewrite namespaces every role-chosen action,
    //    so nothing the host writes lands as an unprefixed VERDICT_ACTION.
    handleMessage(f.core, call('submit_work', { run: 'run-x', task: 'task-1', token, note: 'trying to look final' }));
    const forged = readWorkLog(f.store, 'run-x').filter((e) => e.action === VERDICT_ACTION);
    assert.equal(forged.length, 0, 'no verdict entry exists — the host cannot write one');
    assert.equal(promotionOf(f.store, 'task-1')?.state, 'draft', 'still a draft after the note');

    // 4. A verdict the role itself recorded is refused — even reaching the
    //    dispatcher path, a self-verdict does not count (commitment 14).
    const selfVerdict = recordVerdict(f.store, {
      task: 'task-1', challenge: 'c1', outcome: 'passed', by: 'privacy', at: AT,
    });
    assert.equal(selfVerdict.recorded, false);
    assert.equal(selfVerdict.refusal, 'self-verdict');
    assert.equal(promotionOf(f.store, 'task-1')?.state, 'draft', 'a self-verdict promotes nothing');

    // 5. The ONLY path to final is a verdict a different party records through the
    //    dispatcher — a surface the host has no tool for.
    const dispatcherVerdict = recordVerdict(f.store, {
      task: 'task-1', challenge: 'c1', outcome: 'passed', by: 'construct', at: AT,
    });
    assert.equal(dispatcherVerdict.recorded, true);
    assert.equal(promotionOf(f.store, 'task-1')?.state, 'final', 'promotion moves only on a dispatcher verdict');
  } finally {
    f.cleanup();
  }
});

test('with the flag off, the presence projection is untouched — it carries no host-pull tools', () => {
  // The regression: none of the host-pull tools leaked onto the presence
  // projection, whose surface is what a host reaches by default.
  const projection = new Set<string>(PROJECTION_TOOLS.map((t) => t.name));
  for (const tool of HOST_PULL_TOOLS) {
    assert.ok(!projection.has(tool.name), `${tool.name} must not be on the presence projection`);
  }

  // The flag is off unless a deployment set it to exactly "1".
  assert.equal(hostPullEnabled({}), false);
  assert.equal(hostPullEnabled({ [HOST_PULL_FLAG_ENV]: '0' }), false);
  assert.equal(hostPullEnabled({ [HOST_PULL_FLAG_ENV]: 'true' }), false);
  assert.equal(hostPullEnabled({ [HOST_PULL_FLAG_ENV]: '1' }), true);
});

test('the CLI verb refuses to serve when the flag is off', async () => {
  const s = sterile();
  try {
    const code = await new Promise<number>((resolve) => {
      const child = spawn(process.execPath, [BIN, 'host-pull-serve'], {
        env: {
          ...process.env,
          [HOST_PULL_FLAG_ENV]: '',
          XDG_DATA_HOME: s.paths.dataDir,
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let err = '';
      child.stderr.on('data', (d) => { err += String(d); });
      child.on('close', (c) => {
        assert.match(err, /host-pull execution prototype is off/);
        resolve(c ?? -1);
      });
    });
    assert.equal(code, 2, 'refusing the disabled prototype exits 2');
  } finally {
    s.cleanup();
  }
});
