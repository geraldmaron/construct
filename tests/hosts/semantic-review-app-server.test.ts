import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox } from '../cli/support.ts';
import { APP_SERVER_REVIEW_TURN, runAppServerHeldReview } from '../../src/hosts/semantic-review-app-server.ts';
import { reviewDigest } from '../../src/kernel/workflow/semantic-review.ts';

/** Synthetic protocol peer; never a native qualification witness. */
const peer = `
import readline from 'node:readline';
const mode=process.env.CONSTRUCT_REVIEW_SCENARIO;
const rl=readline.createInterface({input:process.stdin});
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
const note=(method,params)=>send({method,params});
let staged=false;
rl.on('line',line=>{
 const m=JSON.parse(line),p=m.params;
 if(!m.id)return;
 const answer=result=>send({id:m.id,result});
 if(m.method==='initialize'){if(mode==='error-null')send({id:m.id,error:null});else answer({userAgent:'synthetic'});return;}
 if(m.method==='thread/start'){
  if(p.ephemeral!==true||p.approvalPolicy!=='never'||p.sandbox!=='read-only')throw Error('unsafe thread policy');
  note('thread/started',{thread:{id:'review-session'}});
  answer({thread:{id:'review-session',ephemeral:true},model:p.model,cwd:p.cwd,approvalPolicy:'never',sandbox:{type:'readOnly',networkAccess:mode==='wrong-policy'}});return;
 }
 if(m.method==='thread/inject_items'){
  if(p.items.length!==1||p.items[0].role!=='user'||p.items[0].content[0].type!=='input_text'||!p.items[0].content[0].text.endsWith('LAST_SYNTHETIC_ITEM'))throw Error('wrong evidence');
  if(mode==='early-close'){process.exit(0);return;}
  if(mode==='unacknowledged-stage'){answer(null);return;}
  staged=true;answer({});return;
 }
 if(m.method==='turn/start'){
  if(!staged||p.input.length!==1||p.approvalPolicy!=='never'||p.sandboxPolicy.type!=='readOnly'||p.sandboxPolicy.networkAccess!==false)throw Error('unsafe turn');
  if(mode==='schema'&&(p.outputSchema?.type!=='object'||p.outputSchema?.additionalProperties!==false||p.outputSchema?.properties?.checks?.type!=='array'))throw Error('missing native output schema');
  if(mode==='success'&&Object.hasOwn(p,'outputSchema'))throw Error('unexpected schema for generic transport');
  const turn={id:mode==='wrong-rpc-turn'?'wrong-turn':'review-turn',status:'inProgress',items:[],error:null};
  answer({turn});
  if(mode==='missing-completion'){process.exit(0);return;}
  const params={threadId:'review-session',turnId:'review-turn'};
  note('turn/started',{threadId:'review-session',turn:{id:'review-turn',status:'inProgress'}});
  if(mode==='server-request'){send({id:99,method:'item/tool/call',params});return;}
  if(mode==='tool'){note('item/completed',{...params,item:{id:'tool',type:'commandExecution'}});return;}
  if(mode==='compaction'){note('thread/compacted',{...params});return;}
  if(mode==='unknown'){note('unexpected/operation',params);return;}
  if(mode.startsWith('refuse:')){note(mode.slice(7),{...params,private:'DO_NOT_RETAIN_PRIVATE_REASONING'});return;}
  if(mode==='function-output'){note('item/completed',{...params,item:{id:'function',type:'functionCallOutput',output:'DO_NOT_RETAIN_PRIVATE_REASONING'}});return;}
  if(mode==='unknown-private'){note('DO_NOT_RETAIN_PRIVATE_REASONING',{...params,item:{type:'DO_NOT_RETAIN_PRIVATE_REASONING'}});return;}
  if(mode==='skills-changed')note('skills/changed',{});
  if(mode==='account-subscription')note('account/updated',{authMode:'chatgpt',planType:'pro'});
  if(mode==='account-api'){note('account/updated',{authMode:'apikey',planType:null});return;}
  if(mode==='warning-fail-closed')note('warning',{threadId:'review-session',message:'Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable the code-mode host.'});
  if(mode==='warning-other'){note('warning',{threadId:'review-session',message:'DO_NOT_RETAIN_PRIVATE_REASONING'});return;}
  if(mode==='moderation')note('turn/moderationMetadata',{...params,metadata:{note:'DO_NOT_RETAIN_PRIVATE_REASONING'}});
  if(mode==='moderation-wrong-turn'){note('turn/moderationMetadata',{threadId:'review-session',turnId:'other-turn',metadata:{note:'DO_NOT_RETAIN_PRIVATE_REASONING'}});return;}
  if(mode==='moderation-wrong-thread'){note('turn/moderationMetadata',{threadId:'other-session',turnId:'review-turn',metadata:{}});return;}
  if(mode==='skills-nonempty'){note('skills/changed',{text:'DO_NOT_RETAIN_PRIVATE_REASONING'});return;}
  if(mode==='skills-null'){note('skills/changed',null);return;}
  if(mode==='skills-array'){note('skills/changed',[]);return;}
  if(mode==='malformed'){process.stdout.write('not-json\\n');return;}
  if(mode==='overflow-private'){note('item/reasoning/textDelta',{...params,delta:'PRIVATE'.repeat(200000)});return;}
  if(mode==='overflow-moderation'){note('turn/moderationMetadata',{...params,metadata:'PRIVATE'.repeat(200000)});return;}
  if(mode==='overflow-stderr'){process.stderr.write('PRIVATE'.repeat(200000));return;}
  if(mode==='timeout')return;
  note('item/reasoning/textDelta',{...params,delta:'DO_NOT_RETAIN_PRIVATE_REASONING'});
  note('item/started',{...params,item:{id:'user',type:'userMessage',content:p.input}});
  note('item/completed',{...params,item:{id:'user',type:'userMessage',content:p.input}});
  const extra=mode==='partial-answer'?{phase:'partial_answer'}:mode==='async-answer'?{delivery:'async'}:mode==='questions'?{questions:[{title:'DO_NOT_RETAIN_PRIVATE_REASONING'}]}:mode==='unknown-phase'?{phase:'DO_NOT_RETAIN_PRIVATE_REASONING'}:mode==='v2-sync'?{delivery:null,questions:null,phase:'final_answer'}:{};
  note('item/started',{...params,item:{id:'answer',type:'agentMessage',text:'',...extra}});
  note('item/completed',{...params,item:{id:'answer',type:'agentMessage',text:'{"checks":[]}',...extra,...(mode==='partial-completed'?{phase:'partial_answer'}:mode==='async-completed'?{delivery:'async'}:mode==='questions-completed'?{questions:[]}: {})}});
  if(['turn-error','turn-interrupted','completed-error'].includes(mode)){note('turn/completed',{threadId:'review-session',turn:{id:'review-turn',status:mode==='turn-interrupted'?'interrupted':mode==='completed-error'?'completed':'failed',error:{message:'DO_NOT_RETAIN_PRIVATE_REASONING',codexErrorInfo:'misalignmentPolicyViolation',misalignment:{steer:{message:'DO_NOT_RETAIN_PRIVATE_REASONING'}}}}});return;}
  note('turn/completed',{threadId:'review-session',turn:{id:'review-turn',status:'completed',error:null}});
  if(mode==='duplicate-terminal')note('turn/completed',{threadId:'review-session',turn:{id:'review-turn',status:'completed',error:null}});
 }
 });
`;

