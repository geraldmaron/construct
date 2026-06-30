/**
 * tests/asset-quality/completion-evidence.test.mjs — Evidence objects and the no-forgery ledger.
 *
 * Proves the core E9-2 invariants: a completion state cannot be recorded without a valid evidence
 * object, a degraded evidence entry documents the miss without lifting the ladder, and the
 * workflow report carries a deterministic completion ledger (no wall-clock) so identical runs stay
 * byte-equal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  makeEvidence,
  recordCompletion,
  highestState,
  DEGRADATION_REASONS,
} from '../../lib/artifact-completion.mjs';
import { runArtifactWorkflow } from '../../lib/artifact-workflow.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('makeEvidence rejects an unknown state, unknown degradation, and missing actor', () => {
  assert.throws(() => makeEvidence('shipped', { actor: 'x' }), /unknown completion state/);
  assert.throws(() => makeEvidence('exported', { actor: 'x', degradation: 'gremlins' }), /unknown degradation/);
  assert.throws(() => makeEvidence('exported', { actor: '' }), /non-empty actor/);
});

test('makeEvidence freezes the evidence and defaults the timestamp to null', () => {
  const evidence = makeEvidence('exported', { actor: 'construct-export', artifact: 'out.pdf' });
  assert.equal(evidence.state, 'exported');
  assert.equal(evidence.timestamp, null);
  assert.equal(Object.isFrozen(evidence), true);
  assert.ok(DEGRADATION_REASONS.includes('missing-dependency'));
});

test('recordCompletion is the only door: a non-evidence value throws', () => {
  assert.throws(() => recordCompletion([], null), /valid evidence object/);
  assert.throws(() => recordCompletion([], { state: 'shipped' }), /valid evidence object/);
  const ledger = recordCompletion([], makeEvidence('exported', { actor: 'construct-export' }));
  assert.equal(ledger.length, 1);
});

test('a degraded entry is recorded but never lifts the achieved state', () => {
  let ledger = recordCompletion([], makeEvidence('exported', { actor: 'construct-export' }));
  ledger = recordCompletion(ledger, makeEvidence('visually-reviewed', {
    actor: 'construct-render',
    degradation: 'unavailable-renderer',
  }));
  assert.equal(ledger.length, 2);
  assert.equal(highestState(ledger), 'exported');
});

test('highestState returns the max-rank non-degraded rung, or null when none qualifies', () => {
  assert.equal(highestState([]), null);
  const ledger = [
    makeEvidence('exported', { actor: 'a' }),
    makeEvidence('file-valid', { actor: 'a' }),
    makeEvidence('renderable', { actor: 'a' }),
  ];
  assert.equal(highestState(ledger), 'renderable');
});

test('the workflow report carries a deterministic completion ledger', () => {
  const request = { input: 'Review and rewrite this ADR as a customer PDF.' };
  const first = runArtifactWorkflow(request, { rootDir: REPO, cwd: REPO });
  const second = runArtifactWorkflow(request, { rootDir: REPO, cwd: REPO });
  assert.deepEqual(first, second);
  assert.deepEqual(first.completion, []);
  assert.equal(first.completionState, null);
});
