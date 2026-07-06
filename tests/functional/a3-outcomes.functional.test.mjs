/**
 * tests/functional/a3-outcomes.functional.test.mjs — A3 end-to-end.
 *
 * Verifies the outcome capture loop closes:
 *   record -> per-role JSONL
 *   aggregate -> _summary.json
 *   outcomeBoost -> classifier tiebreaker that never inverts keyword winners
 *
 * Also confirms that the agent-tracker hook calls recordOutcome when it sees
 * a SubagentStop event (gap fix for "A3 had no production trigger").
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import { doctorRoot } from '../../lib/config/xdg.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const TRACKER = path.join(REPO, 'lib', 'hooks', 'agent-tracker.mjs');

test('A3 end-to-end: record -> aggregate -> classifier tiebreaker, capped and non-inverting', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a3-functional-'));
  const { recordOutcome } = await import('../../lib/outcomes/record.mjs');
  const { aggregateOutcomes, outcomeBoost } = await import('../../lib/outcomes/aggregate.mjs');
  const { classifyRdIntake } = await import('../../lib/intake/classify.mjs');

  for (let i = 0; i < 12; i++) recordOutcome(cwd, { role: 'engineer', success: true });
  for (let i = 0; i < 12; i++) recordOutcome(cwd, { role: 'debugger', success: false });
  aggregateOutcomes(cwd);

  const eng = outcomeBoost(cwd, 'engineer');
  const dbg = outcomeBoost(cwd, 'debugger');
  assert.ok(eng > 0 && eng <= 0.05);
  assert.ok(dbg < 0 && dbg >= -0.05);

  // Clear keyword winner for bug is still picked even with negative debugger boost.
  const triage = classifyRdIntake({
    sourcePath: 'bug.md',
    extractedText: 'crash stack trace exception fails broken regression error throws',
    cwd,
  });
  assert.equal(triage.intakeType, 'bug');
  assert.equal(triage.primaryOwner, 'debugger');

  rmTmpDir(cwd);
});

test('A3 production trigger: agent-tracker writes outcome JSONL on a Task SubagentStop event', () => {
  // The tracker writes BOTH the per-project outcome file (under args.cwd) AND
  // a global last-agent.json (under the doctor root) for fence coordination.
  // Redirect HOME so the test cannot poison the developer's real fence state
  // when run locally.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a3-tracker-'));
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'a3-tracker-home-'));
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });

  const payload = {
    tool_name: 'Task',
    tool_input: { subagent_type: 'cx-engineer', description: 'refactor the auth module to use OIDC' },
    tool_result: { result: 'Refactor completed. All tests pass. ✅' },
    cwd,
  };

  const result = spawnSync('node', [TRACKER], {
    cwd,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
  });
  assert.equal(result.status, 0, `tracker exited non-zero: ${result.stderr}`);

  const outFile = path.join(cwd, '.cx', 'outcomes', 'engineer.jsonl');
  assert.ok(fs.existsSync(outFile), 'outcome JSONL not written — agent-tracker is not wired to recordOutcome');
  const lines = fs.readFileSync(outFile, 'utf8').trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.role, 'engineer');
  assert.equal(entry.success, true);
  assert.equal(entry.source, 'agent-tracker');

  // The fence file should land in the FAKE home, not the developer's real home.
  assert.ok(fs.existsSync(path.join(doctorRoot(fakeHome), 'last-agent.json')),
    'last-agent.json should have been written under the fake HOME doctor root');

  rmTmpDir(cwd);
  rmTmpDir(fakeHome);
});
