/**
 * tests/kernel/skills/behavior.test.ts — shipped operational and
 * adversarial-review skills pass their behavioral evals: stand-down,
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

test('construct and adversarial-review carry behavior evals that pass on the current digest', () => {
  for (const id of ['construct', 'adversarial-review']) {
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
});
