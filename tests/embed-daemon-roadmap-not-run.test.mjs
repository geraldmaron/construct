/**
 * tests/embed-daemon-roadmap-not-run.test.mjs — reportRoadmapNotRun()
 * (lib/embed/daemon.mjs, Job 10 "roadmap", construct-4uxq0.9.6).
 *
 * A daemon that stays silent whenever `!this.#lastSnapshot` or
 * generateRoadmap's own `{skipped: true}` result means the analysis did not
 * run is indistinguishable from one that ran and simply had nothing new to
 * report. reportRoadmapNotRun is the honest-reporting path both branches
 * call: a `type: 'warning'` notification carrying `meta.ran === false` plus
 * the real reason, verified here via the notification bus directly (no
 * daemon spin-up required — emitEmbedNotification only publishes an
 * in-process event, per lib/embed/notifications.mjs).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { reportRoadmapNotRun } from '../lib/embed/daemon.mjs';
import { onEmbedNotification } from '../lib/embed/notifications.mjs';

describe('reportRoadmapNotRun', () => {
  it('emits a ran:false warning distinguishable from a genuine zero-item roadmap', () => {
    const events = [];
    const unsubscribe = onEmbedNotification((event) => events.push(event));
    try {
      reportRoadmapNotRun('no snapshot available yet');
    } finally {
      unsubscribe();
    }

    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'warning');
    assert.equal(events[0].source, 'roadmap');
    assert.equal(events[0].meta.ran, false);
    assert.equal(events[0].meta.resultStatus, 'blocked');
    assert.equal(events[0].meta.error, 'no snapshot available yet');
    assert.match(events[0].message, /did not run/);
  });

  it('falls back to an explicit "unknown reason" when no reason is given', () => {
    const events = [];
    const unsubscribe = onEmbedNotification((event) => events.push(event));
    try {
      reportRoadmapNotRun();
    } finally {
      unsubscribe();
    }

    assert.equal(events.length, 1);
    assert.match(events[0].message, /unknown reason/);
    assert.equal(events[0].meta.error, null);
  });
});
