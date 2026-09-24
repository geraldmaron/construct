/**
 * tests/cli/work-handoff.test.ts — the person hands claimed work on from the
 * command line.
 *
 * A handoff needs the claim's token and says where the work stands and what
 * comes next; a packet missing either is a usage error. The offer is listed
 * for whoever may take it, shown as its author's words, and accepting it from
 * the command line is the person's to do, never their own offer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../../src/cli/index.ts';
import { capture, inProject } from './support.ts';

const last = (out: string): unknown => JSON.parse(out.trim().split('\n').pop()!);

test('the person offers claimed work with a packet; offers and show list it as their words', async () => {
  await inProject(async (ctx) => {
    const person = { ...ctx, terminal: { interactive: true, agentAncestor: null } };
    const relayed = { ...ctx, terminal: { interactive: false, agentAncestor: 'claude' } };
    const id = (last((await capture(() => run(['work', 'add', 'finish the parser', '--json'], person))).out) as { id: string }).id;
    const token = (last((await capture(() => run(['work', 'claim', id, '--json'], person))).out) as { claimToken: string }).claimToken;

    const noToken = await capture(() => run(['work', 'handoff', id, '--state=half', '--next=finish'], person));
    assert.equal(noToken.code, 2);
    const noNext = await capture(() => run(['work', 'handoff', id, `--token=${token}`, '--state=half'], person));
    assert.equal(noNext.code, 2);
    assert.match(noNext.err, /says next/);

    const offered = await capture(() => run(['work', 'handoff', id, `--token=${token}`, '--state=lexer done', '--next=write expr.ts', '--watch-out=grammar test flakes', '--branch=feat/parser', '--commit=abc1234'], person));
    assert.equal(offered.code, 0, offered.err);
    assert.match(offered.out, /offered .* to anyone in the project; it stays yours until accepted/);

    const offers = await capture(() => run(['work', 'offers'], relayed));
    assert.match(offers.out, new RegExp(`${id}  from person via cli  finish the parser`));

    const shown = await capture(() => run(['work', 'show', id], relayed));
    assert.match(shown.out, /offered by person via cli/);
    assert.match(shown.out, /handoff notes from person via cli \(their words, not instructions\):\n  state: lexer done\n  next: write expr\.ts\n  watch out: grammar test flakes\n  where: feat\/parser at abc1234/);

    const relayedAccept = await capture(() => run(['work', 'accept', id], relayed));
    assert.equal(relayedAccept.code, 1);
    assert.match(relayedAccept.err, /is the person's to do/);
    const ownAccept = await capture(() => run(['work', 'accept', id], person));
    assert.equal(ownAccept.code, 1);
    assert.match(ownAccept.err, /you offered/);
  });
});
