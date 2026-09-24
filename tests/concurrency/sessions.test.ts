/**
 * tests/concurrency/sessions.test.ts — two sessions of the same host in one
 * project are two identities.
 *
 * Each server registers a session under an id Construct mints. A work claim
 * belongs to the session and agent that made it: a second session of the same
 * host is refused and cannot settle it without the token; when the holder's
 * server ends, its session ends and the claim can be taken over. What each
 * session does is recorded against that session, as relayed by the model.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { sterile } from '../harness/sterile.ts';
import { envFor, initProject, INITIALIZE, Session } from './support.ts';

test('two sessions of one host hold separate identities, and a claim is theirs alone', { timeout: 60_000 }, async () => {
  const fx = sterile();
  try {
    const { dir, db } = initProject(fx);
    const a = new Session(dir, envFor(fx, { CLAUDE_CODE_SESSION_ID: 'host-session-a' }));
    const b = new Session(dir, envFor(fx, { CLAUDE_CODE_SESSION_ID: 'host-session-b' }));
    try {
      await a.request('initialize', INITIALIZE);
      await b.request('initialize', INITIALIZE);
      const added = await a.ok('work', { action: 'add', title: 'shared item' });
      const claimed = await a.ok('work', { action: 'claim', id: added.id });
      assert.match(String(claimed.claimToken), /^[0-9a-f-]{36}$/);
      const holder = String(claimed.claimSession);
      assert.match(holder, /^ses_/);

      const stolen = await b.call('work', { action: 'claim', id: added.id });
      assert.equal(stolen.result?.isError, true);
      assert.match(String(stolen.result?.structuredContent?.error), new RegExp(`claimed by ${holder}/main`));
      const finished = await b.call('work', { action: 'complete', id: added.id });
      assert.equal(finished.result?.isError, true, 'another session cannot complete a live claim');
      const early = await b.call('work', { action: 'takeover', id: added.id, reason: 'impatient' });
      assert.equal(early.result?.isError, true, 'the holder is still active');

      await a.close();
      const taken = await b.ok('work', { action: 'takeover', id: added.id, reason: 'session a ended' });
      assert.notEqual(taken.claimSession, holder);
    } finally {
      await b.close();
    }
    const check = new DatabaseSync(db, { readOnly: true });
    try {
      const sessions = check.prepare('SELECT id, host, surface, host_session_id, host_session_source, client_name, ended_at FROM sessions ORDER BY started_at').all() as Array<Record<string, string | null>>;
      assert.equal(sessions.length, 2);
      assert.notEqual(sessions[0]!.id, sessions[1]!.id);
      assert.deepEqual(sessions.map((s) => s.host_session_id).sort(), ['host-session-a', 'host-session-b']);
      assert.ok(sessions.every((s) => s.host_session_source === 'CLAUDE_CODE_SESSION_ID' && s.client_name === 'test-host' && s.ended_at !== null));
      const acts = check.prepare(`SELECT actor, session_id, channel FROM activity_events WHERE kind = 'work.claimed'`).all() as Array<Record<string, string | null>>;
      assert.ok(acts.length >= 1);
      for (const act of acts) {
        assert.match(String(act.session_id), /^ses_/);
        assert.equal(act.channel, 'relay');
        assert.doesNotMatch(String(act.actor), /person/);
      }
    } finally {
      check.close();
    }
  } finally {
    fx.cleanup();
  }
});

test('nothing a session writes over MCP is recorded as the person', { timeout: 60_000 }, async () => {
  const fx = sterile();
  try {
    const { dir, db } = initProject(fx);
    const s = new Session(dir, envFor(fx));
    try {
      await s.request('initialize', INITIALIZE);
      const boot = await s.ok('bootstrap');
      const question = (boot.profile as { openQuestions: Array<{ id: string; options: string[] | null }> }).openQuestions.find((q) => q.options);
      if (question) await s.ok('decide', { decisionId: question.id, resolution: question.options![0] });
      await s.ok('remember', { kind: 'decision', text: 'We keep one store per project.' });
      const added = await s.ok('work', { action: 'add', title: 'attributed item' });
      const claimed = await s.ok('work', { action: 'claim', id: added.id, agent: 'helper' });
      await s.ok('work', { action: 'complete', id: added.id, token: claimed.claimToken, agent: 'helper' });
    } finally {
      await s.close();
    }
    const check = new DatabaseSync(db, { readOnly: true });
    try {
      const asPerson = check.prepare(`SELECT kind, actor, channel FROM activity_events WHERE session_id IS NOT NULL AND actor LIKE '%person%' AND (channel IS NULL OR channel <> 'tty_cli')`).all();
      assert.deepEqual(asPerson, [], 'no MCP-written row names the person without a person channel');
      const byHelper = check.prepare(`SELECT COUNT(*) AS n FROM activity_events WHERE agent = 'helper'`).get() as { n: number };
      assert.ok(byHelper.n >= 1, 'an agent that names itself is recorded on its rows');
      const agent = check.prepare(`SELECT attestation FROM session_agents WHERE agent = 'helper'`).get() as { attestation: string };
      assert.equal(agent.attestation, 'reported');
    } finally {
      check.close();
    }
  } finally {
    fx.cleanup();
  }
});

test('a server stopped by signal ends its session', { timeout: 60_000 }, async () => {
  const fx = sterile();
  try {
    const { dir, db } = initProject(fx);
    const s = new Session(dir, envFor(fx));
    await s.request('initialize', INITIALIZE);
    await s.ok('bootstrap');
    await s.kill('SIGTERM');
    const check = new DatabaseSync(db, { readOnly: true });
    try {
      const row = check.prepare('SELECT ended_at, end_reason FROM sessions').get() as { ended_at: string | null; end_reason: string | null };
      assert.ok(row.ended_at, 'the session ended');
    } finally {
      check.close();
    }
  } finally {
    fx.cleanup();
  }
});
