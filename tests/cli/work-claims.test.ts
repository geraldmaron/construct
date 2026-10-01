/**
 * tests/cli/work-claims.test.ts — a work claim from the command line is the
 * person's.
 *
 * A model runs work through its session's work tool, where the claim belongs
 * to that session and agent. From the command line every model would share
 * one name, so a claim or takeover there needs a terminal of the person's own,
 * and a claim's term is capped however far --until reaches.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../../src/cli/index.ts';
import { capture, inProject } from './support.ts';

test('only the person claims or takes over work from the command line, and a claim is capped at a day', async () => {
  await inProject(async (ctx) => {
    const relayed = { ...ctx, terminal: { interactive: false, agentAncestor: null } };
    const person = { ...ctx, terminal: { interactive: true, agentAncestor: null } };
    const added = await capture(() => run(['work', 'add', 'a thing to do', '--json'], person));
    assert.equal(added.code, 0, added.err);
    const id = (JSON.parse(added.out.trim().split('\n').pop()!) as { id: string }).id;

    const refused = await capture(() => run(['work', 'claim', id], relayed));
    assert.equal(refused.code, 1);
    assert.match(refused.err, /is the person's to do/);
    const refusedTakeover = await capture(() => run(['work', 'takeover', id, '--reason=mine now'], relayed));
    assert.equal(refusedTakeover.code, 1);

    const claimed = await capture(() => run(['work', 'claim', id, '--until=2099-01-01T00:00:00.000Z', '--json'], person));
    assert.equal(claimed.code, 0, claimed.err);
    const record = JSON.parse(claimed.out.trim().split('\n').pop()!) as { claimUntil: string; claimOwner: string };
    assert.equal(record.claimOwner, 'person via cli');
    // The sandbox clock starts at 2026-09-02T12:00Z; a day on is the ceiling, not 2099.
    assert.ok(Date.parse(record.claimUntil) <= Date.parse('2026-09-03T12:05:00.000Z'), `capped at a day: ${record.claimUntil}`);
  });
});
