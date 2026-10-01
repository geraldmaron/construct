/**
 * tests/kernel/skills/behavior.test.ts — operational, adversarial-review, and
 * professional packs pass their behavioral evals: stand-down, activate,
 * unknown-not-invented, and authority boundary.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSkillRegistry } from '../../../src/kernel/registry/skill-registry.ts';
import { evaluateBehaviorCase, validateBehaviorFile } from '../../../src/kernel/skills/behavior.ts';
import type { RoutableSkill } from '../../../src/kernel/skills/routing.ts';

const skills = createSkillRegistry({ projectDir: null });

function catalog(): RoutableSkill[] {
  return skills.list().map((s) => ({
    id: s.manifest.id,
    description: s.description,
    activation: s.manifest.activation,
    standDown: s.manifest.standDown,
    examples: s.examples,
  }));
}

function assertBehavior(id: string): void {
  const s = skills.get(id)!;
  assert.ok(s.files.includes('evals/behavior.json'), id);
  const raw = JSON.parse(new TextDecoder().decode(skills.file(id, 'evals/behavior.json')!));
  const file = validateBehaviorFile(raw, `${id}/evals/behavior.json`);
  const kinds = new Set(file.cases.map((c) => c.kind));
  assert.ok(kinds.has('stand_down'), id);
  assert.ok(kinds.has('forbids_invention'), id);
  assert.ok(kinds.has('authority_boundary'), id);
  const body = skills.body(id)!;
  for (const c of file.cases) {
    const result = evaluateBehaviorCase({ skill: s, body, catalog: catalog() }, c);
    assert.equal(result.ok, true, result.why);
  }
}

test('construct and adversarial-review carry behavior evals that pass on the current digest', () => {
  for (const id of ['construct', 'adversarial-review']) assertBehavior(id);
});

test('every professional pack carries behavior evals that pass on the current digest', () => {
  const professional = skills.list().filter((s) => s.manifest.category === 'professional').map((s) => s.manifest.id);
  assert.ok(professional.length >= 9, `expected professional packs, got ${professional.join(',')}`);
  for (const id of professional) assertBehavior(id);
});
