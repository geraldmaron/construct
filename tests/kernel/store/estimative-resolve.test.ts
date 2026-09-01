/**
 * tests/kernel/store/estimative-resolve.test.ts — resolutions and the
 * calibration report's n-floor discipline.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { assessRisk } from '../../../src/kernel/run/estimative.ts';
import {
  CALIBRATION_N_FLOOR,
  estimativeCalibrationReport,
  estimativeJudgmentsFor,
  judgmentBrier,
  raiseOverdueJudgmentDecisions,
  recordEstimativeJudgment,
  renderCalibrationReport,
  resolveEstimativeJudgment,
  unresolvedEstimativeJudgments,
} from '../../../src/kernel/store/estimative.ts';
import { getDecision, openDecisions } from '../../../src/kernel/store/decisions.ts';

const AT = '2026-09-01T12:00:00.000Z';

function judgment(claim: string, percent: number, horizon: string) {
  return assessRisk({
    claim,
    percent,
    confidence: {
      level: 'moderate',
      basis: {
        informationBase: 'fixture',
        analyticalRigour: 'fixture',
        complexityAndVolatility: 'fixture',
      },
    },
    resolution: 'the observation named in the fixture',
    horizon,
    referenceClass: null,
  });
}

test('a judgment resolves once; a second resolve throws', () => {
  const fixture = sterile();
  try {
    const store = openStore(join(fixture.root, 'construct.db'));
    try {
      recordEstimativeJudgment(
        store,
        { run: 'run-1', judgment: judgment('the cutover loses rows', 60, '2026-08-01') },
        AT,
      );
      const seq = estimativeJudgmentsFor(store)[0]!.seq;
      const first = resolveEstimativeJudgment(store, seq, 'happened', AT);
      assert.equal(first.outcome, 'happened');
      assert.throws(
        () => resolveEstimativeJudgment(store, seq, 'did_not_happen', AT),
        /already resolved/,
      );
    } finally {
      store.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test('overdue unresolved judgments raise one inbox decision each, once', () => {
  const fixture = sterile();
  try {
    const store = openStore(join(fixture.root, 'construct.db'));
    try {
      recordEstimativeJudgment(
        store,
        { run: 'run-1', judgment: judgment('rows are lost', 40, '2026-08-01') },
        '2026-07-01T00:00:00.000Z',
      );
      recordEstimativeJudgment(
        store,
        { run: 'run-1', judgment: judgment('still open', 55, '2099-01-01') },
        AT,
      );
      const first = raiseOverdueJudgmentDecisions(store, AT);
      assert.equal(first, 1);
      const open = openDecisions(store);
      assert.equal(open.length, 1);
      assert.match(open[0]!.id, /^judgment-resolve:/);
      assert.equal(raiseOverdueJudgmentDecisions(store, AT), 0, 'second sweep is a no-op');
      assert.equal(openDecisions(store).length, 1);
      assert.ok(getDecision(store, open[0]!.id));
    } finally {
      store.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test('within N days horizons become overdue from recorded_at', () => {
  const fixture = sterile();
  try {
    const store = openStore(join(fixture.root, 'construct.db'));
    try {
      recordEstimativeJudgment(
        store,
        { run: 'run-1', judgment: judgment('relative horizon', 50, 'within 7 days') },
        '2026-08-01T00:00:00.000Z',
      );
      const rows = unresolvedEstimativeJudgments(store, '2026-08-10T00:00:00.000Z');
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.overdue, true);
    } finally {
      store.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test('calibration refuses a Brier rate below the §1 n-floor and states the derivation', () => {
  const fixture = sterile();
  try {
    const store = openStore(join(fixture.root, 'construct.db'));
    try {
      recordEstimativeJudgment(
        store,
        { run: 'run-1', judgment: judgment('one scored', 70, '2026-08-01') },
        AT,
      );
      const seq = estimativeJudgmentsFor(store)[0]!.seq;
      resolveEstimativeJudgment(store, seq, 'happened', AT);
      const report = estimativeCalibrationReport(store, AT);
      assert.equal(report.nFloor, CALIBRATION_N_FLOOR);
      assert.ok(report.nFloor >= 64);
      assert.equal(report.scoredTotal, 1);
      assert.equal(report.overallMeanBrier, null);
      const text = renderCalibrationReport(report);
      assert.match(text, /RESEARCH-DECISIONS §1/);
      assert.match(text, /not enough scored resolutions/);
      assert.equal(judgmentBrier(70, 'happened'), (0.7 - 1) * (0.7 - 1));
    } finally {
      store.close();
    }
  } finally {
    fixture.cleanup();
  }
});
