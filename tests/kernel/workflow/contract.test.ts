/**
 * tests/kernel/workflow/contract.test.ts — every shipped step's declared
 * outputs satisfy the validators bound to it, so following the instructions
 * is enough to pass.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowRegistry } from '../../../src/kernel/registry/workflow-registry.ts';
import { createSkillRegistry } from '../../../src/kernel/registry/skill-registry.ts';
import { satisfies } from '../../../src/kernel/registry/semver.ts';
import { runValidators } from '../../../src/kernel/workflow/validators.ts';
import type { RefResolver } from '../../../src/kernel/project/evidence.ts';

/** Every cited file exists, Construct opened it, and it carries a decision section saying who decides by when. */
const DESIGN = '# Design\n\n## Decision\nLeadership decides by Friday.\n';
const resolve: RefResolver = (ref) =>
  ref.startsWith('deliverable:') ? { ref, kind: 'deliverable', provenance: 'witnessed' } : { ref, kind: 'file', provenance: 'witnessed', path: ref, text: DESIGN, size: DESIGN.length };

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
  'conflicts',
  'derivations',
]);

function stub(keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (LIST_KEYS.has(k)) out[k] = [];
    else if (k === 'verification') out[k] = { result: 'Inspected declared outputs against the cited design record.' };
    else if (k === 'passed' || k === 'noDrift') out[k] = true;
    else if (k === 'artifact') out[k] = 'docs/design.md';
    else if (k === 'location') out[k] = 'https://example.com/published';
    else if (k === 'revises') out[k] = 'deliverable:d-1';
    else out[k] = 'ok';
  }
  return out;
}

test('submitting exactly the declared outputs of every shipped step passes its validators', () => {
  const workflows = createWorkflowRegistry({ projectDir: null });
  // Two independent places, so a step that asks for more than one source can be satisfied by declared outputs alone.
  const evidence = [{ ref: 'docs/design.md' }, { ref: 'notes/review.md' }];
  const refs = new Set(['docs/design.md', 'notes/review.md']);
  const misses: string[] = [];
  for (const w of workflows.list()) {
    for (const step of w.manifest.steps) {
      const output = stub(step.outputs);
      const results = runValidators(step.validators, { output, expectedKeys: step.outputs, evidence, resolvableRefs: refs, resolve });
      for (const r of results) {
        if (!r.ok) misses.push(`${w.manifest.id}.${step.id} ${r.validator}: ${r.problems.join('; ')}`);
      }
    }
  }
  assert.equal(misses.length, 0, misses.join('\n'));
});

test('every shipped step names a skill range the shipped skill satisfies', () => {
  const workflows = createWorkflowRegistry({ projectDir: null });
  const skills = createSkillRegistry({ projectDir: null });
  const misses: string[] = [];
  for (const w of workflows.list()) {
    for (const step of w.manifest.steps) {
      if (!step.skill) continue;
      const shipped = skills.get(step.skill.id);
      if (!shipped) misses.push(`${w.manifest.id}.${step.id}: no shipped skill ${step.skill.id}`);
      else if (!satisfies(shipped.manifest.version, step.skill.range)) misses.push(`${w.manifest.id}.${step.id}: ${step.skill.id} ${shipped.manifest.version} is outside ${step.skill.range}`);
    }
  }
  assert.deepEqual(misses, []);
});
