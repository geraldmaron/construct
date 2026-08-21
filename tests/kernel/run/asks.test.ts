/**
 * tests/kernel/run/asks.test.ts — the declared-ask shape: both lines or no
 * ask, markdown decoration tolerated, the framing carries the question and
 * the reversible default as the two sides, open asks read back with that
 * default attached, and answered asks read back in resolution order.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { answeredAsksFor, frameAsk, isAsk, openAsksFor, parseAsk } from '../../../src/kernel/run/asks.ts';
import { raiseDecision, resolveDecision } from '../../../src/kernel/store/decisions.ts';

const AT = '2026-08-10T00:00:00.000Z';

test('both lines make an ask; either alone makes none', () => {
  const both = parseAsk('work...\nASK: Which regions launch first?\nASSUMING: EU only.');
  assert.deepEqual(both, { question: 'Which regions launch first?', assuming: 'EU only.' });

  assert.equal(parseAsk('ASK: Which regions?'), null, 'a question with no default is refused');
  assert.equal(parseAsk('ASSUMING: EU only.'), null);
  assert.equal(parseAsk('no declaration at all'), null);
  assert.equal(parseAsk(undefined), null);
});

test('markdown decoration around the lines does not hide the ask', () => {
  const decorated = parseAsk('**ASK:** Which regions launch first?\n- ASSUMING: EU only.');
  assert.equal(decorated?.question, 'Which regions launch first?');
  assert.equal(decorated?.assuming, 'EU only.');
});

test('the framing is the question and the standing default, in the asking role name', () => {
  const decision = frameAsk({
    run: 'run-1',
    task: 't-privacy',
    role: 'privacy',
    ask: { question: 'Which regions launch first?', assuming: 'EU only' },
    at: AT,
  });
  assert.equal(decision.id, 't-privacy:ask');
  assert.match(decision.question, /privacy role needs a fact only you can give/);
  assert.equal(decision.positions.length, 2);
  assert.equal(decision.positions[0]?.role, 'privacy');
  assert.match(decision.positions[1]?.stance ?? '', /reversible default if you do nothing/);
});

test('an open ask reads back with the default that is already carrying the work', () => {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    raiseDecision(
      store,
      frameAsk({
        run: 'run-1',
        task: 't-privacy',
        role: 'privacy',
        ask: { question: 'Which regions launch first?', assuming: 'EU only' },
        at: AT,
      }),
    );
    // A conflict decision in the same inbox is not an ask and must not be read
    // as one: the user owes it a judgment, not a fact.
    raiseDecision(store, {
      id: 'conflict-1',
      run: 'run-1',
      question: 'Ship now or wait?',
      positions: [
        { role: 'privacy', stance: 'wait', citation: null },
        { role: 'program-sequencing', stance: 'ship', citation: null },
      ],
      raisedAt: AT,
    });

    const open = openAsksFor(store);
    assert.equal(open.length, 1, 'only the ask is an ask');
    assert.equal(open[0]?.id, 't-privacy:ask');
    assert.equal(open[0]?.run, 'run-1');
    assert.equal(open[0]?.role, 'privacy');
    // The question alone would read as a stalled deliverable; the default is
    // what says the work already shipped.
    assert.match(open[0]?.standingDefault ?? '', /EU only/);
    assert.deepEqual(openAsksFor(store, 'run-2'), [], 'scoping to another run finds none');

    resolveDecision(store, 't-privacy:ask', 'EU and UK', AT);
    assert.deepEqual(openAsksFor(store), [], 'an answered ask is no longer waiting');
  } finally {
    store.close();
    fixture.cleanup();
  }
});

test('the ask suffix is the only thing that makes an inbox item an ask', () => {
  assert.equal(isAsk('t-privacy:ask'), true);
  assert.equal(isAsk('conflict-1'), false);
  assert.equal(isAsk('t-privacy:asked'), false);
});

test('answered asks read back with role, question, and the resolution as given', () => {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    raiseDecision(
      store,
      frameAsk({
        run: 'run-1',
        task: 't-privacy',
        role: 'privacy',
        ask: { question: 'Which regions launch first?', assuming: 'EU only' },
        at: AT,
      }),
    );
    assert.deepEqual(answeredAsksFor(store, 'run-1'), [], 'open is not answered');

    resolveDecision(store, 't-privacy:ask', 'EU and UK, US waits for tax review', AT);
    const answered = answeredAsksFor(store, 'run-1');
    assert.equal(answered.length, 1);
    assert.equal(answered[0]?.role, 'privacy');
    assert.equal(answered[0]?.answer, 'EU and UK, US waits for tax review');
  } finally {
    store.close();
    fixture.cleanup();
  }
});
