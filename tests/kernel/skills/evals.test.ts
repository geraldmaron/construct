/**
 * tests/kernel/skills/evals.test.ts — every shipped skill carries activation
 * fixtures its own manifest can tell apart, and the operational skill
 * teaches the session what it must and nothing it must not.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSkillRegistry } from '../../../src/kernel/registry/skill-registry.ts';
import { validateEvalFile, runActivationEvals, scoreActivation } from '../../../src/kernel/skills/activation.ts';

const skills = createSkillRegistry({ projectDir: null });

test('every shipped skill names an eval file that validates and has both kinds of case', () => {
  assert.equal(skills.list().length, 8);
  for (const s of skills.list()) {
    assert.deepEqual(s.manifest.evals, ['evals/activation.json'], s.manifest.id);
    const raw = JSON.parse(new TextDecoder().decode(s.files.includes('evals/activation.json') ? skills.file(s.manifest.id, 'evals/activation.json')! : readFileSync(join(s.dir, 'evals', 'activation.json'))));
    const file = validateEvalFile(raw, `${s.manifest.id}/evals/activation.json`);
    assert.ok(file.cases.some((c) => c.judge === 'model'), `${s.manifest.id} keeps at least one case only a model can judge`);
    assert.ok(s.files.includes('evals/activation.json'), 'the eval file is part of the digested bundle');
  }
});

test('the lexical judge agrees with every lexical case, and model cases are skipped, never passed silently', () => {
  for (const s of skills.list()) {
    const file = validateEvalFile(JSON.parse(new TextDecoder().decode(skills.file(s.manifest.id, 'evals/activation.json')!)), s.manifest.id);
    const results = runActivationEvals(s.manifest, file);
    const failures = results.filter((r) => !r.pass);
    assert.deepEqual(failures, [], `${s.manifest.id}: ${failures.map((f) => `"${f.text}" expected ${f.expect} got ${f.got}`).join('; ')}`);
    assert.ok(results.some((r) => r.got === 'skipped'));
  }
  const s = scoreActivation({ activation: ['review the migration plan'], standDown: ['fix a typo'] }, 'please fix a typo');
  assert.equal(s.verdict, 'stand_down');
  assert.equal(scoreActivation({ activation: ['x'], standDown: ['y'] }, 'nothing relevant').verdict, 'undecided');
});

test('the operational skill teaches the session what the directive requires and forbids', () => {
  const body = skills.body('construct')!;
  for (const must of ['bootstrap', 'Answer', 'Remember', 'Manage an outcome', 'Maintain a standing outcome', 'claim_work', 'submit_work', 'decide', 'Stand down', 'hand back', 'Do not spawn another agent', 'promote_deliverable', 'licensed']) {
    assert.ok(body.includes(must), `operational skill mentions ${must}`);
  }
  assert.doesNotMatch(body, /construct work|role-serve|MCP server|JSON-RPC/);
  assert.match(body, /Do not run Construct.s command line to do the\s+work/);
  const manifest = skills.get('construct')!.manifest;
  assert.equal(manifest.version, '2.0.0');
  assert.deepEqual(manifest.interactionClasses, ['answer', 'remember', 'manage', 'maintain']);
});