async function exercise(mode: string, heldText = 'FIRST_SYNTHETIC_ITEM\nLAST_SYNTHETIC_ITEM', outputSchema?: unknown) {
  const fx = sandbox();
  try {
    const file = join(fx.cwd, 'synthetic-peer.mjs');
    writeFileSync(file, peer);
    return await runAppServerHeldReview({
      binary: process.execPath,
      argv: [file],
      root: fx.cwd,
      env: { ...fx.ctx.env, CONSTRUCT_REVIEW_SCENARIO: mode },
      model: 'synthetic-protocol-test',
      heldText,
      timeoutMs: mode === 'timeout' ? 100 : 2000,
      outputSchema,
    });
  } finally {
    fx.cleanup();
  }
}

test('exact large user-only staging precedes one bounded integrated turn and clean shutdown', async () => {
  const heldText = 'FIRST_SYNTHETIC_ITEM\n' + 'Evidence remains provisional. '.repeat(45000) + '\nLAST_SYNTHETIC_ITEM';
  const result = await exercise('success', heldText);
  assert.deepEqual(result.problems, []);
  assert.equal(result.completed, true);
  assert.equal(result.exitStatus, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.text, '{"checks":[]}');
  assert.deepEqual(result.observations, [
    { type: 'thread.started', sessionId: 'review-session' },
    { type: 'native.evidence_staged', sessionId: 'review-session', characters: [...heldText].length, digest: reviewDigest(heldText) },
    { type: 'turn.started' },
    { type: 'item.completed', itemType: 'agent_message', text: '{"checks":[]}' },
    { type: 'turn.completed' },
  ]);
  assert.equal(JSON.stringify(result).includes('DO_NOT_RETAIN_PRIVATE_REASONING'), false);
  assert.ok(APP_SERVER_REVIEW_TURN.length < 1048576);
});

