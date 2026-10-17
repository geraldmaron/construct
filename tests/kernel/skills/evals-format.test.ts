/**
 * tests/kernel/skills/evals-format.test.ts — every shipped skill carries its
 * evals in the Agent Skills shape (agentskills.io, "Evaluating skill output
 * quality" and "Optimizing skill descriptions"): evals/evals.json with output
 * cases and assertions, and evals/trigger-queries.json with should-trigger and
 * near-miss queries on a fixed train/validation split. This checks shape only;
 * running them against a host is scripts/run-skill-evals.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSkillRegistry } from '../../../src/kernel/registry/skill-registry.ts';

const skills = createSkillRegistry({ projectDir: null });
const read = (id: string, file: string): unknown => {
  const bytes = skills.file(id, file);
  assert.ok(bytes, `${id} ships ${file}`);
  return JSON.parse(new TextDecoder().decode(bytes));
};

test('every skill ships evals/evals.json with realistic prompts, expected outputs and checkable assertions', () => {
  assert.ok(skills.list().length > 0);
  for (const skill of skills.list()) {
    const id = skill.manifest.id;
    const file = read(id, 'evals/evals.json') as { skill_name: string; evals: Record<string, unknown>[] };
    assert.equal(file.skill_name, id, `${id}: skill_name names the skill`);
    assert.ok(Array.isArray(file.evals) && file.evals.length >= 3 && file.evals.length <= 8, `${id}: 3 to 8 cases`);
    const ids = new Set<unknown>();
    for (const c of file.evals) {
      assert.deepEqual(Object.keys(c).sort(), ['assertions', 'expected_output', 'files', 'id', 'prompt'], `${id}: case keys`);
      assert.ok(Number.isInteger(c.id) && !ids.has(c.id), `${id}: case ids are distinct integers`);
      ids.add(c.id);
      assert.ok(typeof c.prompt === 'string' && c.prompt.length >= 20, `${id}#${String(c.id)}: a realistic prompt`);
      assert.ok(typeof c.expected_output === 'string' && c.expected_output.length >= 20, `${id}#${String(c.id)}: expected output`);
      assert.ok(Array.isArray(c.files), `${id}#${String(c.id)}: files is a list`);
      for (const f of c.files as string[]) assert.ok(skills.file(id, f), `${id}#${String(c.id)}: ${f} ships with the skill`);
      const assertions = c.assertions as string[];
      assert.ok(Array.isArray(assertions) && assertions.length >= 2, `${id}#${String(c.id)}: at least two assertions`);
      for (const a of assertions) assert.ok(typeof a === 'string' && a.length >= 10, `${id}#${String(c.id)}: assertion text`);
    }
  }
});

test('every skill ships twenty trigger queries, balanced, on a fixed 12/8 train/validation split', () => {
  for (const skill of skills.list()) {
    const id = skill.manifest.id;
    const queries = read(id, 'evals/trigger-queries.json') as { query: string; should_trigger: boolean; split: string }[];
    assert.equal(queries.length, 20, `${id}: twenty queries`);
    const count = (split: string, should: boolean) => queries.filter((q) => q.split === split && q.should_trigger === should).length;
    assert.deepEqual(
      [count('train', true), count('train', false), count('validation', true), count('validation', false)],
      [6, 6, 4, 4],
      `${id}: balanced split`,
    );
    const seen = new Set<string>();
    for (const q of queries) {
      assert.deepEqual(Object.keys(q).sort(), ['query', 'should_trigger', 'split'], `${id}: query keys`);
      assert.ok(typeof q.query === 'string' && q.query.length >= 10, `${id}: a realistic query`);
      assert.ok(!seen.has(q.query), `${id}: no repeated query`);
      seen.add(q.query);
    }
  }
});

test('no skill ships the retired bespoke eval formats', () => {
  for (const skill of skills.list()) {
    for (const retired of ['evals/fixtures.json', 'evals/behavior.json']) {
      assert.ok(!skill.files.includes(retired), `${skill.manifest.id} still ships ${retired}`);
    }
  }
});
