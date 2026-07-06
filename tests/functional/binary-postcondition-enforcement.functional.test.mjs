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
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpRoot;
let priorCwd;
let priorHome;
let validateHandoff;

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'cx-binary-pc-'));
  mkdirSync(join(tmpRoot, '.cx'), { recursive: true });
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
  rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function readLog() {
  const file = join(tmpRoot, '.cx', 'contract-violations.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const CASES = [
  {
    producer: 'cx-reviewer',
    consumer: 'cx-engineer',
    invalidPacket: { findings: [] },
    expectFailureId: 'reviewer.findings-or-explicit-clear',
  },
  {
    producer: 'cx-security',
    consumer: 'cx-engineer',
    invalidPacket: { threatModelUpdatedAt: '2020-01-01T00:00:00.000Z', contractStart: '2026-01-01T00:00:00.000Z' },
    expectFailureId: 'security.threat-model-not-post-hoc',
  },
  {
    producer: 'cx-debugger',
    consumer: 'cx-engineer',
    invalidPacket: { rootCauseConfirmedVia: 'guess' },
    expectFailureId: 'debugger.root-cause-confirmed-via',
  },
  {
    producer: 'cx-operations',
    consumer: 'cx-engineer',
    invalidPacket: { crossDocCoherenceCheckRan: false },
    expectFailureId: 'docs-keeper.cross-doc-coherence-check-ran',
  },
  {
    producer: 'cx-designer',
    consumer: 'cx-engineer',
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
