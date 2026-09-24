/**
 * tests/hosts/mcp/elicitation.test.ts — the person answers Construct
 * directly, through the host, when the host can show them the question.
 *
 * Driven over the real stdio loop: a relayed approval of an external write
 * makes the server ask the host to show the person the decision. Their choice
 * resolves it on the elicitation channel, even though the call that asked is
 * still open; a decline, a closed prompt, or no answer in time leaves it open
 * and says how else to answer. A host that cannot show questions, or a
 * machine where a hook could answer for the person, is never asked. Accepting
 * a deliverable goes the same way.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createMcpHandler, serveHandler } from '../../../src/hosts/mcp/server.ts';
import { HostRequests } from '../../../src/hosts/mcp/outbound.ts';
import { raiseDecision, getDecision } from '../../../src/kernel/state/decisions.ts';
import { listGrants } from '../../../src/kernel/state/grants.ts';
import { toolsFor } from '../../../src/kernel/broker/tools.ts';
import type { BrokerContext } from '../../../src/kernel/broker/context.ts';
import type { AskPerson } from '../../../src/kernel/policy/channels.ts';
import { brokerFixture, type BrokerFixture } from '../../kernel/broker/support.ts';
import { fixture } from '../../kernel/workflow/support.ts';

interface Message { id?: unknown; method?: string; params?: { message?: string; requestedSchema?: unknown }; result?: { structuredContent?: Record<string, unknown> } }

/** A host on the other end of a stdio pair: it sends requests and answers the server's. */
class FakeHost {
  readonly toServer = new PassThrough();
  readonly fromServer = new PassThrough();
  private buffer = '';
  private readonly replies = new Map<unknown, (m: Message) => void>();
  readonly asked: Message[] = [];
  answer: ((m: Message) => unknown) | null = null;

