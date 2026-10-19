import { workflowCandidates } from '../../../src/kernel/registry/workflow-domains.ts';
/**
 * tests/kernel/skills/packs.test.ts — every professional pack is a bundle of
 * obligations, doctrine with opened citations, procedure, templates, evals,
 * limits, and one workflow that consumes it. Never a persona.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSkillRegistry } from '../../../src/kernel/registry/skill-registry.ts';
import { createWorkflowRegistry } from '../../../src/kernel/registry/workflow-registry.ts';

export const PACKS = [
  'software-engineering',
  'system-architecture',
  'product-management',
  'experience-design',
  'program-delivery',
  'operations-reliability',
  'security-privacy',
  'strategy-research',
  'governance-risk',
] as const;

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
    for (const heading of [
      '## 1. Scope',
      '## 2. Obligations',
      '## 3. Doctrine',
      '## 4. Procedure',
      '## 5. Checks',
      '## 6. Limits and escalation',
    ]) {
      assert.ok(body.includes(heading), `${id} has ${heading}`);
    }
    assert.match(body, /[Ss]tand down/, `${id} says when to stand down`);
    assert.doesNotMatch(body, /\bpersona\b|you are a (senior|world-class|expert)|act as a/i, `${id} is not a persona prompt`);
    for (const file of ['references/sources.md', 'references/obligations.md']) {
      assert.ok(pack.files.includes(file), `${id} ships ${file}`);
    }
    assert.ok(!pack.files.some((f) => f.startsWith('evals/')), `${id} ships no evals; they are maintainer-local`);
    assert.ok(
      pack.files.some((f) => f.startsWith('assets/') && f.endsWith('.md')),
      `${id} ships a template`,
    );
    const sources = text(id, 'references/sources.md');
    assert.ok((sources.match(/^- /gm) ?? []).length >= 4, `${id} cites at least four sources`);
    for (const entry of sources.match(/^- .*$/gm) ?? []) {
      assert.match(entry, /Opened \d{4}-\d{2}-\d{2}: /, `${id}: every cited source says when it was opened and what was confirmed`);
    }
    assert.ok(pack.manifest.requiredValidators.length > 0, `${id} requires at least one validator wherever it is bound`);
    const consumer = workflowCandidates(workflows.list()).find((w) => w.manifest.steps.some((s) => s.skill?.id === id));
    assert.ok(consumer, `${id} is consumed by a workflow`);
  }
});

test('the governance pack never owns a licensed judgment and every pack refuses to invent doctrine', () => {
  const g = skills.get('governance-risk')!;
  assert.notEqual(g.manifest.maxTier, 'licensed_judgment', 'no step may apply it at licensed_judgment');
  assert.match(
    skills.body('governance-risk')!,
    /tax treatment, and audit opinions are licensed/,
    'the body names the licensed judgments it prepares and never gives',
  );
  assert.match(skills.body('governance-risk')!, /research and issue-spotting, not legal, tax, or financial\s+advice/i);
  for (const id of PACKS)
    assert.match(skills.body(id)!, /never\s+invent|do not\s+invent|not\s+invented/i, `${id} forbids invented doctrine`);
});
