/**
 * tests/functional/binary-postcondition-enforcement.functional.test.mjs
 *
 * Pins the wiring of binary postconditions into the workflow runtime path.
 * For each of the five producer roles with rules, two cases:
 *
 *   - invalid packet → ok:false, status: BLOCKED_CONTRACT, expected rule id
 *     surfaces in errors, and a record is appended to the violation log
 *     with verdict: BLOCKED_CONTRACT.
 *   - missing packet → ok:false, status: BLOCKED_CONTRACT, errors include
 *     the self-enforcing producer-has-rules-but-no-packet message.
 *
 * Runs against an isolated cwd/HOME so the violation log writes to a tmp
 * directory and prior chains are not perturbed.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmTmpDir } from '../helpers/cleanup.mjs';

let tmpRoot;
let priorCwd;
let priorHome;
let validateHandoff;

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'cx-binary-pc-'));
  mkdirSync(join(tmpRoot, '.construct'), { recursive: true });
  priorCwd = process.cwd();
  priorHome = process.env.HOME;
  process.env.HOME = tmpRoot;
  process.chdir(tmpRoot);
  const mod = await import(`../../lib/contracts/validate.mjs?cache=${Date.now()}`);
  ({ validateHandoff } = mod);
});

afterEach(() => {
  process.chdir(priorCwd);
  process.env.HOME = priorHome;
  rmTmpDir(tmpRoot);
});

function readLog() {
  const file = join(tmpRoot, '.construct', 'contract-violations.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const CASES = [
  {
    producer: 'reviewer',
    consumer: 'engineer',
    invalidPacket: { findings: [] },
    expectFailureId: 'reviewer.findings-or-explicit-clear',
  },
  {
    producer: 'security',
    consumer: 'engineer',
    invalidPacket: { threatModelUpdatedAt: '2020-01-01T00:00:00.000Z', contractStart: '2026-01-01T00:00:00.000Z' },
    expectFailureId: 'security.threat-model-not-post-hoc',
  },
  {
    producer: 'debugger',
    consumer: 'engineer',
    invalidPacket: { rootCauseConfirmedVia: 'guess' },
    expectFailureId: 'debugger.root-cause-confirmed-via',
  },
  {
    producer: 'operations',
    consumer: 'engineer',
    invalidPacket: { crossDocCoherenceCheckRan: false },
    expectFailureId: 'docs-keeper.cross-doc-coherence-check-ran',
  },
  {
    producer: 'designer',
    consumer: 'engineer',
    invalidPacket: { accessibilityCheckRan: false },
    expectFailureId: 'designer.accessibility-check-ran',
  },
];

describe('binary postcondition enforcement', () => {
  for (const c of CASES) {
    test(`${c.producer}: invalid packet is blocked and logged`, () => {
      const result = validateHandoff({
        producer: c.producer,
        consumer: c.consumer,
        artifact: {},
        packet: c.invalidPacket,
        repoRoot: tmpRoot,
      });
      assert.equal(result.ok, false, `expected ok:false for invalid ${c.producer} packet`);
      assert.equal(result.status, 'BLOCKED_CONTRACT');
      const hasExpected = result.errors.some((e) => e.includes(c.expectFailureId));
      assert.ok(hasExpected, `expected ${c.expectFailureId} in errors: ${JSON.stringify(result.errors)}`);

      const log = readLog();
      const matching = log.filter((r) => r.verdict === 'BLOCKED_CONTRACT' && (r.postconditionFailures || []).some((f) => f.id === c.expectFailureId));
      assert.ok(matching.length >= 1, `expected violation log record with verdict BLOCKED_CONTRACT and rule ${c.expectFailureId}`);
    });

    test(`${c.producer}: missing packet is blocked with self-enforcing error`, () => {
      const result = validateHandoff({
        producer: c.producer,
        consumer: c.consumer,
        artifact: {},
        repoRoot: tmpRoot,
      });
      assert.equal(result.ok, false);
      assert.equal(result.status, 'BLOCKED_CONTRACT');
      const hasSelfEnforcing = result.errors.some((e) => /has binary postconditions/.test(e) && e.includes(c.producer));
      assert.ok(hasSelfEnforcing, `expected self-enforcing error mentioning '${c.producer}': ${JSON.stringify(result.errors)}`);
    });
  }
});

// The run path calls the full validateHandoff pass on an Assignment's output
// handoff. A PRD Procedure handoff whose packet misses required fields produces
// BLOCKED_CONTRACT, degrades the run, and lands a runId-tagged durable record.

describe('in-run enforcement through the provider execution path', () => {
  test('a deliberately incomplete PRD handoff packet blocks in-run with a durable verdict', async () => {
    const { planRun, executeRun } = await import(`../../lib/orchestration/runtime.mjs?cache=${Date.now()}`);
    const { loadRun, saveRun } = await import(`../../lib/orchestration/run-store.mjs?cache=${Date.now()}`);

    const prevOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
    process.env.CONSTRUCT_HOME_OVERRIDE = tmpRoot;
    try {
      const MODEL = 'anthropic/claude-sonnet-4-6';
      const env = { CONSTRUCT_MODEL_REASONING: MODEL, CONSTRUCT_MODEL_STANDARD: MODEL, CONSTRUCT_MODEL_FAST: MODEL, ANTHROPIC_API_KEY: 'sk-test' };
      const planned = await planRun(
        { request: 'research user needs and write a PRD for the search feature', requestedStrategy: 'orchestrated', hostModel: MODEL },
        { env, cwd: tmpRoot },
      );

      const run = loadRun(tmpRoot, planned.runId);
      const productManager = run.tasks.find((t) => t.workerProfileId === 'product-manager');
      assert.ok(productManager, 'the PRD route includes a product-manager Assignment');
      productManager.outputContractId = 'product-manager-to-architect';
      productManager.outputPacket = { problem: 'observed problem statement' };
      saveRun(tmpRoot, run);

      const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'specialist output' }] }) });
      const executed = await executeRun(tmpRoot, planned.runId, { env, workerBackend: 'provider', fetchImpl });

      const blockedTask = executed.tasks.find((t) => t.contractStatus === 'blocked-contract');
      assert.ok(blockedTask, `an Assignment carries blocked-contract; got ${JSON.stringify(executed.tasks.map((t) => ({ workerProfileId: t.workerProfileId, contractStatus: t.contractStatus ?? null })))}`);
      assert.equal(blockedTask.contractId, 'product-manager-to-architect');
      assert.ok(blockedTask.contractViolations.some((v) => v.includes('functionalRequirements')), 'missing required field named');

      assert.equal(executed.degraded, true, 'run degrades on a blocked contract');
      assert.equal(executed.degradationReason, 'blocked-contract');
      assert.equal(executed.status, 'degraded', 'terminal status never reads bare completed');

      const log = readLog();
      const verdict = log.find((r) => r.contractId === 'product-manager-to-architect' && r.verdict === 'BLOCKED_CONTRACT');
      assert.ok(verdict, 'BLOCKED_CONTRACT recorded in .construct/contract-violations.jsonl');
      assert.equal(verdict.runId, planned.runId, 'the record is runId-tagged');
    } finally {
      if (prevOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
      else process.env.CONSTRUCT_HOME_OVERRIDE = prevOverride;
    }
  });

  test('a conforming handoff packet passes in-run with contractStatus ok', async () => {
    const { planRun, executeRun } = await import(`../../lib/orchestration/runtime.mjs?cache=${Date.now()}`);
    const { loadRun, saveRun } = await import(`../../lib/orchestration/run-store.mjs?cache=${Date.now()}`);

    const prevOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
    process.env.CONSTRUCT_HOME_OVERRIDE = tmpRoot;
    try {
      const MODEL = 'anthropic/claude-sonnet-4-6';
      const env = { CONSTRUCT_MODEL_REASONING: MODEL, CONSTRUCT_MODEL_STANDARD: MODEL, CONSTRUCT_MODEL_FAST: MODEL, ANTHROPIC_API_KEY: 'sk-test' };
      const planned = await planRun(
        { request: 'research user needs and write a PRD for the search feature', requestedStrategy: 'orchestrated', hostModel: MODEL },
        { env, cwd: tmpRoot },
      );

      const run = loadRun(tmpRoot, planned.runId);
      const productManager = run.tasks.find((t) => t.workerProfileId === 'product-manager');
      assert.ok(productManager, 'the PRD route includes a product-manager Assignment');
      productManager.outputContractId = 'product-manager-to-architect';
      productManager.outputPacket = {
        problem: 'observed problem statement grounded in interviews',
        functionalRequirements: 'bulk cross-reference view with export',
        nonFunctionalRequirements: 'audit exports complete without losing records',
        acceptanceCriteria: 'audit completion time is measured against a declared baseline',
        constraints: 'no live customer data leaves the audit boundary',
        valueStatement: 'reduce manual cross-referencing for enterprise administrators',
        tradeoffTable: 'accuracy over export throughput',
        prioritizationCall: 'validate the audit boundary before optimizing throughput',
      };
      saveRun(tmpRoot, run);

      const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'specialist output' }] }) });
      const executed = await executeRun(tmpRoot, planned.runId, { env, workerBackend: 'provider', fetchImpl });

      const checkedTask = executed.tasks.find((t) => t.contractId === 'product-manager-to-architect');
      assert.ok(checkedTask, 'the seeded task was checked in-run');
      assert.equal(checkedTask.contractStatus, 'ok', `conforming packet passes: ${JSON.stringify(checkedTask.contractViolations ?? null)}`);
      assert.notEqual(executed.degradationReason, 'blocked-contract');
    } finally {
      if (prevOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
      else process.env.CONSTRUCT_HOME_OVERRIDE = prevOverride;
    }
  });
});