  constructor() {
    this.fromServer.on('data', (d) => {
      this.buffer += String(d);
      for (let nl = this.buffer.indexOf('\n'); nl >= 0; nl = this.buffer.indexOf('\n')) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        if (!line.trim()) continue;
        const m = JSON.parse(line) as Message;
        if (m.method === 'elicitation/create') {
          this.asked.push(m);
          const result = this.answer?.(m);
          if (result !== undefined) this.write({ jsonrpc: '2.0', id: m.id, result });
          continue;
        }
        this.replies.get(m.id)?.(m);
      }
    });
  }

  private write(m: unknown): void {
    this.toServer.write(`${JSON.stringify(m)}\n`);
  }

  private n = 0;
  /** Send a request without waiting for its answer; returns its id. */
  fire(method: string, params: unknown): number {
    const id = ++this.n;
    this.replies.set(id, (m) => this.late.push(m));
    this.write({ jsonrpc: '2.0', id, method, params });
    return id;
  }

  readonly late: Message[] = [];

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  request(method: string, params: unknown): Promise<Message> {
    const id = ++this.n;
    return new Promise((resolve) => {
      this.replies.set(id, resolve);
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  close(): void {
    this.toServer.end();
  }
}

async function session(fx: BrokerFixture, opts: { elicitation: boolean; personPrompts: boolean; waitMs?: number }): Promise<{ host: FakeHost; served: Promise<void> }> {
  const host = new FakeHost();
  const requests = new HostRequests();
  const handler = createMcpHandler('interactive', fx.broker, { hostRequests: requests, personPrompts: opts.personPrompts, personPromptWaitMs: opts.waitMs ?? 5_000 });
  const served = serveHandler(handler, host.toServer, host.fromServer, requests);
  await host.request('initialize', { protocolVersion: '2025-06-18', capabilities: opts.elicitation ? { elicitation: {} } : {}, clientInfo: { name: 'fake', version: '1' } });
  return { host, served };
}

function externalWrite(fx: BrokerFixture, id: string): void {
  raiseDecision(fx.broker.store, {
    id,
    kind: 'approval',
    question: 'Approve exactly this: push PROJ-14',
    options: ['approve', 'decline'],
    subject: { request: { tier: 'external_write', targetSystem: 'jira', targetResource: 'PROJ-14', operation: 'push PROJ-14', executorId: 'session:claude-code' } },
    at: fx.broker.now(),
  });
}

const decide = (host: FakeHost, decisionId: string): Promise<Record<string, unknown>> =>
  host.request('tools/call', { name: 'decide', arguments: { decisionId, resolution: 'approve' } }).then((m) => m.result!.structuredContent!);

test('the person’s own answer through the host resolves an approval a relay could not give', async () => {
  const fx = brokerFixture();
  try {
    externalWrite(fx, 'decision-ext');
    const { host, served } = await session(fx, { elicitation: true, personPrompts: true });
    host.answer = () => ({ action: 'accept', content: { answer: 'approve' } });
    const r = await decide(host, 'decision-ext');
    assert.equal(host.asked.length, 1);
    assert.match(host.asked[0]!.params!.message!, /^Construct needs your own answer; your assistant cannot give it for you\. Approve exactly this: push PROJ-14 Your assistant relayed "approve"\./);
    assert.deepEqual(host.asked[0]!.params!.requestedSchema, { type: 'object', properties: { answer: { type: 'string', title: 'Your answer', enum: ['approve', 'decline'] } }, required: ['answer'] });
    assert.equal((r.decision as { state: string }).state, 'resolved');
    assert.equal(r.channel, 'elicitation');
    const d = getDecision(fx.broker.store, 'decision-ext')!;
    assert.equal(d.resolvedBy, 'person via claude-code prompt');
    assert.equal(listGrants(fx.broker.store).length, 1, 'the person’s approval mints the grant');
    host.close();
    await served;
  } finally {
    fx.cleanup();
  }
});

for (const [label, answer, why] of [
  ['declined', { action: 'decline' }, /declined the prompt/],
  ['closed', { action: 'cancel' }, /closed the prompt/],
  ['answered off the list', { action: 'accept', content: { answer: 'approve everything' } }, /could not show the prompt/],
] as const) {
  test(`a prompt the person ${label} leaves the decision open and says how else to answer`, async () => {
    const fx = brokerFixture();
    try {
      externalWrite(fx, 'decision-ext');
      const { host, served } = await session(fx, { elicitation: true, personPrompts: true });
      host.answer = () => answer;
      const r = await decide(host, 'decision-ext');
      assert.equal((r.decision as { state: string }).state, 'open');
      assert.match(String(r.asked), why);
      assert.match(String(r.next), /construct inbox resolve decision-ext/);
      assert.equal(listGrants(fx.broker.store).length, 0);
      host.close();
      await served;
    } finally {
      fx.cleanup();
    }
  });
}

test('a prompt nobody answers in time leaves the decision open', async () => {
  const fx = brokerFixture();
  try {
    externalWrite(fx, 'decision-ext');
    const { host, served } = await session(fx, { elicitation: true, personPrompts: true, waitMs: 200 });
    host.answer = () => undefined;
    const r = await decide(host, 'decision-ext');
    assert.match(String(r.asked), /did not answer the prompt in time/);
    assert.equal(getDecision(fx.broker.store, 'decision-ext')!.state, 'open');
    const ping = await host.request('ping', {});
    assert.deepEqual((ping as { result?: unknown }).result, {}, 'the server keeps answering after a lapsed prompt');
    host.close();
    await served;
  } finally {
    fx.cleanup();
  }
});

for (const [label, opts] of [
  ['a host that cannot show questions', { elicitation: false, personPrompts: true }],
  ['a machine where a hook could answer for the person', { elicitation: true, personPrompts: false }],
] as const) {
  test(`${label} is never asked`, async () => {
    const fx = brokerFixture();
    try {
      externalWrite(fx, 'decision-ext');
      const { host, served } = await session(fx, opts);
      host.answer = () => ({ action: 'accept', content: { answer: 'approve' } });
      const r = await decide(host, 'decision-ext');
      assert.equal(host.asked.length, 0);
      assert.equal(r.personRequired, true);
      assert.equal(r.asked, undefined);
      assert.equal(listGrants(fx.broker.store).length, 0);
      host.close();
      await served;
    } finally {
      fx.cleanup();
    }
  });
}

test('accepting a deliverable asks the person the same way', async () => {
  const fx = fixture();
  try {
    const started = fx.service.start({ workflowId: 'ship', input: { request: 'Rename a private helper in the invoice formatter' }, trigger: 'manual' });
    const claimed = fx.service.claimNext({ runId: started.run.id });
    const deliverableId = fx.service.submit({ leased: claimed.packet!.leased, output: { summary: 'renamed the helper', findings: [] } }).deliverable!.id;
    const promote = toolsFor('interactive').find((t) => t.name === 'promote_deliverable')!;
    const asked: string[] = [];
    const yes: AskPerson = async (q) => (asked.push(q.message), { answered: true, choice: 'approve' });
    const ctx = { store: fx.store, workflow: fx.service, actor: 'model via claude-code', host: { hostId: 'claude-code' }, askPerson: yes } as unknown as BrokerContext;
    const r = (await promote.run(ctx, { deliverableId, to: 'accepted' })) as { deliverable: { trust: string }; channel: string };
    assert.equal(r.deliverable.trust, 'accepted');
    assert.equal(r.channel, 'elicitation');
    assert.match(asked[0]!, /Move deliverable .* to accepted\?/);
    const no: AskPerson = async () => ({ answered: false, why: 'declined' });
    const r2 = (await promote.run({ ...ctx, askPerson: no } as BrokerContext, { deliverableId, to: 'final' })) as { deliverable: { trust: string }; personRequired: boolean; asked: string };
    assert.deepEqual([r2.deliverable.trust, r2.personRequired, r2.asked], ['unchanged', true, 'the person declined the prompt']);
  } finally {
    fx.cleanup();
  }
});

test('a cancelled call stops waiting on the person at once, a queued one never runs, and neither is answered', async () => {
  const fx = brokerFixture();
  try {
    externalWrite(fx, 'decision-ext');
    const { host, served } = await session(fx, { elicitation: true, personPrompts: true, waitMs: 30_000 });
    host.answer = () => undefined;
    const waiting = host.fire('tools/call', { name: 'decide', arguments: { decisionId: 'decision-ext', resolution: 'approve' } });
    const queued = host.fire('tools/call', { name: 'work', arguments: { action: 'add', title: 'never recorded' } });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(host.asked.length, 1, 'the first call is waiting on the person');
    host.notify('notifications/cancelled', { requestId: queued, reason: 'changed my mind' });
    host.notify('notifications/cancelled', { requestId: waiting, reason: 'changed my mind' });
    const started = Date.now();
    const ping = await host.request('ping', {});
    assert.deepEqual((ping as { result?: unknown }).result, {});
    assert.ok(Date.now() - started < 5_000, 'the server did not wait out the prompt');
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(host.late, [], 'cancelled calls are not answered');
    assert.equal(getDecision(fx.broker.store, 'decision-ext')!.state, 'open');
    const titles = (fx.broker.store.db.prepare('SELECT title FROM work_items').all() as { title: string }[]).map((w) => w.title);
    assert.ok(!titles.includes('never recorded'), 'the queued call never ran');
    host.close();
    await served;
  } finally {
    fx.cleanup();
  }
});

test('a call cancelled before it asks the person never sends the prompt', async () => {
  const sent: unknown[] = [];
  const requests = new HostRequests();
  requests.attach(async (m) => {
    sent.push(m);
  });
  requests.beginCall();
  requests.cancelAll();
  await assert.rejects(requests.request('elicitation/create', {}, 5_000), /cancelled the call/);
  assert.deepEqual(sent, []);
  requests.beginCall();
  const next = requests.request('ping', {}, 50);
  assert.equal(sent.length, 1, 'the next call may ask again');
  await assert.rejects(next, /did not answer/);
});
