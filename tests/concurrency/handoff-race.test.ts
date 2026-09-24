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
import { sterile } from '../harness/sterile.ts';
import { envFor, initProject, INITIALIZE, Session } from './support.ts';

const OFFERS = 250;
const RACERS = 4;

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
      for (let i = 0; i < OFFERS; i += 1) {
        const added = await offerer.ok('work', { action: 'add', title: `offer ${String(i)}` });
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
