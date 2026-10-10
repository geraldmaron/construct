/** These are evaluator-protocol fixtures, not live model qualification records. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brokerFixture } from '../kernel/broker/support.ts';
import { evaluateSkill } from '../../src/hosts/skill-evaluation.ts';
import { QUALIFICATION_COVERAGE } from '../../src/kernel/registry/qualification-evidence.ts';
import { projectResolver } from '../../src/kernel/source/resolver.ts';
import { TOOLS } from '../../src/kernel/broker/tools.ts';
import { record } from '../../src/kernel/broker/definition.ts';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendActivity } from '../../src/kernel/state/activity.ts';

function fixture() {
  let time = Date.parse('2026-09-02T12:00:00.000Z');
  const fx = brokerFixture('interactive', { now: () => new Date(time).toISOString() });
  const cases = QUALIFICATION_COVERAGE.map((kind, i) => ({ id: `case-${i}`, kind, domain: i % 2 ? 'archive' : 'software', checks: ['correctness', 'uncertainty', 'evidence'] }));
  const results = { formatVersion: 1, cases: cases.map((c) => ({ id: c.id, producerSession: `producer-${c.id}`, reviewerSession: `reviewer-${c.id}`, evidence: ['answer.md', 'docs/design.md'], checks: Object.fromEntries(c.checks.map((key) => [key, 'pass'])) })) };
  writeFileSync(join(fx.box.cwd, 'answer.md'), 'Keep the kernel host-agnostic. Unknown production readiness.\n');
  const grader = 'import fs from "node:fs"; import assert from "node:assert/strict"; assert.match(fs.readFileSync("answer.md","utf8"),/host-agnostic/); console.log(fs.readFileSync("observations.json","utf8"));';
  writeFileSync(join(fx.box.cwd, 'grader.mjs'), grader);
  writeFileSync(join(fx.box.cwd, 'observations.json'), JSON.stringify(results));
  const suite = { formatVersion: 1, id: 'protocol-fixture', version: '1', scope: 'Evaluator protocol fixtures only; not live skill competence', host: 'claude-code', model: 'fixture', verifier: { id: 'fixture-grader', version: '1', argv: [process.execPath, 'grader.mjs'], files: ['grader.mjs', 'observations.json'] }, cases };
  const suitePath = join(fx.box.cwd, 'suite.json'); writeFileSync(suitePath, JSON.stringify(suite));
  const evaluate = (extra = {}) => evaluateSkill({ store: fx.broker.store, skill: fx.broker.skills.get('construct')!, suitePath, root: fx.box.cwd, env: fx.ctx.env, now: fx.ctx.now, resolve: (ref) => projectResolver(fx.broker.store, fx.box.cwd)(ref), ...extra });
  const qualification = async (model = 'fixture') => {
    const tool = TOOLS.find((t) => t.name === 'skills')!;
    return (await tool.run(fx.broker, tool.validate(record({ action: 'show', id: 'construct', model }))) as any).qualification;
  };
  return { fx, suite, suitePath, results, evaluate, qualification, tick: (hours: number) => { time += hours * 3600000; } };
}

test('a passing evaluator report alone cannot qualify a host or skill, and still expires', async () => {
  const f = fixture();
  try {
    assert.equal((await f.qualification()).state, 'experimental');
    const receipt = await f.evaluate({ validForHours: 1 });
    assert.equal(receipt.passed, true, JSON.stringify(receipt.problems));
    const q = await f.qualification(); assert.equal(q.state, 'experimental'); assert.match(q.why, /reported only/);
    assert.equal(receipt.assurance, 'executed_evaluator_report');
    assert.equal((await f.qualification('another-model')).state, 'experimental');
    f.tick(2); assert.equal((await f.qualification()).state, 'degraded');
  } finally { f.fx.cleanup(); }
});

for (const change of ['artifact', 'evaluator', 'suite', 'host'] as const) test(`qualification cannot survive changed ${change}`, async () => {
  const f = fixture();
  try {
    await f.evaluate();
    if (change === 'host') Object.defineProperty(f.fx.broker.host, 'hostId', { value: 'codex' });
    else {
      const name = change === 'artifact' ? 'answer.md' : change === 'evaluator' ? 'grader.mjs' : 'suite.json';
      writeFileSync(join(f.fx.box.cwd, name), readFileSync(join(f.fx.box.cwd, name), 'utf8') + '\nchanged');
    }
    assert.notEqual((await f.qualification()).state, 'qualified');
  } finally { f.fx.cleanup(); }
});

for (const bad of ['missing_case', 'missing_check', 'unknown', 'self_review', 'missing_evidence', 'irrelevant_command', 'failed_command', 'timeout'] as const) test(`qualification rejects ${bad} instead of treating execution as substantive success`, async () => {
  const f = fixture();
  try {
    if (bad === 'missing_case') f.results.cases.pop();
    if (bad === 'missing_check') delete f.results.cases[0]!.checks.correctness;
    if (bad === 'unknown') f.results.cases[0]!.checks.correctness = 'unknown';
    if (bad === 'self_review') f.results.cases[0]!.reviewerSession = f.results.cases[0]!.producerSession;
    if (bad === 'missing_evidence') f.results.cases[0]!.evidence = ['missing.md'];
    if (bad === 'irrelevant_command') f.suite.verifier.argv = [process.execPath, '-e', 'process.exit(0)'];
    if (bad === 'failed_command') writeFileSync(join(f.fx.box.cwd, 'answer.md'), 'wrong answer');
    if (bad === 'timeout') f.suite.verifier.argv = [process.execPath, '-e', 'setTimeout(()=>{},10000)'];
    writeFileSync(join(f.fx.box.cwd, 'observations.json'), JSON.stringify(f.results));
    writeFileSync(f.suitePath, JSON.stringify(f.suite));
    const result = await f.evaluate(bad === 'timeout' ? { timeoutMs: 20 } : {});
    assert.equal(result.passed, false); assert.equal((await f.qualification()).state, 'degraded');
  } finally { f.fx.cleanup(); }
});

test('a later failed observation supersedes a prior pass and a model-authored activity cannot fabricate qualification', async () => {
  const f = fixture();
  try {
    const pass = await f.evaluate();
    writeFileSync(join(f.fx.box.cwd, 'answer.md'), 'invalid');
    assert.equal((await f.evaluate()).passed, false);
    appendActivity(f.fx.broker.store, { at: f.fx.ctx.now(), kind: 'skill.evaluation_observed', channel: 'relay', payload: { ...pass, passed: true, problems: [], evidence: [] } });
    assert.equal((await f.qualification()).state, 'degraded');
  } finally { f.fx.cleanup(); }
});


test('the public skill evaluate command records a usable scoped receipt', async () => {
  const f = fixture();
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url)), 'skill', 'evaluate', 'construct', '--suite=suite.json', '--json'], { cwd: f.fx.box.cwd, env: f.fx.ctx.env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const observed = JSON.parse(result.stdout);
    f.tick((Date.parse(observed.endedAt) + 1000 - Date.parse(f.fx.ctx.now())) / 3600000);
    assert.match(observed.evaluationRef, /^evaluation:/);
    assert.equal((await f.qualification()).state, 'experimental');
  } finally { f.fx.cleanup(); }
});