test('protocol failure, incorrect policy, tools, unknown operations and compaction cannot supply review assurance', async () => {
  for (const mode of [
    'wrong-policy',
    'error-null',
    'unacknowledged-stage',
    'early-close',
    'wrong-rpc-turn',
    'missing-completion',
    'server-request',
    'tool',
    'compaction',
    'unknown',
    'malformed',
    'duplicate-terminal',
  ]) {
    const result = await exercise(mode);
    assert.ok(result.problems.length, mode);
    if (['wrong-policy', 'error-null', 'unacknowledged-stage', 'early-close'].includes(mode))
      assert.ok(!result.observations.some((entry: any) => entry.type === 'native.evidence_staged'), mode);
  }
});

test('private, stderr and uncompleted streams remain bounded and never retain private payloads', async () => {
  for (const mode of ['overflow-private', 'overflow-stderr', 'timeout']) {
    const result = await exercise(mode);
    assert.ok(result.problems.length, mode);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    if (mode === 'timeout') assert.equal(result.timedOut, true);
    else assert.match(result.problems.join(), /raw byte bound/);
  }
});

test('refused protocol diagnostics retain only finite pinned method, item, phase and stage metadata', async () => {
  const compacted = await exercise('compaction');
  assert.deepEqual(
    compacted.observations.find((entry: any) => entry.type === 'native.protocol_refusal'),
    { type: 'native.protocol_refusal', method: 'thread/compacted', itemType: null, phase: null, stage: 'turn' },
  );
  const tool = await exercise('tool');
  assert.deepEqual(
    tool.observations.find((entry: any) => entry.type === 'native.protocol_refusal'),
    { type: 'native.protocol_refusal', method: 'item/completed', itemType: 'commandExecution', phase: null, stage: 'turn' },
  );
  const unknown = await exercise('unknown-private');
  assert.deepEqual(
    unknown.observations.find((entry: any) => entry.type === 'native.protocol_refusal'),
    { type: 'native.protocol_refusal', method: 'unrecognized', itemType: null, phase: null, stage: 'turn' },
  );
  assert.equal(JSON.stringify(unknown).includes('DO_NOT_RETAIN_PRIVATE_REASONING'), false);
});

test('only the pinned empty skill-cache invalidation is harmless metadata', async () => {
  const allowed = await exercise('skills-changed');
  assert.deepEqual(allowed.problems, []);
  assert.equal(allowed.completed, true);
  for (const mode of ['skills-nonempty', 'skills-null', 'skills-array']) {
    const refused = await exercise(mode);
    assert.equal(refused.completed, false, mode);
    assert.ok(refused.problems.length, mode);
    assert.ok(
      refused.observations.some((entry: any) => entry.type === 'native.protocol_refusal' && entry.method === 'skills/changed'),
      mode,
    );
    assert.equal(JSON.stringify(refused).includes('DO_NOT_RETAIN_PRIVATE_REASONING'), false, mode);
  }
});

test('native structured output schema is forwarded without changing generic held-text transport', async () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: { checks: { type: 'array', items: { type: 'object' } } },
    required: ['checks'],
  };
  const structured = await exercise('schema', undefined, schema);
  assert.deepEqual(structured.problems, []);
  assert.equal(structured.completed, true);
  const generic = await exercise('success');
  assert.deepEqual(generic.problems, []);
  assert.equal(generic.completed, true);
});

