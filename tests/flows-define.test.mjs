/**
 * tests/flows-define.test.mjs — flow-load validation.
 *
 * Pins that defineFlow() rejects a malformed definition (dangling startStep,
 * unknown waitFor predecessor) and enforces the fan-out restriction — a
 * mutating step cannot declare fanOut, and a fan-out step must name a
 * synthesis step that exists — as a load-time error, not a runtime
 * convention. Also pins loadFlow() for both a JS module source (behavior
 * inline) and a JSON source (behavior supplied via `handlers`).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { defineFlow, loadFlow } from '../lib/flows/define.mjs';
import { FlowDefinitionError } from '../lib/flows/errors.mjs';
import { andJoin } from '../lib/flows/joins.mjs';

const stateSchema = { type: 'object', properties: { value: { type: 'integer' } } };

function baseStep(overrides = {}) {
  return { workerBackend: 'inline', run: () => ({ state: {} }), ...overrides };
}

test('defineFlow accepts a minimal valid definition and fills in defaults', () => {
  const flow = defineFlow({
    stateSchema,
    startStep: 'a',
    steps: { a: baseStep() },
  });
  assert.equal(flow.startStep, 'a');
  assert.deepEqual(flow.stepOrder, ['a']);
  assert.equal(flow.steps.a.inputs.length, 0);
  assert.equal(flow.steps.a.fanOut, false);
});

test('defineFlow rejects a startStep that is not a declared step', () => {
  assert.throws(
    () => defineFlow({ stateSchema, startStep: 'missing', steps: { a: baseStep() } }),
    FlowDefinitionError,
  );
});

test('defineFlow rejects a step missing a run function', () => {
  assert.throws(() => defineFlow({ stateSchema, startStep: 'a', steps: { a: { workerBackend: 'inline' } } }), (err) => {
    assert.ok(err instanceof FlowDefinitionError);
    assert.ok(err.errors.some((e) => /run must be a function/.test(e)));
    return true;
  });
});

test('defineFlow rejects waitFor referencing an unknown predecessor', () => {
  assert.throws(() => defineFlow({
    stateSchema,
    startStep: 'a',
    steps: {
      a: baseStep(),
      b: baseStep({ waitFor: andJoin(['ghost']) }),
    },
  }), FlowDefinitionError);
});

test('defineFlow rejects a mutating step declaring fanOut', () => {
  assert.throws(() => defineFlow({
    stateSchema,
    startStep: 'fan',
    steps: {
      fan: baseStep({ fanOut: true, synthesis: 'join', router: () => ['a'] }),
      a: baseStep(),
      join: baseStep(),
    },
  }), (err) => {
    assert.ok(err instanceof FlowDefinitionError);
    assert.ok(err.errors.some((e) => /fanOut requires readOnly/.test(e)));
    return true;
  });
});

test('defineFlow rejects a fanOut step with no synthesis target', () => {
  assert.throws(() => defineFlow({
    stateSchema,
    startStep: 'fan',
    steps: { fan: baseStep({ fanOut: true, readOnly: true, router: () => ['fan'] }) },
  }), (err) => {
    assert.ok(err instanceof FlowDefinitionError);
    assert.ok(err.errors.some((e) => /requires a synthesis step name/.test(e)));
    return true;
  });
});

test('defineFlow rejects a fanOut step whose synthesis target does not exist', () => {
  assert.throws(() => defineFlow({
    stateSchema,
    startStep: 'fan',
    steps: { fan: baseStep({ fanOut: true, readOnly: true, synthesis: 'ghost', router: () => [] }) },
  }), (err) => {
    assert.ok(err instanceof FlowDefinitionError);
    assert.ok(err.errors.some((e) => /synthesis references unknown step/.test(e)));
    return true;
  });
});

test('defineFlow accepts a read-only fanOut step with a real synthesis target', () => {
  const flow = defineFlow({
    stateSchema,
    startStep: 'fan',
    steps: {
      fan: baseStep({ fanOut: true, readOnly: true, synthesis: 'join', router: () => ['a', 'b'] }),
      a: baseStep({ router: () => 'join' }),
      b: baseStep({ router: () => 'join' }),
      join: baseStep({ waitFor: andJoin(['a', 'b']) }),
    },
  });
  assert.equal(flow.steps.fan.fanOut, true);
  assert.equal(flow.steps.fan.synthesis, 'join');
});

test('loadFlow imports a JS module flow with inline run/router functions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-flow-'));
  const file = path.join(dir, 'flow.mjs');
  fs.writeFileSync(file, `
    export default {
      stateSchema: { type: 'object', properties: { value: { type: 'integer' } } },
      startStep: 'a',
      steps: { a: { workerBackend: 'inline', run: () => ({ state: { value: 1 } }) } },
    };
  `);
  const flow = await loadFlow(file);
  assert.equal(flow.startStep, 'a');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('loadFlow parses a JSON flow and merges run/router from handlers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-flow-'));
  const file = path.join(dir, 'flow.json');
  fs.writeFileSync(file, JSON.stringify({
    stateSchema: { type: 'object', properties: { value: { type: 'integer' } } },
    startStep: 'a',
    steps: { a: { workerBackend: 'inline' } },
  }));
  const flow = await loadFlow(file, { handlers: { a: { run: () => ({ state: { value: 2 } }) } } });
  assert.equal(flow.steps.a.workerBackend, 'inline');
  assert.equal(typeof flow.steps.a.run, 'function');
  fs.rmSync(dir, { recursive: true, force: true });
});
