/**
 * tests/functional/build-request-enforced-paper-trail.functional.test.mjs —
 * composed sterile test (construct-ifwhw.4): a "build X" request through a
 * multi-specialist chain with postconditions enforced IN-RUN, asserting the
 * unified audit record. Sibling of
 * tests/functional/prd-request-full-chain-audit-trail.functional.test.mjs
 * (construct-ifwhw.3, the PRD-request shape) — this suite covers the BUILD
 * shape and the construct-pteo2.14 in-run enforcement path that lands the
 * verdict as BLOCKED_CONTRACT (not just the observational CONTRACT_VIOLATION
 * that validateOutputPacket records post-hoc).
 *
 * A build request for an externally researched architecture routes through
 * the real Assignment chain. planRun decomposes it into researcher,
 * architect, engineer, reviewer, and QA Worker Profiles and resolves the
 * current `researcher-to-architect` capability contract from the request.
 * executeRun then runs every task with the `provider` worker backend and an
 * injected deterministic `fetchImpl` — the same no-network executor-injection
 * pattern proven in tests/orchestration-runtime.test.mjs and reused by
 * tests/functional/binary-postcondition-enforcement.functional.test.mjs's
 * in-run cases — no live LLM call, no API key, default CI.
 *
 * The synthetic violation is real against the capability contract: the
 * researcher Assignment is seeded with an output packet that omits `method`,
 * one of the contract's input.mustContain fields. enforceOutputHandoff
 * validates the physical packet at the producer-consumer boundary. A blocked handoff
 * marks the task `contractStatus: 'blocked-contract'`, degrades the run
 * (never bare completed), and appends a runId-tagged BLOCKED_CONTRACT record
 * to .construct/contract-violations.jsonl, which
 * lib/orchestration/build-audit-record.mjs (construct-ifwhw.1) joins with the
 * task chain and worker lifecycle trace events into one durable record.
 *
 * No overlap with binary-postcondition-enforcement's in-run cases: those pin
 * the PRD Procedure enforcement mechanics and stop at the violation log; this
 * suite composes the build chain end-to-end
 * into the unified audit record and its materialize/load round-trip.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { planRun, executeRun } from '../../lib/orchestration/runtime.mjs';
import { loadRun, saveRun } from '../../lib/orchestration/run-store.mjs';
import { buildAuditRecord, materializeAuditRecord, loadAuditRecord } from '../../lib/orchestration/build-audit-record.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const MODEL = 'anthropic/claude-sonnet-4-6';
const REQUEST_TEXT = 'implement rate limiting for the API gateway using external research and architecture review';
const CONTRACT_ID = 'researcher-to-architect';

const dirs = [];
function freshProject() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-build-chain-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-build-chain-home-'));
  dirs.push(cwd, home);
  return { cwd, home };
}
test.after(() => { for (const d of dirs) { try { rmTmpDir(d); } catch {} } });

function pinEnv(t, home) {
  const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
  const prevEmbedModel = process.env.CONSTRUCT_EMBEDDING_MODEL;
  process.env.CONSTRUCT_HOME_OVERRIDE = home;
  process.env.CONSTRUCT_EMBEDDING_MODEL = 'hashing';
  t.after(() => {
    if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
    if (prevEmbedModel === undefined) delete process.env.CONSTRUCT_EMBEDDING_MODEL;
    else process.env.CONSTRUCT_EMBEDDING_MODEL = prevEmbedModel;
  });
}

// Deterministic, no-network provider executor: a fixed Anthropic-shaped
// response body per call, distinguishable by an incrementing counter — the
// same injection shape the sibling PRD-chain suite uses, satisfying both the
// plain callAnthropic path and the provider-native web-search loop a
// web-capable role takes.

function makeFetchImpl() {
  let calls = 0;
  return async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: `specialist-output-${calls}: rate-limiting implementation and review input for the API gateway request.` }],
      }),
    };
  };
}

const ENV = {
  CONSTRUCT_MODEL_REASONING: MODEL,
  CONSTRUCT_MODEL_STANDARD: MODEL,
  CONSTRUCT_MODEL_FAST: MODEL,
  ANTHROPIC_API_KEY: 'sk-test-build-chain',
};

function readViolationLog(cwd) {
  const file = path.join(cwd, '.construct', 'contract-violations.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, stripUndefined(entry)]),
    );
  }
  return value;
}

// Canonical researcher-to-architect handoff fields. Synthetic fixture values
// describe only the deterministic run's paper trail, not product claims.

function conformingPacket() {
  return {
    question: 'which rate-limiting architecture fits the gateway boundary',
    method: 'compare primary protocol documentation with repository evidence',
    sources: 'primary protocol documentation and repository paths [unverified fixture]',
    findings: 'the gateway boundary is the narrowest integration seam [unverified fixture]',
    confidence: 'medium',
  };
}

test('a build request drives multiple Assignments with in-run BLOCKED_CONTRACT enforcement and a unified audit record', async (t) => {
  const { cwd, home } = freshProject();
  pinEnv(t, home);

  const planned = await planRun(
    { request: REQUEST_TEXT, requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 2, moduleCount: 1 },
    { env: ENV, cwd },
  );

  const assignedWorkerProfiles = new Set(planned.tasks.map((task) => task.workerProfileId));
  assert.ok(assignedWorkerProfiles.size >= 2, `a build request decomposes into multiple Assignments; got ${[...assignedWorkerProfiles].join(', ')}`);
  assert.ok(assignedWorkerProfiles.has('researcher'), 'the build chain includes the researcher producer');
  assert.ok(assignedWorkerProfiles.has('architect'), 'the build chain includes the architect consumer');
  const contractChainEntry = planned.plan.contractChain.find((c) => c.id === CONTRACT_ID);
  assert.ok(contractChainEntry, 'routeRequest resolved researcher-to-architect into this real build run, not an arbitrary choice');

  // Synthetic violation against the real contract: the seeded packet omits
  // method, so the in-run handoff check fails on one named field.
  const run = loadRun(cwd, planned.runId);
  const researcherTask = run.tasks.find((task) => task.workerProfileId === 'researcher');
  assert.ok(researcherTask, 'the planned chain carries a researcher Assignment to seed');
  researcherTask.outputContractId = CONTRACT_ID;
  const incomplete = conformingPacket();
  delete incomplete.method;
  researcherTask.outputPacket = incomplete;
  saveRun(cwd, run);

  const executed = await executeRun(cwd, planned.runId, { env: ENV, workerBackend: 'provider', fetchImpl: makeFetchImpl() });

  assert.ok(executed.tasks.every((task) => /^provider:anthropic:/.test(task.executor)), 'every task executed via the injected deterministic provider, not a live call');
  assert.ok(executed.tasks.every((task) => /^specialist-output-/.test(task.output)), 'every task carries real (deterministic) specialist output, not a prepared stub');

  const blockedTask = executed.tasks.find((task) => task.contractStatus === 'blocked-contract');
  assert.ok(blockedTask, `the seeded task carries blocked-contract; got ${JSON.stringify(executed.tasks.map((task) => ({ workerProfileId: task.workerProfileId, contractStatus: task.contractStatus ?? null })))}`);
  assert.equal(blockedTask.workerProfileId, 'researcher');
  assert.equal(blockedTask.contractId, CONTRACT_ID);
  assert.ok(blockedTask.contractViolations.some((v) => v.includes('method')), `the missing field is named, not silently dropped: ${JSON.stringify(blockedTask.contractViolations)}`);

  assert.equal(executed.degraded, true, 'the run degrades on a blocked contract');
  assert.equal(executed.degradationReason, 'blocked-contract');
  assert.equal(executed.status, 'degraded', 'terminal status never reads bare completed');

  const logged = readViolationLog(cwd).find((r) => r.contractId === CONTRACT_ID && r.verdict === 'BLOCKED_CONTRACT');
  assert.ok(logged, 'the blocked handoff landed a durable BLOCKED_CONTRACT record in .construct/contract-violations.jsonl');
  assert.equal(logged.runId, planned.runId, 'the durable record is runId-tagged');

  const record = buildAuditRecord(cwd, planned.runId);
  assert.ok(record, 'buildAuditRecord resolves a record for this real run');
  assert.equal(record.runId, planned.runId);
  assert.equal(record.status, 'degraded', 'the audit record carries the honest degraded terminal status');
  assert.equal(record.taskChain.length, executed.tasks.length, 'the paper trail links the full task chain, not a subset');
  assert.ok(record.taskChain.some((task) => task.workerProfileId === 'researcher'));
  assert.ok(record.taskChain.some((task) => task.workerProfileId === 'architect'));
  assert.ok(
    record.traceEvents.some((e) => e.eventType === 'worker.completed'),
    'the paper trail links real worker lifecycle trace events emitted during execution',
  );
  const gateVerdict = record.gateVerdicts.find((v) => v.contractId === CONTRACT_ID && v.verdict === 'BLOCKED_CONTRACT');
  assert.ok(gateVerdict, `the runId-scoped gate verdicts include the in-run BLOCKED_CONTRACT for ${CONTRACT_ID}: ${JSON.stringify(record.gateVerdicts)}`);
  assert.ok(gateVerdict.missing.some((v) => v.includes('method')), 'the gate verdict names the same missing field the task reported');

  const materialized = materializeAuditRecord(cwd, planned.runId);
  assert.equal(materialized.runId, planned.runId);

  const readBack = loadAuditRecord(cwd, planned.runId);
  assert.deepEqual(stripUndefined(readBack.taskChain), stripUndefined(materialized.taskChain), 'a fresh cross-process read of the persisted audit record matches what was written');
  assert.deepEqual(stripUndefined(readBack.gateVerdicts), stripUndefined(materialized.gateVerdicts));
  assert.deepEqual(stripUndefined(readBack.traceEvents), stripUndefined(materialized.traceEvents));
  assert.deepEqual(stripUndefined(readBack.artifactVerdicts), stripUndefined(materialized.artifactVerdicts));
});

test('the same build request with a conforming both-ends packet completes without a blocked verdict', async (t) => {
  const { cwd, home } = freshProject();
  pinEnv(t, home);

  const planned = await planRun(
    { request: REQUEST_TEXT, requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 2, moduleCount: 1 },
    { env: ENV, cwd },
  );

  const run = loadRun(cwd, planned.runId);
  const researcherTask = run.tasks.find((task) => task.workerProfileId === 'researcher');
  assert.ok(researcherTask, 'the planned chain carries a researcher Assignment to seed');
  researcherTask.outputContractId = CONTRACT_ID;
  researcherTask.outputPacket = conformingPacket();
  saveRun(cwd, run);

  const executed = await executeRun(cwd, planned.runId, { env: ENV, workerBackend: 'provider', fetchImpl: makeFetchImpl() });

  const checkedTask = executed.tasks.find((task) => task.contractId === CONTRACT_ID);
  assert.ok(checkedTask, 'the seeded task was checked in-run');
  assert.equal(checkedTask.contractStatus, 'ok', `a conforming both-ends packet passes: ${JSON.stringify(checkedTask.contractViolations ?? null)}`);
  assert.ok(executed.tasks.every((task) => task.contractStatus !== 'blocked-contract'), 'no task carries blocked-contract on the control run');
  assert.equal(executed.status, 'completed', 'a conforming chain completes cleanly');
  assert.notEqual(executed.degradationReason, 'blocked-contract');

  const blockedRecords = readViolationLog(cwd).filter((r) => r.contractId === CONTRACT_ID && r.verdict === 'BLOCKED_CONTRACT');
  assert.equal(blockedRecords.length, 0, 'no BLOCKED_CONTRACT record lands for the conforming control run');

  const record = buildAuditRecord(cwd, planned.runId);
  assert.ok(record, 'buildAuditRecord resolves for the control run too');
  assert.equal(record.gateVerdicts.filter((v) => v.verdict === 'BLOCKED_CONTRACT').length, 0, 'the control run audit record carries no blocked gate verdict');
});