test('turn moderation metadata is discarded unread, only for this review turn', async () => {
  const allowed = await exercise('moderation');
  assert.deepEqual(allowed.problems, []);
  assert.equal(allowed.completed, true);
  assert.equal(JSON.stringify(allowed).includes('DO_NOT_RETAIN_PRIVATE_REASONING'), false);
  assert.deepEqual(
    allowed.observations.map((entry: any) => entry.type),
    ['thread.started', 'native.evidence_staged', 'turn.started', 'item.completed', 'turn.completed'],
  );
  const flood = await exercise('overflow-moderation');
  assert.equal(flood.completed, false);
  assert.ok(flood.problems.length);
  assert.equal(JSON.stringify(flood).includes('PRIVATEPRIVATE'), false);
  for (const mode of ['moderation-wrong-turn', 'moderation-wrong-thread']) {
    const refused = await exercise(mode);
    assert.equal(refused.completed, false, mode);
    assert.ok(refused.problems.length, mode);
    assert.ok(
      refused.observations.some((entry: any) => entry.type === 'native.protocol_refusal' && entry.method === 'turn/moderationMetadata'),
      mode,
    );
    assert.equal(JSON.stringify(refused).includes('DO_NOT_RETAIN_PRIVATE_REASONING'), false, mode);
  }
});

test('0.163 synchronous final messages remain compatible; partial, async and question messages fail closed', async () => {
  const allowed = await exercise('v2-sync');
  assert.deepEqual(allowed.problems, []);
  assert.equal(allowed.completed, true);
  for (const mode of [
    'partial-answer',
    'async-answer',
    'questions',
    'unknown-phase',
    'partial-completed',
    'async-completed',
    'questions-completed',
  ]) {
    const refused = await exercise(mode);
    assert.equal(refused.completed, false, mode);
    assert.match(refused.problems.join(), /unsupported agent message/, mode);
    assert.equal(JSON.stringify(refused).includes('DO_NOT_RETAIN_PRIVATE_REASONING'), false, mode);
  }
});

test('0.163 new notifications, function output and expanded errors cannot supply review assurance', async () => {
  for (const method of [
    'account/gatewayOAuth/changed',
    'autoApprovalReview/strictReviewRequired',
    'mcpServer/event/stream/notification',
    'modelProvider/authRecoveryCompleted',
    'modelProvider/authRecoveryStarted',
    'project/changed',
    'thread/attachment/updated',
    'thread/prediction/updated',
    'thread/project/updated',
    'thread/queue/changed',
    'thread/readState/changed',
    'thread/realtime/item/completed',
    'thread/realtime/item/started',
    'thread/realtime/item/transcript/delta',
    'thread/reverted',
    'error',
  ]) {
    const refused = await exercise('refuse:' + method);
    assert.equal(refused.completed, false, method);
    assert.ok(refused.problems.length, method);
    assert.ok(
      refused.observations.some((entry: any) => entry.type === 'native.protocol_refusal' && entry.method === method),
      method,
    );
    assert.equal(JSON.stringify(refused).includes('DO_NOT_RETAIN_PRIVATE_REASONING'), false, method);
  }
  for (const mode of ['function-output', 'turn-error', 'turn-interrupted', 'completed-error']) {
    const refused = await exercise(mode);
    assert.equal(refused.completed, false, mode);
    assert.ok(refused.problems.length, mode);
    assert.equal(JSON.stringify(refused).includes('DO_NOT_RETAIN_PRIVATE_REASONING'), false, mode);
  }
});

test('0.163 account and code-mode notices pass only when they confirm the subscription and the fail-closed isolation', async () => {
  const subscription = await exercise('account-subscription');
  assert.deepEqual(subscription.problems, []);
  assert.equal(subscription.completed, true);
  const api = await exercise('account-api');
  assert.equal(api.completed, false);
  assert.ok(api.problems.includes('native app-server is not running on the subscription'));
  const closed = await exercise('warning-fail-closed');
  assert.deepEqual(closed.problems, []);
  assert.ok(closed.observations.some((entry: any) => entry.type === 'native.fail_closed_warning'));
  const other = await exercise('warning-other');
  assert.equal(other.completed, false);
  assert.ok(other.problems.includes('native app-server emitted an unqualified warning'));
  assert.equal(JSON.stringify(other).includes('DO_NOT_RETAIN_PRIVATE_REASONING'), false);
});
