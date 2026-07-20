/**
 * tests/demo-state.test.mjs — demo state machine transitions and persistence.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertDemoTransition,
  attachDemoOutcome,
  DEMO_STATES,
  deriveDemoOk,
  loadDemoState,
  persistDemoState,
} from '../lib/demo-state.mjs';
import { rmTmpDir } from './helpers/cleanup.mjs';

test('DEMO_STATES defines the full 11-state vocabulary', () => {
  assert.deepEqual(DEMO_STATES, [
    'declared',
    'ready',
    'served',
    'executed',
    'recorded',
    'verified',
    'certified',
    'script-only',
    'degraded',
    'failed',
    'unavailable',
  ]);
});

test('deriveDemoOk is true only for recorded, verified, and certified', () => {
  assert.equal(deriveDemoOk('recorded'), true);
  assert.equal(deriveDemoOk('verified'), true);
  assert.equal(deriveDemoOk('certified'), true);
  assert.equal(deriveDemoOk('script-only'), false);
  assert.equal(deriveDemoOk('unavailable'), false);
  assert.equal(deriveDemoOk('served'), false);
  assert.equal(deriveDemoOk('degraded'), false);
  assert.equal(deriveDemoOk('failed'), false);
});

test('invalid transitions are rejected when enforcement is enabled', () => {
  const gate = assertDemoTransition('declared', 'certified');
  assert.equal(gate.ok, false);
  assert.equal(gate.invalidTransition, true);
  assert.equal(assertDemoTransition('executed', 'recorded').ok, true);
});

test('persistDemoState writes durable state artifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-state-'));
  try {
    const first = persistDemoState('quickstart', {
      cwd: dir,
      state: 'declared',
      enforceTransition: false,
    });
    assert.equal(first.ok, true);
    assert.ok(fs.existsSync(first.statePath));

    const second = persistDemoState('quickstart', {
      cwd: dir,
      state: 'ready',
      enforceTransition: true,
    });
    assert.equal(second.ok, true);

    const loaded = loadDemoState('quickstart', { cwd: dir });
    assert.equal(loaded.state, 'ready');
    assert.ok(loaded.history.length >= 2);
  } finally {
    rmTmpDir(dir);
  }
});

test('attachDemoOutcome derives ok:false for script-only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-state-'));
  try {
    const result = attachDemoOutcome(
      { surface: 'script', message: 'Printed demo script (all surfaces unavailable)' },
      { cwd: dir, name: 'agentic', state: 'script-only', persist: true },
    );
    assert.equal(result.state, 'script-only');
    assert.equal(result.ok, false);
    assert.equal(loadDemoState('agentic', { cwd: dir }).state, 'script-only');
  } finally {
    rmTmpDir(dir);
  }
});
