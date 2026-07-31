/**
 * tests/functional/orchestration-terminal-contract.functional.test.mjs.
 *
 * A permanent tripwire for the bug class where a run rests in a terminal shape that looks
 * done but carries no usable output. Every backend's shaped run must satisfy EXACTLY one of
 * three honest shapes — completed* with at least one non-empty task output, awaiting-host
 * with every task's materialized prompt present, or completed-prepare-only with the loud
 * PREPARE-ONLY message. A shaped run that is "completed" with all-empty outputs satisfies
 * none and is a contract violation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runOrchestration } from '../../lib/orchestration/runtime.mjs';
import { shapeRun } from '../../lib/mcp/tools/orchestration-run.mjs';

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { CONSTRUCT_MODEL_REASONING: MODEL, CONSTRUCT_MODEL_STANDARD: MODEL, CONSTRUCT_MODEL_FAST: MODEL };
const REQUEST = 'implement and verify a pagination feature for the results list';

const dirs = [];
function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-terminal-'));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-terminal-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

// A shaped run is valid iff it satisfies exactly one honest terminal/resting shape.

function terminalContract(shaped) {
  const s = shaped.status;
  const tasks = shaped.tasks || [];
  const completedWithOutput = ['completed', 'completed-with-failures', 'degraded'].includes(s)
    && tasks.some((t) => typeof t.output === 'string' && t.output.trim().length > 0);
  const prepareOnly = s === 'completed-prepare-only'
    && typeof shaped.message === 'string' && shaped.message.startsWith('PREPARE-ONLY');
  const awaitingHost = s === 'awaiting-host'
    && tasks.length > 0 && tasks.every((t) => typeof t.user === 'string' && t.user.length > 0);
  const matched = [completedWithOutput, prepareOnly, awaitingHost].filter(Boolean);
  return { valid: matched.length === 1, matched: matched.length, status: s };
}

test('inline backend rests in completed-prepare-only with the loud PREPARE-ONLY message', async () => {
  const cwd = project();
  const run = await runOrchestration(
    { request: REQUEST, requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: ENV, cwd, workerBackend: 'inline' },
  );
  const shaped = shapeRun(run);
  const contract = terminalContract(shaped);
  assert.equal(contract.valid, true, `inline must satisfy exactly one shape (matched ${contract.matched}, status ${contract.status})`);
  assert.equal(shaped.status, 'completed-prepare-only');
  assert.match(shaped.message, /^PREPARE-ONLY/);
});

test('provider backend rests in a completed shape with at least one non-empty task output', async () => {
  const cwd = project();
  let n = 0;
  const fetchImpl = async () => { n += 1; return { ok: true, json: async () => ({ content: [{ type: 'text', text: `SPECIALIST-OUTPUT-${n}: done.` }] }) }; };
  const run = await runOrchestration(
    { request: REQUEST, requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test' }, cwd, workerBackend: 'provider', fetchImpl },
  );
  const shaped = shapeRun(run);
  const contract = terminalContract(shaped);
  assert.equal(contract.valid, true, `provider must satisfy exactly one shape (matched ${contract.matched}, status ${contract.status})`);
  assert.ok(['completed', 'completed-with-failures', 'degraded'].includes(shaped.status));
  assert.ok(shaped.tasks.some((t) => t.output && t.output.trim().length > 0), 'a completed provider run must carry real output');
});

test('host backend rests in awaiting-host with every task materialized prompt present', async () => {
  const cwd = project();
  const run = await runOrchestration(
    { request: REQUEST, requestedStrategy: 'orchestrated', hostModel: MODEL, host: 'OpenCode', fileCount: 4, moduleCount: 2 },
    { env: ENV, cwd, workerBackend: 'host' },
  );
  const shaped = shapeRun(run);
  const contract = terminalContract(shaped);
  assert.equal(contract.valid, true, `host must satisfy exactly one shape (matched ${contract.matched}, status ${contract.status})`);
  assert.equal(shaped.status, 'awaiting-host');
  assert.ok(shaped.tasks.every((t) => typeof t.user === 'string' && t.user.length > 0), 'every awaiting-host task carries its materialized prompt');
});

test('a completed run with all-empty outputs is a contract violation', () => {
  const violating = { status: 'completed', message: null, tasks: [{ id: 't1', output: '' }, { id: 't2', output: null }] };
  const contract = terminalContract(violating);
  assert.equal(contract.valid, false, 'a terminal-looking run with no usable output must fail the contract');
  assert.equal(contract.matched, 0);
});
