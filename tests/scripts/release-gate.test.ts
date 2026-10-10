/** Synthetic validator fixtures only: these records are never native qualification. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SEMANTIC_OBLIGATIONS,reviewDigest,semanticJudgmentProblems} from '../../src/kernel/workflow/semantic-review.ts';
// @ts-expect-error release script is intentionally plain JavaScript
import {checkExperimental,checkRelease,repositoryFile,sha256} from '../../scripts/release-gate.mjs';
// @ts-expect-error frozen script fixtures are intentionally plain JavaScript
import {CASES,REQUEST,DISCLOSURES} from '../../scripts/experimental-cases.mjs';
// @ts-expect-error explicit runner helper is plain JavaScript; import never launches a model
import {beginExperimentalAttempt} from '../../scripts/experimental-live.mjs';
const digest='test-surface',now=Date.parse('2026-10-10T01:00:00Z');
function fixture() {
  const records:any[]=[]; const files=new Map<string,Buffer>();
  for(const c of CASES){
    const contract={request:{input:{request:REQUEST}},obligations:SEMANTIC_OBLIGATIONS,reviewer:{digest:'a'.repeat(64),profile:'codex-held-text-v1'}};
    const bundle:any={runId:'run',stepRunId:'step',attempt:1,contract,contractDigest:reviewDigest(contract),body:{summary:c.answer},artifacts:[{ref:'answer.md',content:{text:c.answer}}],evidence:[{ref:'source.txt',content:{text:c.source}}],problems:[]};
    const judgment={checks:SEMANTIC_OBLIGATIONS.map(o=>({id:o.id,verdict:c.expected==='reject'&&o.id==='reasoning'?'fail':'pass',reason:'Synthetic validator fixture only, not an actual native execution.',refs:['body']}))};
    const observations=[{type:'thread.started',sessionId:c.id},{type:'turn.started'},{type:'item.completed',itemType:'agent_message',text:JSON.stringify(judgment)},{type:'turn.completed'}];
    const event={preparedRef:'review:1',bundleDigest:reviewDigest(bundle),attempt:1,invocation:{id:c.id,sessionId:c.id,host:'codex',hostVersion:'codex-cli 0.145.0',model:'gpt-6-astra',completed:true,exitStatus:0,timedOut:false,transcriptDigest:reviewDigest(observations)},binaryDigest:'a'.repeat(64),profile:'codex-held-text-v1',modelSource:'requested',startedAt:'2026-10-10T00:59:00Z',observations,judgment,problems:semanticJudgmentProblems(bundle,judgment)};
    const draft={id:'draft',runId:'run',stepRunId:'step',trustState:'draft',body:bundle.body};
    records.push({deliverableBefore:structuredClone(draft),deliverableAfter:structuredClone(draft),caseId:c.id,surfaceDigest:digest,prepared:{ref:'review:1',digest:reviewDigest(bundle),bundle},event,completedAt:'2026-10-10T00:59:30Z',filesUnchanged:true,canaryAbsent:true,finalState:c.expected==='pass'?'succeeded':'running',stepState:c.expected==='pass'?'succeeded':'leased'});
  }
  const manifest:any={format:'construct-experimental-alpha-v1',tier:'experimental-alpha',version:'3.0.0-alpha.27',surfaceDigest:digest,broadQualification:false,limitations:Object.fromEntries(DISCLOSURES.map((k:string)=>[k,'This limited synthetic fixture establishes no general capability or qualification.'])),cases:[],freshUserObservations:[{path:'fresh-a',sha256:sha256('failed'),summary:'A real fresh-user outcome failed; this remains a limitation, not a pass.'},{path:'fresh-b',sha256:sha256('failed'),summary:'A second fresh-user outcome remained incomplete; this is not qualified.'}]};
  files.set('fresh-a',Buffer.from('failed'));files.set('fresh-b',Buffer.from('failed'));
  const freeze=()=>{manifest.cases=records.map(r=>{const b=Buffer.from(JSON.stringify(r));files.set(r.caseId,b);return{id:r.caseId,path:r.caseId,sha256:sha256(b)}})};freeze();
  const check=()=>checkExperimental({manifest,version:'3.0.0-alpha.27',digest,now,read:(p:string)=>{const b=files.get(p);if(!b)throw Error('missing file');return b}});
  return {records,manifest,files,freeze,check};
}
test('experimental records verify bounded controls without claiming qualification',()=>{assert.equal(fixture().check().ok,true)});
test('experimental alpha cannot replace a stable or unknown tier',()=>{const f=fixture();assert.equal(checkExperimental({manifest:f.manifest,version:'3.0.0',digest,now,read:(p:string)=>f.files.get(p)}).ok,false);assert.equal(checkRelease({tier:'unqualified'}).ok,false)});
test('missing, stale, malformed or reused native evidence is rejected',()=>{
  const mutations:((f:ReturnType<typeof fixture>)=>void)[]=[
    f=>{f.manifest.surfaceDigest='old'},f=>{f.manifest.broadQualification=true},f=>{delete f.manifest.limitations.executor},f=>{f.manifest.cases=[]},f=>{f.manifest.cases={}},f=>{f.manifest.freshUserObservations=[]},f=>{f.manifest.freshUserObservations={}},
    f=>{f.records[0].event.invocation.completed=false;f.freeze()},f=>{f.records[0].event.invocation.timedOut=true;f.freeze()},f=>{f.records[0].event.invocation.exitStatus=1;f.freeze()},f=>{f.records[0].event.invocation.sessionId='incorrect';f.freeze()},f=>{f.records[0].event.binaryDigest='b'.repeat(64);f.freeze()},f=>{f.records[0].completedAt='2026-10-01T00:59:30Z';f.freeze()},f=>{f.records[0].completedAt='invalid';f.freeze()},
    f=>{f.records[0].prepared.bundle.body.summary='replaced';f.freeze()},f=>{f.records[0].event.judgment.checks[0].reason='changed';f.freeze()},f=>{f.records[0].event.problems.push('configuration changed');f.freeze()},f=>{f.records[1].finalState='succeeded';f.freeze()},f=>{f.records[2].canaryAbsent=false;f.freeze()},f=>{f.records[2].filesUnchanged=false;f.freeze()},
    f=>{f.records[0].event.observations.push({type:'item.completed',itemType:'command_execution'});f.records[0].event.invocation.transcriptDigest=reviewDigest(f.records[0].event.observations);f.freeze()},
    f=>{delete f.records[1].deliverableAfter;f.freeze()},f=>{f.records[1].deliverableAfter.body={summary:'lost'};f.freeze()},f=>{f.records[1].deliverableAfter.trustState='validated';f.freeze()},f=>{f.records[1].deliverableAfter.id='other';f.freeze()},
    f=>{f.files.set('correct',Buffer.from('{}'))},f=>{f.files.delete('fresh-a')},
  ];for(const [index,mutate]of mutations.entries()){const f=fixture();mutate(f);assert.equal(f.check().ok,false,`mutation ${index}`)}
});
test('evidence paths cannot escape the repository through traversal or symlinks',()=>{const root=mkdtempSync(join(tmpdir(),'release-gate-')),outside=mkdtempSync(join(tmpdir(),'release-out-'));try{writeFileSync(join(root,'good'),'ok');writeFileSync(join(outside,'secret'),'outside');symlinkSync(join(outside,'secret'),join(root,'link'));assert.equal(repositoryFile(root,'good').toString(),'ok');for(const p of ['../secret','/secret','a/../../secret','link'])assert.throws(()=>repositoryFile(root,p))}finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true})}});
test('release CI retains code gates and selects experimental evidence explicitly',()=>{const y=readFileSync(new URL('../../.github/workflows/release.yml',import.meta.url),'utf8');for(const cmd of ['npm ci','npm run lint','npm run typecheck','npm test','npm run smoke','npm run release:check -- --tier=experimental-alpha','npm publish --provenance --tag alpha'])assert.ok(y.includes(cmd),cmd);assert.ok(y.indexOf('release:check')<y.indexOf('npm publish --provenance'))});

test('a new native attempt makes previous success ineligible until completion',()=>{const dir=mkdtempSync(join(tmpdir(),'release-attempt-'));try{const f=fixture(),path=join(dir,'manifest.json');writeFileSync(path,JSON.stringify(f.manifest));assert.equal(f.check().ok,true);beginExperimentalAttempt(path,join(dir,'next-attempt'));assert.deepEqual(JSON.parse(readFileSync(join(dir,'next-attempt/previous-manifest.json'),'utf8')),f.manifest);const pending=JSON.parse(readFileSync(path,'utf8'));const result=checkExperimental({manifest:pending,version:'3.0.0-alpha.27',digest,now,read:(p:string)=>f.files.get(p)});assert.equal(result.ok,false,'a crash or failed attempt cannot reuse old success')}finally{rmSync(dir,{recursive:true,force:true})}});
