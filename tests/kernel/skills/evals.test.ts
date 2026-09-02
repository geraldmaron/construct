/**
 * tests/kernel/skills/evals.test.ts — every shipped skill carries labeled
 * activation cases, the router orders skills well enough for a reader to
 * find the right one near the top without knowing its name, and the
 * operational skill teaches the session what it must and nothing it must not.
 *
 * The floors below are measured values, not aspirations: the router is a
 * ranking aid for the host model, which is the judge. Raising a floor needs
 * a measurement; lowering one needs a reason recorded with the change.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSkillRegistry } from '../../../src/kernel/registry/skill-registry.ts';
import { createRouter, measureRouting, validateEvalFile, validateRoutingEvalFile, type RoutableSkill } from '../../../src/kernel/skills/routing.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const skills = createSkillRegistry({ projectDir: null });

function routable(exclude?: string): RoutableSkill[] {
  return skills.list().map((s) => ({ id: s.manifest.id, description: s.description, activation: s.manifest.activation, standDown: s.manifest.standDown, examples: s.examples.filter((e) => e !== exclude) }));
}

test('every shipped skill names an eval file that validates, has both kinds of case, and feeds the router', () => {
  assert.equal(skills.list().length, 17);
  for (const s of skills.list()) {
    assert.ok(s.manifest.evals.includes('evals/activation.json'), s.manifest.id);
    assert.ok(s.files.includes('evals/activation.json'), 'the eval file is part of the digested bundle');
    const file = validateEvalFile(JSON.parse(new TextDecoder().decode(skills.file(s.manifest.id, 'evals/activation.json')!)), `${s.manifest.id}/evals/activation.json`);
    assert.ok(file.cases.filter((c) => c.expect === 'activate').length >= 4, `${s.manifest.id} carries at least four activating examples`);
    assert.deepEqual(s.examples, file.cases.filter((c) => c.expect === 'activate').map((c) => c.text));
  }
});

test('on natural requests that borrow no skill vocabulary, the router puts the right skill near the top', () => {
  const file = validateRoutingEvalFile(JSON.parse(readFileSync(join(ROOT, 'skills', 'evals', 'routing.json'), 'utf8')), 'skills/evals/routing.json');
  const m = measureRouting(createRouter(routable()), file.cases);
  const report = `top1 ${String(m.top1)}/${String(m.cases)}, top3 ${String(m.top3)}, top5 ${String(m.top5)}, false loads ${String(m.falseLoads)}/${String(m.noneCases)}\n${m.misses.map((x) => `  ${x.skill} -> ${x.got.join(',')} :: ${x.text}`).join('\n')}`;
  assert.ok(m.top1 / m.cases >= 0.35, report);
  assert.ok(m.top5 / m.cases >= 0.75, report);
  assert.ok(new Set(file.cases.map((c) => c.skill)).size >= 18, 'every skill and "none" are represented');
});

test('each activating example is ranked first or near it by a router that has never seen it', () => {
  let top1 = 0;
  let top3 = 0;
  let n = 0;
  const misses: string[] = [];
  for (const s of skills.list()) {
    for (const example of s.examples) {
      n += 1;
      const ranked = createRouter(routable(example)).route(example).map((r) => r.id);
      if (ranked[0] === s.manifest.id) top1 += 1;
      else misses.push(`${s.manifest.id} -> ${ranked.slice(0, 3).join(',')} :: ${example}`);
      if (ranked.slice(0, 3).includes(s.manifest.id)) top3 += 1;
    }
  }
  const report = `leave-one-out top1 ${String(top1)}/${String(n)}, top3 ${String(top3)}\n${misses.join('\n')}`;
  assert.ok(top1 / n >= 0.7, report);
  assert.ok(top3 / n >= 0.85, report);
});

test('a request that asks nothing of any skill ranks nothing as likely', () => {
  const router = createRouter(routable());
  for (const text of ['thanks', 'ok', '']) assert.ok(router.route(text).every((r) => r.band !== 'likely' || r.score < 1), text);
  const ranked = router.route('poke holes in this design before we commit');
  assert.equal(ranked[0].id, 'adversarial-review');
  assert.equal(ranked[0].band, 'likely');
  assert.ok(ranked.length === 17, 'every skill is returned, banded, so a reader can still pick another');
});

test('the operational skill teaches the session what the directive requires and forbids', () => {
  const body = skills.body('construct')!;
  for (const must of ['bootstrap', 'Answer', 'Remember', 'Manage an outcome', 'Maintain a standing outcome', 'claim_work', 'submit_work', 'decide', 'Stand down', 'hand back', 'Do not spawn another agent', 'promote_deliverable', 'licensed', 'classify_request']) {
    assert.ok(body.includes(must), `operational skill mentions ${must}`);
  }
  assert.doesNotMatch(body, /construct work|role-serve|MCP server|JSON-RPC/);
  assert.match(body, /Do not run Construct.s command line to do the\s+work/);
  const manifest = skills.get('construct')!.manifest;
  assert.equal(manifest.version, '2.0.0');
  assert.deepEqual(manifest.interactionClasses, ['answer', 'remember', 'manage', 'maintain']);
});

test('the live-judge record covers every current routing case, so a case added without a fresh run fails here', () => {
  const routing = validateRoutingEvalFile(JSON.parse(readFileSync(join(ROOT, 'skills', 'evals', 'routing.json'), 'utf8')), 'skills/evals/routing.json');
  const record = JSON.parse(readFileSync(join(ROOT, 'skills', 'evals', 'live-judge.json'), 'utf8')) as { format: string; judge: string; recordedAt: string; cases: number; agree: number; verdicts: { text: string; expected: string; picked: string | null }[] };
  assert.equal(record.format, 'construct-live-judge');
  assert.match(record.recordedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(['codex', 'claude'].includes(record.judge));
  const recorded = new Set(record.verdicts.map((v) => v.text));
  for (const c of routing.cases) assert.ok(recorded.has(c.text), `no live verdict recorded for: ${c.text}`);
  const ids = new Set([...skills.list().map((s) => s.manifest.id), 'none']);
  for (const v of record.verdicts) assert.ok(v.picked === null || ids.has(v.picked), `picked an unknown skill: ${String(v.picked)}`);
  assert.equal(record.agree, record.verdicts.filter((v) => v.picked === v.expected).length);
});
