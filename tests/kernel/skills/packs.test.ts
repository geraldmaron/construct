/**
 * tests/kernel/skills/packs.test.ts — every professional pack is a bundle of
 * obligations, doctrine with citations, procedure, templates, fixtures,
 * evals, limits, and one workflow that consumes it. Never a persona.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSkillRegistry } from '../../../src/kernel/registry/skill-registry.ts';
import { createWorkflowRegistry } from '../../../src/kernel/registry/workflow-registry.ts';

export const PACKS = ['software-engineering', 'system-architecture', 'product-management', 'experience-design', 'program-delivery', 'operations-reliability', 'security-privacy', 'strategy-research', 'governance-risk'] as const;

const skills = createSkillRegistry({ projectDir: null });
const workflows = createWorkflowRegistry({ projectDir: null });
const text = (id: string, file: string) => new TextDecoder().decode(skills.file(id, file)!);

test('nine professional packs ship, each complete', () => {
  assert.deepEqual(skills.problems(), []);
  for (const id of PACKS) {
    const pack = skills.get(id);
    assert.ok(pack, `${id} is registered`);
    assert.equal(pack.manifest.category, 'professional');
    const body = skills.body(id)!;
    for (const heading of ['## 1. Scope', '## 2. Obligations', '## 3. Doctrine', '## 4. Procedure', '## 5. Checks', '## 6. Limits and escalation']) {
      assert.ok(body.includes(heading), `${id} has ${heading}`);
    }
    assert.match(body, /[Ss]tand down/, `${id} says when to stand down`);
    assert.doesNotMatch(body, /\bpersona\b|you are a (senior|world-class|expert)|act as a/i, `${id} is not a persona prompt`);
    for (const file of ['references/sources.md', 'references/obligations.md', 'evals/activation.json', 'evals/fixtures.json']) {
      assert.ok(pack.files.includes(file), `${id} ships ${file}`);
    }
    assert.ok(pack.files.some((f) => f.startsWith('assets/') && f.endsWith('.md')), `${id} ships a template`);
    const sources = text(id, 'references/sources.md');
    assert.ok((sources.match(/^- /gm) ?? []).length >= 4, `${id} cites at least four sources`);
    assert.match(sources, /verified: not opened in this build/i, `${id} says plainly its citations were not re-opened`);
    const fixtures = JSON.parse(text(id, 'evals/fixtures.json')) as { cases: { kind: string; input: string; expect: Record<string, unknown> }[] };
    const kinds = new Set(fixtures.cases.map((c) => c.kind));
    for (const k of ['positive', 'negative', 'edge', 'adversarial']) assert.ok(kinds.has(k), `${id} fixtures cover ${k}`);
    assert.ok(pack.manifest.licensedReviewBoundaries.length + pack.manifest.escalation.length > 0, `${id} states limits`);
    assert.ok(pack.manifest.qualityGates.length > 0, `${id} names a quality gate`);
    const consumer = workflows.list().find((w) => w.manifest.steps.some((s) => s.skill?.id === id));
    assert.ok(consumer, `${id} is consumed by a workflow`);
  }
  assert.equal(skills.list().length, 17);
});

test('the governance pack never owns a licensed judgment and every pack refuses to invent doctrine', () => {
  const g = skills.get('governance-risk')!;
  assert.ok(!g.manifest.actionTiers.includes('licensed_judgment'));
  assert.ok(g.manifest.licensedReviewBoundaries.length >= 3);
  assert.match(skills.body('governance-risk')!, /research and issue-spotting, not legal, tax, or financial\s+advice/i);
  for (const id of PACKS) assert.match(skills.body(id)!, /never\s+invent|do not\s+invent|not\s+invented/i, `${id} forbids invented doctrine`);
});
