/**
 * tests/kernel/broker/work-paths.test.ts — through the work tool, sessions
 * reserve the paths they will change and check them before editing.
 *
 * Two sessions in one checkout cannot hold the same paths; a session in a
 * worktree gets a merge risk naming the other checkout instead of a refusal;
 * check reports both without writing anything; and a path outside the
 * repository never reaches the ledger.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { record, ToolInputError } from '../../../src/kernel/broker/definition.ts';
import { createBrokerContext } from '../../../src/cli/broker-context.ts';
import type { BrokerContext } from '../../../src/kernel/broker/context.ts';
import { brokerFixture, type BrokerFixture } from './support.ts';

const work = TOOLS.find((t) => t.name === 'work')!;
const call = (ctx: BrokerContext, args: Record<string, unknown>): unknown => work.run(ctx, work.validate(record(args)));

function peer(fx: BrokerFixture, sessionId: string, lane: string | null): BrokerContext {
  const b = fx.broker;
  const project = { root: b.root, layout: b.layout, files: b.files, store: b.store, lane: lane === null ? null : { root: lane, checkout: lane, branch: 'feat/lane', head: null } };
  return createBrokerContext(fx.ctx, project, { ...fx.binding, sessionId });
}

test('sessions reserve paths through the work tool: one writer per path in a checkout, a merge risk across worktrees', () => {
  const fx = brokerFixture();
  try {
    const a = fx.broker;
    const b = peer(fx, 'ses_b', null);
    const c = peer(fx, 'ses_c', '/tmp/repo-lane');
    const one = call(a, { action: 'add', title: 'parser' }) as { id: string };
    const two = call(a, { action: 'add', title: 'lexer' }) as { id: string };
    const three = call(a, { action: 'add', title: 'docs' }) as { id: string };

    const held = call(a, { action: 'claim', id: one.id, paths: ['src/parser/'] }) as { claimToken: string; leases: { path: string; sessionId: string }[] };
    assert.deepEqual(held.leases.map((l) => [l.path, l.sessionId]), [['src/parser/', 'ses_fixture']]);

    const before = (call(b, { action: 'check', paths: ['src/parser/lex.ts'] })) as { clear: boolean; collisions: { holder: string }[] };
    assert.equal(before.clear, false);
    assert.equal(before.collisions[0]!.holder, 'ses_fixture/main');
    assert.throws(() => call(b, { action: 'claim', id: two.id, paths: ['src/parser/lex.ts'] }), /reserved by other work: src\/parser\/lex\.ts \(src\/parser\/, held by ses_fixture\/main/);
    assert.equal((call(b, { action: 'show', id: two.id }) as { status: string }).status, 'open', 'the refused claim left the item open');

    const across = call(c, { action: 'claim', id: three.id, paths: ['src/parser/lex.ts'] }) as { mergeRisks: { kind: string; laneRoot: string }[]; leases: { laneRoot: string; branch: string }[] };
    assert.deepEqual(across.mergeRisks.map((o) => [o.kind, o.laneRoot]), [['merge_risk', 'main']]);
    assert.deepEqual(across.leases.map((l) => [l.laneRoot, l.branch]), [['/tmp/repo-lane', 'feat/lane']]);

    const own = call(a, { action: 'check', paths: ['src/parser/lex.ts'] }) as { clear: boolean; mergeRisks: { workId: string }[] };
    assert.equal(own.clear, true, 'a claimant’s own reservations never stand in its way');
    const helper = call(a, { action: 'check', agent: 'helper', paths: ['src/parser/lex.ts'] }) as { clear: boolean };
    assert.equal(helper.clear, false, 'another agent of the same session is another writer');
    assert.equal((a.store.db.prepare(`SELECT COUNT(*) AS n FROM session_agents WHERE agent = 'helper'`).get() as { n: number }).n, 0, 'check records nothing');
    assert.deepEqual(own.mergeRisks.map((o) => o.workId), [three.id]);

    call(a, { action: 'complete', id: one.id, token: held.claimToken });
    const after = call(b, { action: 'claim', id: two.id, paths: ['src/parser/lex.ts'] }) as { leases: unknown[]; mergeRisks: unknown[] };
    assert.equal(after.leases.length, 1, 'completed work frees its paths');
    assert.equal(after.mergeRisks.length, 1, 'the worktree’s reservation is still a merge risk');
  } finally {
    fx.cleanup();
  }
});

test('paths outside the repository, too many paths, and check without paths are refused before anything is written', () => {
  const fx = brokerFixture();
  try {
    assert.throws(() => work.validate(record({ action: 'check', paths: ['/etc/passwd'] })), ToolInputError);
    assert.throws(() => work.validate(record({ action: 'check', paths: ['a/../../b'] })), ToolInputError);
    assert.throws(() => work.validate(record({ action: 'check', paths: [3] })), ToolInputError);
    assert.throws(() => work.validate(record({ action: 'check', paths: Array.from({ length: 201 }, (_, i) => `f${String(i)}`) })), /at most 200/);
    assert.throws(() => work.validate(record({ action: 'claim', id: 'x', mode: 'mine' })), ToolInputError);
    assert.throws(() => call(fx.broker, { action: 'check' }), /"paths" is required for check/);
  } finally {
    fx.cleanup();
  }
});
