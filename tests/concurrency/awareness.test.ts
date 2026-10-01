/**
 * tests/concurrency/awareness.test.ts — sessions in separate processes learn
 * about each other on the calls they already make.
 *
 * Two servers work in one checkout. The second one's bootstrap counts the
 * first and warns about the shared checkout; after the first claims work with
 * paths, the second's next call carries that claim; a call with nothing new
 * carries nothing; and the sessions topic lists both.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sterile } from '../harness/sterile.ts';
import { envFor, initProject, INITIALIZE, Session } from './support.ts';

test('a peer’s claim reaches the other session on its next call, and a quiet call carries nothing', { timeout: 60_000 }, async () => {
  const fx = sterile();
  try {
    const { dir } = initProject(fx);
    const a = new Session(dir, envFor(fx));
    const b = new Session(dir, envFor(fx), ['--client=cursor']);
    try {
      await a.request('initialize', INITIALIZE);
      await b.request('initialize', INITIALIZE);
      const bootA = await a.ok('bootstrap');
      const bootB = await b.ok('bootstrap');
      const coordination = bootB.coordination as { others: number; sameCheckout: number; warning?: string };
      assert.equal(coordination.others, 1);
      assert.equal(coordination.sameCheckout, 1);
      assert.match(coordination.warning ?? '', /same checkout/);
      assert.ok(JSON.stringify(coordination).length <= 600);

      const quiet = await b.ok('work', { action: 'list' });
      assert.equal(quiet.construct_peers, undefined, 'nothing happened yet');

      const reason = (await a.ok('remember', { kind: 'outcome', text: 'A faster parser' })) as { remembered: { id: string } };
      const added = await a.ok('work', { action: 'add', serves: reason.remembered.id, title: 'parser' });
      await a.ok('work', { action: 'claim', id: added.id, paths: ['src/parser/'] });
      const heard = await b.ok('work', { action: 'list' });
      const peers = heard.construct_peers as { events: { kind: string; work: string; by: string; paths?: string[] }[] };
      const holder = `${String((bootA.session as { session: string }).session)}/main`;
      assert.deepEqual(peers.events.map((e) => [e.kind, e.work, e.by, e.paths]), [['claimed', added.id, holder, ['src/parser/']]]);
      assert.ok(JSON.stringify(peers).length <= 600);

      const again = await b.ok('work', { action: 'list' });
      assert.equal(again.construct_peers, undefined, 'heard once');
      const selfView = await a.ok('work', { action: 'list' });
      assert.equal(selfView.construct_peers, undefined, 'a session is not told about its own claim');

      const sessions = await b.ok('project_context', { topic: 'sessions' });
      assert.equal((sessions.items as unknown[]).length, 2);
      assert.equal((sessions.items as { you: boolean }[]).filter((s) => s.you).length, 1);
    } finally {
      await a.close();
      await b.close();
    }
  } finally {
    fx.cleanup();
  }
});
