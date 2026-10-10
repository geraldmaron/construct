/** Executable CLI protocol fixtures. Real host competence is measured separately. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { brokerFixture } from '../kernel/broker/support.ts';
import { redactEvaluationValue } from '../../src/hosts/skill-native-evaluation.ts';
import { evaluateSkill } from '../../src/hosts/skill-evaluation.ts';
import { createHash } from 'node:crypto';
import { appendActivity } from '../../src/kernel/state/activity.ts';
import { QUALIFICATION_COVERAGE, nativeReadObservations } from '../../src/kernel/registry/qualification-evidence.ts';
import { projectResolver } from '../../src/kernel/source/resolver.ts';
import { TOOLS } from '../../src/kernel/broker/tools.ts';

function fixture(variant = 'pass') {
  const fx = brokerFixture();
  Object.defineProperty(fx.broker.host, 'hostId', { value: 'codex' });
  const root = fx.box.cwd, bin = join(root, 'fake-bin'); mkdirSync(bin);
  const executable = `#!${process.execPath}\nimport fs from 'node:fs'; import {randomUUID} from 'node:crypto';
const args=process.argv.slice(2),variant=${JSON.stringify(variant)};
if(args.includes('--version')){console.log('codex-protocol-fixture');process.exit(0)}
if(args[0]==='login'){console.log('Logged in using ChatGPT');process.exit(0)}
const root=args[args.indexOf('--cd')+1], role=args[args.indexOf('--sandbox')+1]==='read-only'?'reviewer':'producer';
if(variant!=='no-session')console.log(JSON.stringify({type:'thread.started',thread_id:randomUUID()}));
if(role==='producer'){
 if(variant==='producer-failed')process.exit(1);
 if(variant==='execution-evidence'){
 console.log(JSON.stringify({type:'item.completed',item:{id:'lookup',type:'web_search',query:'public source lookup',action:{type:'search'}}}));
 console.log(JSON.stringify({type:'item.completed',item:{id:'read',type:'command_execution',command:'cat inputs.md',exit_code:0,status:'completed',aggregated_output:'No approved publication permission.'}}));
 console.log(JSON.stringify({type:'item.completed',item:{type:'thinking',text:'PRIVATE_SENTINEL'}}));
 }
 if(variant!=='missing-artifact')fs.writeFileSync(root+'/answer.md','An observed new fixture artifact. Unknown publication permission.');
 console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Saved answer.md'}}));
}else{
 const item=JSON.parse(fs.readFileSync(root+'/case.json','utf8'));
 if(variant==='execution-evidence' && (item.observedExecution?.items.length!==2 || item.observedExecution.items[0].resultObserved!==false || !item.observedExecution.items[1].resultObserved || JSON.stringify(item).includes('PRIVATE_SENTINEL')))process.exit(8);
 const checks=Object.fromEntries(item.checks.map(c=>[c,variant==='unknown'?'unknown':'pass']));
 const application=variant==='wrong-application'?'unknown':item.expectedApplication;
 console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({checks,application,reasons:'Protocol fixture judgment, not live competence.'})}}));
}
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:10}}));
`;
  writeFileSync(join(bin, 'codex'), executable, { mode: 0o755 });
  writeFileSync(join(root, 'rubric.txt'), 'Require all predetermined checks; fixture only.');
  writeFileSync(join(root, 'inputs.md'), 'No approved publication permission.');
  writeFileSync(join(root, 'grader.mjs'), 'import fs from "node:fs";const r=JSON.parse(fs.readFileSync(process.argv[2],"utf8")); if(r.cases.length!==6)process.exit(1); console.log(JSON.stringify(r));');
  const suite = { formatVersion: 1, id: 'native-protocol', version: '1', scope: 'Native process protocol only, not measured model competence', host: 'codex', model: 'fixture-model', native: { adapter: 'codex' }, verifier: { id: 'fixture', version: '1', argv: [process.execPath, 'grader.mjs', '@native-results'], files: ['grader.mjs'] }, cases: QUALIFICATION_COVERAGE.map((kind, i) => ({ id: `c${String(i)}`, kind, domain: i % 2 ? 'archive' : 'software', checks: ['correctness', 'uncertainty', 'application'], native: { prompt: 'Read inputs.md and save the answer in answer.md.', files: [{ from: 'inputs.md', to: 'inputs.md' }], outputs: ['answer.md'], rubric: 'rubric.txt' } })) };
  const suitePath = join(root, 'suite.json'); writeFileSync(suitePath, JSON.stringify(suite));
  const evaluate = () => evaluateSkill({ store: fx.broker.store, skill: fx.broker.skills.get('construct')!, suitePath, root, env: { ...fx.ctx.env, PATH: bin + delimiter + fx.ctx.env.PATH }, now: fx.ctx.now, resolve: (ref) => projectResolver(fx.broker.store, root)(ref), timeoutMs: 30_000 });
  const qualification = async () => { const t = TOOLS.find((x) => x.name === 'skills')!; return (await t.run(fx.broker, t.validate({ action: 'show', id: 'construct', model: 'fixture-model' })) as any).qualification; };
  return { fx, root, suite, suitePath, evaluate, qualification };
}

test('native adapter observes fresh per-case producer, artifact and independent reviewer invocations', async () => {
  const f = fixture();
  try {
    const record = await f.evaluate();
    assert.equal(record.passed, true, JSON.stringify(record.problems));
    assert.equal(record.assurance, 'native_execution_and_independent_review');
    assert.equal(record.nativeWitnesses!.length, 6);
    const sessions = record.nativeWitnesses!.flatMap((w) => [w.producer.sessionId, w.reviewer.sessionId]);
    assert.equal(new Set(sessions).size, 12, 'fresh independently observed sessions');
    const qualified = await f.qualification(); assert.equal(qualified.state, 'qualified', JSON.stringify(qualified));
    const w = record.nativeWitnesses![0]!;
    assert.equal(w.hostVersion, 'codex-protocol-fixture');
    assert.equal(w.skillDigest, f.fx.broker.skills.get('construct')!.digest);
    assert.match(readFileSync(join(f.root, w.artifacts[0]!), 'utf8'), /observed new/);
    const reviewer = JSON.parse(readFileSync(join(f.root, w.reviewer.receipt), 'utf8'));
    assert.equal(reviewer.role, 'reviewer');
    writeFileSync(join(f.root, w.artifacts[0]!), 'changed');
    assert.equal((await f.qualification()).state, 'degraded');
  } finally { f.fx.cleanup(); }
});

for (const variant of ['producer-failed', 'missing-artifact', 'no-session', 'unknown', 'wrong-application']) test(`native qualification rejects ${variant} despite an evaluator result`, async () => {
  const f = fixture(variant);
  try { const result = await f.evaluate(); assert.equal(result.passed, false); assert.equal((await f.qualification()).state, 'degraded'); }
  finally { f.fx.cleanup(); }
});

test('a native case cannot prepopulate its output through an input path alias', async () => {
  const f = fixture();
  try {
    f.suite.cases[0]!.native.files[0]!.to = './answer.md';
    writeFileSync(f.suitePath, JSON.stringify(f.suite));
    const result = await f.evaluate();
    assert.equal(result.passed, false); assert.match(result.problems.join(' '), /prepopulate/);
  } finally { f.fx.cleanup(); }
});


test('redaction preserves JSON structure around escaped lines and nested command strings', () => {
  const value = { command: 'printf "abcDEFghijklMNOP1234567890"', nested: ['abcDEFghijklMNOP1234567890\nnext line', { escaped: '\\nabcDEFghijklMNOP1234567890', secret: 'sk-' + 'a1B2c3D4e5F6g7H8i9J0k1L2' }], count: 12, ok: true };
  const clean = redactEvaluationValue(value);
  assert.deepEqual(JSON.parse(JSON.stringify(clean)), clean);
  assert.equal(clean.count, 12);
  assert.equal(clean.ok, true);
  assert.match(JSON.stringify(clean), /\[redacted\]/);
  assert.doesNotMatch(JSON.stringify(clean), /sk-a1B2/);
});


test('installed method files cannot be claimed as freshly produced artifacts', async () => {
  const f = fixture();
  try {
    f.suite.cases[0]!.native.outputs = ['.agents/skills/construct/SKILL.md'];
    writeFileSync(f.suitePath, JSON.stringify(f.suite));
    const result = await f.evaluate();
    assert.equal(result.passed, false); assert.match(result.problems.join(' '), /already exist/);
  } finally { f.fx.cleanup(); }
});

test('a producer cannot receive a held-out rubric through an input alias', async () => {
  const f = fixture();
  try {
    f.suite.cases[0]!.native.files[0]!.from = './rubric.txt';
    writeFileSync(f.suitePath, JSON.stringify(f.suite));
    await assert.rejects(f.evaluate(), /held-out rubric/);
  } finally { f.fx.cleanup(); }
});


test('external grading cannot substitute adapter-observed artifacts or invocation receipts', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'grader.mjs'), `import fs from 'node:fs';const r=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));for(const c of r.cases){for(const ref of c.evidence){if(ref.endsWith('/output-0.txt'))fs.writeFileSync(ref,'Substituted answer');if(ref.endsWith('/producer.json')){const p=JSON.parse(fs.readFileSync(ref,'utf8'));p.model='substituted-model';fs.writeFileSync(ref,JSON.stringify(p));}}}console.log(JSON.stringify(r));`);
    const result = await f.evaluate();
    assert.equal(result.passed, false);
    assert.match(result.problems.join(' '), /native evidence changed/);
    assert.equal((await f.qualification()).state, 'degraded');
  } finally { f.fx.cleanup(); }
});

test('hash-matching receipt files still need consistent case relationships and unique native invocations', async () => {
  const f = fixture();
  try {
    const original = await f.evaluate(); assert.equal(original.passed, true, JSON.stringify(original.problems));
    const held = new Map(original.evidence.map((entry) => [entry.ref, readFileSync(join(f.root, entry.ref), 'utf8')]));
    for (const variant of ['host', 'model', 'session', 'exit', 'role', 'inputs', 'rubric', 'skill', 'artifact_binding', 'reviewer_judgment', 'reused_invocations', 'reused_artifacts', 'read_observations']) {
      for (const [ref, text] of held) writeFileSync(join(f.root, ref), text);
      const changed: any = structuredClone(original);
      const w = changed.nativeWitnesses[0], path = join(f.root, w.producer.receipt), producer = JSON.parse(readFileSync(path, 'utf8'));
      if (variant === 'host') producer.host = 'cursor';
      if (variant === 'model') producer.model = 'different';
      if (variant === 'session') producer.sessionId = 'different-session';
      if (variant === 'exit') producer.exitStatus = 1;
      if (variant === 'role') producer.role = 'reviewer';
      if (variant === 'inputs') producer.context.inputDigests[0].digest = '0'.repeat(64);
      if (variant === 'rubric') producer.context.rubricDigest = '0'.repeat(64);
      if (variant === 'read_observations') producer.events.push({ type: 'item.completed', item: { type: 'web_search', query: 'substituted observed lookup' } });
      if (variant === 'skill') producer.context.skill.digest = 'sha256:' + '0'.repeat(64);
      writeFileSync(path, JSON.stringify(producer));
      if (variant === 'reviewer_judgment') { const file = join(f.root, w.reviewer.receipt); const receipt = JSON.parse(readFileSync(file, 'utf8')); receipt.text = JSON.stringify({ checks: { correctness: 'fail' }, application: 'unknown', reasons: 'Contradictory actual reviewer output' }); writeFileSync(file, JSON.stringify(receipt)); }
      if (variant === 'artifact_binding') writeFileSync(join(f.root, w.artifacts[0]), 'A different artifact with a newly matching outer hash');
      if (variant === 'reused_invocations' || variant === 'reused_artifacts') {
        for (const item of changed.nativeWitnesses) {
          const c = JSON.parse(readFileSync(join(f.root, item.caseRef), 'utf8'));
          if (variant === 'reused_invocations') for (const role of ['producer', 'reviewer']) {
            const receipt = JSON.parse(readFileSync(join(f.root, item[role].receipt), 'utf8'));
            receipt.id = w[role].invocationId; receipt.sessionId = w[role].sessionId;
            item[role].invocationId = receipt.id; item[role].sessionId = receipt.sessionId;
            c[role + 'Invocation'] = receipt.id;
            writeFileSync(join(f.root, item[role].receipt), JSON.stringify(receipt));
          }
          if (variant === 'reused_artifacts') {
            item.artifacts = [...w.artifacts]; c.outputDigests[0].ref = w.artifacts[0];
            const reviewer = JSON.parse(readFileSync(join(f.root, item.reviewer.receipt), 'utf8'));
            reviewer.reviewedOutputs = c.outputDigests; writeFileSync(join(f.root, item.reviewer.receipt), JSON.stringify(reviewer));
          }
          writeFileSync(join(f.root, item.caseRef), JSON.stringify(c));
        }
      }
      changed.evidence = changed.evidence.map((entry: any) => ({ ...entry, digest: createHash('sha256').update(readFileSync(join(f.root, entry.ref), 'utf8')).digest('hex') }));
      appendActivity(f.fx.broker.store, { at: f.fx.ctx.now(), kind: 'skill.evaluation_observed', channel: 'host_evaluation', payload: changed });
      assert.equal((await f.qualification()).state, 'degraded', variant);
    }
  } finally { f.fx.cleanup(); }
});


test('reviewers receive public lookup observations and actual read results, with private thought and producer chat excluded', async () => {
  const f = fixture('execution-evidence');
  try {
    const result = await f.evaluate();
    assert.equal(result.passed, true, JSON.stringify(result.problems));
    const witness = result.nativeWitnesses![0]!;
    const producer = JSON.parse(readFileSync(join(f.root, witness.producer.receipt), 'utf8'));
    assert.doesNotMatch(JSON.stringify(producer), /PRIVATE_SENTINEL/);
    const captured = JSON.parse(readFileSync(join(f.root, witness.caseRef), 'utf8'));
    assert.equal(captured.readObservations.items.length, 2);
    assert.equal(captured.readObservations.items[0].resultObserved, false);
    assert.equal(captured.readObservations.items[1].output.excerpt, 'No approved publication permission.');
  } finally { f.fx.cleanup(); }
});

test('public execution projection makes truncated and missing results explicit without inventing lookup success', () => {
  const output = 'held source '.repeat(2000);
  const report = nativeReadObservations([
    { type: 'item.completed', item: { type: 'agent_message', text: 'I searched successfully.' } },
    { type: 'item.completed', item: { type: 'analysis', text: 'private' } },
    { type: 'item.started', item: { type: 'web_search', query: 'incomplete' } },
    { type: 'item.completed', item: { type: 'web_search', query: 'q', action: { type: 'search' } } },
    { type: 'item.completed', item: { type: 'command_execution', command: 'read', exit_code: 0, aggregated_output: output } },
    { type: 'item.completed', item: { type: 'mcp_tool_call', server: 'fixture', tool: 'read', error: { code: 'permission_denied' } } },
  ]);
  assert.equal(report.items.length, 3);
  assert.equal(report.items[0]!.resultObserved, false);
  assert.equal((report.items[1]!.output as any).truncated, true);
  assert.equal((report.items[1]!.output as any).digest, createHash('sha256').update(output).digest('hex'));
  assert.match((report.items[2]!.error as any).excerpt, /permission_denied/);
  assert.doesNotMatch(JSON.stringify(report), /private|searched successfully|incomplete/);
});


test('review-only: projection and reviewer digest edits fail even with fresh outer hashes', async () => {
  const f = fixture('execution-evidence');
  try {
    const original = await f.evaluate();
    assert.equal(original.passed, true, JSON.stringify(original.problems));
    const held = new Map(original.evidence.map((entry) => [entry.ref, readFileSync(join(f.root, entry.ref), 'utf8')]));
    for (const variant of ['case_items', 'case_digest', 'reviewer_digest', 'producer_output']) {
      for (const [ref, text] of held) writeFileSync(join(f.root, ref), text);
      const changed: any = structuredClone(original), w = changed.nativeWitnesses[0];
      let ref = w.caseRef, value = JSON.parse(readFileSync(join(f.root, ref), 'utf8'));
      if (variant === 'case_items') value.readObservations.items[1].output.excerpt = 'Contradictory read';
      if (variant === 'case_digest') value.readObservationsDigest = 'f'.repeat(64);
      if (variant === 'reviewer_digest') {
        ref = w.reviewer.receipt; value = JSON.parse(readFileSync(join(f.root, ref), 'utf8'));
        value.reviewedReadsDigest = 'f'.repeat(64);
      }
      if (variant === 'producer_output') {
        ref = w.producer.receipt; value = JSON.parse(readFileSync(join(f.root, ref), 'utf8'));
        value.events.find((e: any) => e.item?.type === 'command_execution').item.aggregated_output = 'Contradictory actual read';
      }
      writeFileSync(join(f.root, ref), JSON.stringify(value));
      changed.evidence = changed.evidence.map((entry: any) => ({ ...entry, digest: createHash('sha256').update(readFileSync(join(f.root, entry.ref), 'utf8')).digest('hex') }));
      appendActivity(f.fx.broker.store, { at: f.fx.ctx.now(), kind: 'skill.evaluation_observed', channel: 'host_evaluation', payload: changed });
      assert.equal((await f.qualification()).state, 'degraded', variant);
    }
  } finally { f.fx.cleanup(); }
});

test('review-only: partial reads and failed commands retain their boundaries', () => {
  const projected = nativeReadObservations([
    { type: 'item.completed', item: { type: 'reasoning', text: 'SECRET_REASONING' } },
    { type: 'item.completed', item: { type: 'thinking', text: 'SECRET_THINKING' } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'SECRET_CHAT' } },
    { type: 'item.completed', item: { type: 'command_execution', command: 'read source', status: 'failed', exit_code: 1, aggregated_output: 'permission denied' } },
    { type: 'item.completed', item: { type: 'command_execution', command: 'read another source', status: 'completed', exit_code: 0 } },
    { type: 'item.completed', item: { type: 'mcp_tool_call', server: 'fixture', tool: 'read', status: 'failed', error: { message: 'permission denied' } } },
    { type: 'item.completed', item: { type: 'mcp_tool_call', server: 'fixture', tool: 'read', status: 'completed' } },
  ]);
  assert.equal(projected.items.length, 4);
  assert.doesNotMatch(JSON.stringify(projected), /SECRET/);
  assert.equal(projected.items[0]!.status, 'failed');
  assert.equal(projected.items[0]!.exitCode, 1);
  assert.equal(projected.items[0]!.resultObserved, true);
  assert.equal(projected.items[1]!.resultObserved, false);
  assert.equal(projected.items[2]!.status, 'failed');
  assert.equal(projected.items[2]!.resultObserved, true);
  assert.equal(projected.items[3]!.resultObserved, false);
});
