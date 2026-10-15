/**
 * tests/concurrency/handoff-race.test.ts — a handoff has one taker.
 *
 * One server offers many work items; four other servers, each its own
 * session and OS process, race to accept every one of them in a different
 * order. Each offer is accepted exactly once, the ledger names that acceptor
 * as the holder, and no accept fails for a lock.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { freshStore } from '../kernel/state/support.ts';
import { claimWork, createWork, handoffWork } from '../../src/kernel/work/service.ts';
import { sterile } from '../harness/sterile.ts';
import { envFor, initProject, INITIALIZE, Session } from './support.ts';

const OFFERS = 250;
const RACERS = 4;

test('stdio capability acceptance fences a delayed unused request and recovers duplicate responses', { timeout: 30_000 }, async () => {
  const fx = sterile();
  try {
    const { dir } = initProject(fx);
    const a = new Session(dir, envFor(fx)), b = new Session(dir, envFor(fx));
    try {
      await Promise.all([a.request('initialize', INITIALIZE), b.request('initialize', INITIALIZE)]);
      const reason = await a.ok('remember', { kind: 'outcome', text: 'Recover a lost acceptance response safely' });
      const item = await a.ok('work', { action: 'add', title: 'Recoverable handoff', serves: (reason.remembered as { id: string }).id });
      const held = await a.ok('work', { action: 'claim', id: item.id, paths: ['src/'] });
      const offer = { action: 'handoff', id: item.id, token: held.claimToken, packet: { state: 'Ready', next: 'Review' } };
      await a.ok('work', offer);
      const stale = await b.ok('work', { action: 'prepare_accept', id: item.id });
      await a.ok('work', offer);
      const delayed = await b.call('work', { action: 'accept', id: item.id, offerId: stale.offerId, acceptanceKey: stale.acceptanceKey });
      assert.equal(delayed.result?.isError, true);
      const prepared = await b.ok('work', { action: 'prepare_accept', id: item.id });
      const request = { action: 'accept', id: item.id, offerId: prepared.offerId, acceptanceKey: prepared.acceptanceKey };
      const responses = await Promise.all([b.ok('work', request), b.ok('work', request)]);
      assert.equal(responses[0]!.claimToken, responses[1]!.claimToken);
      assert.equal(responses[0]!.claimUntil, responses[1]!.claimUntil);
      assert.equal(responses[0]!.revision, responses[1]!.revision);
      assert.ok(!JSON.stringify(await b.ok('work', { action: 'show', id: item.id })).includes(String(prepared.acceptanceKey)));
    } finally { await Promise.all([a.close(), b.close()]); }
  } finally { fx.cleanup(); }
});

test('concurrent acceptance retries share one generation while another recipient cannot recover it', { timeout: 30_000 }, async () => {
  const fx = freshStore();
  try {
    for (const competing of [false, true]) {
      const id = `recover-${String(competing)}`, now = '2026-10-15T12:00:00.000Z', until = '2026-10-15T13:00:00.000Z';
      createWork(fx.store, { id, kind: 'task', title: id, description: id, at: now });
      const held = claimWork(fx.store, { id, owner: 'offerer', paths: [`src/${id}.ts`], now, until });
      const offerId = handoffWork(fx.store, { id, owner: 'offerer', token: held.claimToken, packet: { state: 'Ready', next: 'Review' }, now }).handoff.offerId;
      const acceptanceKey = randomBytes(32).toString('hex'), barrier = new SharedArrayBuffer(4);
      const inputs = [{ owner: 'acceptor', acceptanceKey }, { owner: 'acceptor', acceptanceKey }, ...(competing ? [{ owner: 'competitor', acceptanceKey: randomBytes(32).toString('hex') }] : [])];
      const jobs = inputs.map(input => {
        const worker = new Worker(`
          const { parentPort, workerData } = require('node:worker_threads');
          (async () => {
            const { openStateStore } = await import(workerData.open);
            const { acceptWork } = await import(workerData.service);
            const { createHash } = await import('node:crypto');
            const store = openStateStore(workerData.db);
            parentPort.postMessage({ ready: true });
            Atomics.wait(new Int32Array(workerData.barrier), 0, 0);
            try {
              const accepted = acceptWork(store, workerData.input);
              parentPort.postMessage({ owner: accepted.claimOwner, digest: createHash('sha256').update(accepted.claimToken).digest('hex') });
            } catch (error) { parentPort.postMessage({ error: error.message }); }
            finally { store.close(); }
          })().catch(error => { throw error; });
        `, { eval: true, workerData: { db: fx.dbPath, open: new URL('../../src/kernel/state/open.ts', import.meta.url).href, service: new URL('../../src/kernel/work/service.ts', import.meta.url).href, barrier, input: { id, now, until, offerId, ...input } } });
        let ready!: () => void, result!: (value: { owner?: string; digest?: string; error?: string }) => void;
        const started = new Promise<void>((resolve, reject) => { ready = resolve; worker.once('error', reject); });
        const completed = new Promise<{ owner?: string; digest?: string; error?: string }>((resolve, reject) => { result = resolve; worker.on('error', reject); });
        worker.on('message', message => { if (message.ready) ready(); else result(message); });
        return { started, completed, worker };
      });
      try {
        await Promise.all(jobs.map(job => job.started));
        Atomics.store(new Int32Array(barrier), 0, 1); Atomics.notify(new Int32Array(barrier), 0);
        const results = await Promise.all(jobs.map(job => job.completed));
        const successes = results.filter(result => result.digest);
        assert.equal(new Set(successes.map(result => result.owner)).size, 1);
        assert.equal(new Set(successes.map(result => result.digest)).size, 1);
        assert.equal(successes.length, successes[0]!.owner === 'acceptor' ? 2 : 1);
        assert.ok(!results.some(result => /locked|busy/.test(result.error ?? '')));
        const receipts = fx.store.db.prepare("SELECT COUNT(*) AS n FROM work_events WHERE work_id = ? AND kind = 'handoff_acceptance_receipt'").get(id) as { n: number };
        assert.equal(receipts.n, 1);
      } finally { await Promise.all(jobs.map(job => job.worker.terminate())); }
    }
  } finally { fx.cleanup(); }
});

/** A fixed, per-racer shuffle, so a failure replays. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

test('four sessions racing to accept 250 handoffs take each exactly once', { timeout: 300_000 }, async () => {
  const fx = sterile();
  try {
    const { dir, db } = initProject(fx);
    const offerer = new Session(dir, envFor(fx));
    const racers = Array.from({ length: RACERS }, () => new Session(dir, envFor(fx)));
    try {
      await offerer.request('initialize', INITIALIZE);
      await Promise.all(racers.map((r) => r.request('initialize', INITIALIZE)));
      const ids: string[] = [];
      const reason = (await offerer.ok('remember', { kind: 'outcome', text: 'Handoffs land exactly once' })) as { remembered: { id: string } };
      for (let i = 0; i < OFFERS; i += 1) {
        const added = await offerer.ok('work', { action: 'add', serves: reason.remembered.id, title: `offer ${String(i)}` });
        const claimed = await offerer.ok('work', { action: 'claim', id: added.id, paths: [`src/f${String(i)}.ts`] });
        await offerer.ok('work', { action: 'handoff', id: added.id, token: claimed.claimToken, packet: { state: `item ${String(i)} started`, next: 'finish it' } });
        ids.push(String(added.id));
      }

      const outcomes = await Promise.all(
        racers.map(async (racer, r) => {
          const won: { id: string; owner: string }[] = [];
          const errors: string[] = [];
          for (const id of shuffled(ids, r + 1)) {
            const reply = await racer.call('work', { action: 'accept', id });
            if (reply.result?.isError) errors.push(String(reply.result.structuredContent?.error ?? reply.error?.message));
            else won.push({ id, owner: String(reply.result?.structuredContent?.claimOwner) });
          }
          return { won, errors };
        }),
      );

      const attempts = outcomes.reduce((n, o) => n + o.won.length + o.errors.length, 0);
      assert.equal(attempts, OFFERS * RACERS);
      const lockErrors = outcomes.flatMap((o) => o.errors).filter((e) => /locked|busy/i.test(e));
      assert.deepEqual(lockErrors, [], 'no accept fails for a lock');
      const losers = outcomes.flatMap((o) => o.errors).filter((e) => !/no open handoff/.test(e));
      assert.deepEqual(losers.slice(0, 3), [], 'a losing accept is told the offer is taken');
      const winners = outcomes.flatMap((o) => o.won);
      assert.equal(winners.length, OFFERS, 'every offer was taken');
      assert.equal(new Set(winners.map((w) => w.id)).size, OFFERS, 'no offer was taken twice');

      const check = new DatabaseSync(db, { readOnly: true });
      try {
        for (const w of winners) {
          const row = check.prepare('SELECT claim_owner, handoff_json FROM work_items WHERE id = ?').get(w.id) as { claim_owner: string; handoff_json: string };
          assert.equal(row.claim_owner, w.owner);
          assert.equal((JSON.parse(row.handoff_json) as { takenBy: string }).takenBy, w.owner);
        }
        const leaseHolders = check
          .prepare(`SELECT l.work_id, l.session_id, w.claim_session FROM path_leases l JOIN work_items w ON w.id = l.work_id WHERE l.released_at IS NULL`)
          .all() as { work_id: string; session_id: string; claim_session: string }[];
        assert.equal(leaseHolders.length, OFFERS);
        assert.deepEqual(leaseHolders.filter((l) => l.session_id !== l.claim_session), [], 'each reservation moved to its acceptor');
      } finally {
        check.close();
      }
    } finally {
      await offerer.close();
      await Promise.all(racers.map((r) => r.close()));
    }
  } finally {
    fx.cleanup();
  }
});
