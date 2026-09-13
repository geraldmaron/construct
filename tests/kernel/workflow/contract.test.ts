/**
 * tests/kernel/workflow/contract.test.ts — every shipped step's declared
 * outputs satisfy the validators bound to it, so following the instructions
 * is enough to pass.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowRegistry } from '../../../src/kernel/registry/workflow-registry.ts';
import { runValidators } from '../../../src/kernel/workflow/validators.ts';

const LIST_KEYS = new Set([
  'assumptions',
  'blockers',
  'findings',
  'changes',
  'escalations',
  'unknowns',
  'recordedIds',
  'decisionIds',
  'questionIds',
  'driftFindingIds',
  'lessonIds',
  'recordedFindingIds',
  'principles',
  'contradictions',
  'controls',
  'proposals',
  'questions',
  'claims',
]);

function stub(keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (LIST_KEYS.has(k)) out[k] = [];
    else if (k === 'passed' || k === 'noDrift') out[k] = true;
    else out[k] = 'ok';
  }
  return out;
}

test('submitting exactly the declared outputs of every shipped step passes its validators', () => {
  const workflows = createWorkflowRegistry({ projectDir: null });
  const evidence = [{ ref: 'docs/design.md' }];
  const refs = new Set(['docs/design.md']);
  const misses: string[] = [];
  for (const w of workflows.list()) {
    for (const step of w.manifest.steps) {
      const output = stub(step.outputs);
      const results = runValidators(step.validators, { output, expectedKeys: step.outputs, evidence, resolvableRefs: refs });
      for (const r of results) {
        if (!r.ok) misses.push(`${w.manifest.id}.${step.id} ${r.validator}: ${r.problems.join('; ')}`);
      }
    }
  }
  assert.equal(misses.length, 0, misses.join('\n'));
});
