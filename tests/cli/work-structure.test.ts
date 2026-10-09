/**
 * tests/cli/work-structure.test.ts — work filed from the command line carries
 * its parent, dependencies, acceptance criteria, and risk; the person's own
 * filing is admitted, a relayed one without a reason waits as proposed until
 * the person admits it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../src/cli/index.ts';
import { capture, inProject } from './support.ts';

const last = (out: string): Record<string, unknown> => JSON.parse(out.trim().split('\n').pop()!) as Record<string, unknown>;

test('add, link, update, unlink, and admit shape the ledger; show prints the structure', async () => {
  await inProject(async (ctx) => {
    const relayed = { ...ctx, terminal: { interactive: false, agentAncestor: null } };
    const person = { ...ctx, terminal: { interactive: true, agentAncestor: null } };
    const cli = async (args: string[], who = person) => {
      const r = await capture(() => run(args, who));
      return r;
    };

    const sessionOutcome = last((await cli(['work', 'add', 'A session’s outcome', '--kind=outcome', '--json'], relayed)).out);
    assert.equal(sessionOutcome.status, 'proposed', 'a relayed outcome needs a reason too');
    const outcome = last((await cli(['work', 'add', 'Faster parser', '--kind=outcome', '--json'])).out);
    assert.equal(outcome.status, 'open');

    const relayedLoose = last((await cli(['work', 'add', 'Tidy the lexer', '--json'], relayed)).out);
    assert.equal(relayedLoose.status, 'proposed');
    assert.match(String(relayedLoose.next), /construct work admit/);
    const refusedAdmit = await cli(['work', 'admit', String(relayedLoose.id)], relayed);
    assert.equal(refusedAdmit.code, 1);
    assert.match(refusedAdmit.err, /no reason to exist yet/);
    const admitted = await cli(['work', 'admit', String(relayedLoose.id)]);
    assert.equal(admitted.code, 0, admitted.err);
    assert.match(admitted.out, /admitted .* open/);

    const personal = last((await cli(['work', 'add', 'Rename a helper', '--json'])).out);
    assert.equal(personal.status, 'open', 'the person’s own filing needs no parent');

    const task = await cli([
      'work', 'add', 'Cache the grammar', `--parent=${String(outcome.id)}`, `--blocked-by=${String(relayedLoose.id)}`,
      '--accept=cold start under 200 ms', '--accept=no stale cache after an edit', '--risk=cache invalidation', '--json',
    ], relayed);
    assert.equal(task.code, 0, task.err);
    const taskId = String(last(task.out).id);
    assert.equal(last(task.out).status, 'open');

    const shown = await cli(['work', 'show', taskId]);
    assert.match(shown.out, new RegExp(`parent: ${String(outcome.id)} open Faster parser`));
    assert.match(shown.out, new RegExp(`blocked by: ${String(relayedLoose.id)} open Tidy the lexer`));
    assert.match(shown.out, /accept when: cold start under 200 ms\n.*accept when: no stale cache after an edit/);
    assert.match(shown.out, /risk: cache invalidation/);
    assert.match(shown.out, /not ready: blocked by/);

    const parentShown = await cli(['work', 'show', String(outcome.id)]);
    assert.match(parentShown.out, /children: 0 of 1 finished/);

    const updated = await cli(['work', 'update', taskId, '--accept=cold start under 150 ms']);
    assert.equal(updated.code, 0, updated.err);
    const unlinked = await cli(['work', 'unlink', taskId, `--blocked-by=${String(relayedLoose.id)}`]);
    assert.equal(unlinked.code, 0, unlinked.err);
    const after = last((await cli(['work', 'show', taskId, '--json'])).out) as { structure: { acceptance: string[]; blockedBy: unknown[] }; readiness: { ready: boolean } };
    assert.deepEqual(after.structure.acceptance, ['cold start under 150 ms']);
    assert.deepEqual(after.structure.blockedBy, []);
    assert.equal(after.readiness.ready, true);

    const listed = await cli(['work', 'list', `--parent=${String(outcome.id)}`]);
    assert.match(listed.out, /Cache the grammar/);
    assert.doesNotMatch(listed.out, /Rename a helper/);

    const unfinished = await cli(['work', 'complete', String(outcome.id)]);
    assert.equal(unfinished.code, 1);
    assert.match(unfinished.err, /open child item/);
    const noEvidence = await cli(['work', 'complete', taskId]);
    assert.equal(noEvidence.code, 1);
    assert.match(noEvidence.err, /say how they were met/);
  });
});

test('export and restore read and write a relative file in the command’s own directory', async () => {
  await inProject(async (ctx, box) => {
    const person = { ...ctx, terminal: { interactive: true, agentAncestor: null } };
    const exported = await capture(() => run(['work', 'export', 'snapshot.json'], person));
    assert.equal(exported.code, 0, exported.err);
    assert.ok(existsSync(join(box.cwd, 'snapshot.json')), 'the snapshot lands in the project, not the process directory');
    assert.ok(!existsSync(join(process.cwd(), 'snapshot.json')));
    const restored = await capture(() => run(['work', 'restore', 'snapshot.json'], person));
    assert.equal(restored.code, 0, restored.err);
  });
});
