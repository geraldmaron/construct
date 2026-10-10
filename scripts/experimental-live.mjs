/** Explicit subscription-only bounded native release controls. Never run by CI. */
import {mkdirSync,writeFileSync,readFileSync,existsSync,copyFileSync,renameSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {freshStore} from '../tests/kernel/state/support.ts';
import {tmp,writeWorkflow,workflowManifest,step} from '../tests/kernel/registry/support.ts';
import {createSkillRegistry} from '../src/kernel/registry/skill-registry.ts';
import {createWorkflowRegistry} from '../src/kernel/registry/workflow-registry.ts';
import {updateLock} from '../src/kernel/registry/lockfile.ts';
import {emptyLock} from '../src/kernel/project/lock.ts';
import {createWorkflowService} from '../src/kernel/workflow/service.ts';
import {readPreparedReview} from '../src/kernel/workflow/semantic-review.ts';
import {executeSemanticReview,pinSemanticReviewer} from '../src/hosts/semantic-review.ts';
import {apiEnvironmentPresent} from '../src/hosts/delegation/adapters.ts';
import {surfaceDigest,sha256,ROOT,checkExperimental} from './release-gate.mjs';
import {CASES,REQUEST} from './experimental-cases.mjs';

function atomicJson(path,value) { const temp=path+'.tmp';writeFileSync(temp,JSON.stringify(value,null,2)+'\n');renameSync(temp,path); }
export function beginExperimentalAttempt(path,out) {
  mkdirSync(out,{recursive:true});
  if(existsSync(path))copyFileSync(path,join(out,'previous-manifest.json'));
  // An interrupted or failed rerun must not leave the old success eligible.
  atomicJson(path,{format:'construct-experimental-alpha-attempt-v1',status:'running',startedAt:new Date().toISOString()});
}
async function main() {
  if (apiEnvironmentPresent(process.env)) throw Error('experimental controls use the existing subscription, not API credentials');
  const version=JSON.parse(readFileSync(join(ROOT,'package.json'))).version;
  if (!/^\d+\.\d+\.\d+-alpha\.\d+$/.test(version)) throw Error('only numbered experimental alphas');
  const digest=surfaceDigest(), stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const out=join(ROOT,'docs/internal/releases',`${version}-${stamp}`),manifestPath=join(ROOT,'docs/internal/releases',`${version}.json`);
  beginExperimentalAttempt(manifestPath,out);
  const manifest={format:'construct-experimental-alpha-v1',tier:'experimental-alpha',version,surfaceDigest:digest,broadQualification:false,createdAt:new Date().toISOString(),limitations:{
    freshUser:'Fresh Codex and Cursor ordinary-prompt journeys are inconsistent: artifact correctness and managed completion remain unqualified; retained failures are not passes.',
    hostSupport:'The native semantic reviewer is a finite Codex CLI 0.145.0 profile using the requested gpt-6-astra model. Other host/version reviewer paths are unavailable; static six-host wiring is not live parity.',
    sourceAdapters:'Production API/MCP traversal, unknown schemas, complete access-scope coverage and changed-source outcomes are not generally qualified by these local synthetic cases.',
    composition:'Versioned method bindings and local qualification controls do not establish actual conditional specialist composition for arbitrary outcomes.',
    executor:'Persisted schedules require a real provisioned executor after session exit; the full timing, retry, idempotency and permission fault matrix remains open.',
    fullQualification:'The full live intake matrix remains absent. Claude subscription authentication and canonical Codex isolation are blocked. Experimental evidence cannot support broad readiness, stable or full qualification claims.'
  },cases:[],freshUserObservations:[]};
  // These observations are deliberately failures. They preserve the current product limitation.
  for(const [path,summary] of [
    ['docs/internal/implementation-2026-10-09/evidence/alpha27-release/fresh-cursor/semantic-assessment/assessment.json','Latest bounded Cursor artifacts failed the frozen independent rubric and its managed lifecycle remained unfinished; phase-scoped support judgments have limited coverage.'],
    ['docs/internal/implementation-2026-10-09/evidence/alpha27-release/fresh-codex/incomplete-observation.json','Latest Codex initial phase timed out without an artifact, and the changed phase had no result or completion receipt; no additional timeout or success is inferred.']
  ])manifest.freshUserObservations.push({path,sha256:sha256(readFileSync(join(ROOT,path))),summary});
  for(const c of CASES){
    const fx=freshStore(),dir=tmp();
    try{
      writeFileSync(join(dir.root,'AGENTS.md'),'Review only the supplied held-text bundle. Do not use tools or modify files.\n');
      writeFileSync(join(dir.root,'source.txt'),c.source);writeFileSync(join(dir.root,'answer.md'),c.answer);
      writeWorkflow(join(dir.root,'workflows'),'probe',workflowManifest('probe','1.0.0',[step('final',{outputs:['summary','artifact']})],{inputSchema:{request:'string'},requiredInputs:['request'],deliverable:{kind:'outcome',schema:'outcome/v1',challenge:false}}));
      const skills=createSkillRegistry({builtinDir:join(dir.root,'skills'),projectDir:null}),workflows=createWorkflowRegistry({builtinDir:join(dir.root,'workflows'),projectDir:null});
      const pin=pinSemanticReviewer('codex',process.env,dir.root);if(!pin)throw Error('No qualified startup native identity');
      const resolveEvidence=ref=>{if(!['source.txt','answer.md'].includes(ref))return null;const text=readFileSync(join(dir.root,ref),'utf8');return {ref,kind:'file',provenance:'witnessed',path:join(dir.root,ref),text,digest:createHash('sha256').update(text).digest('hex')};};
      const now=()=>new Date().toISOString();let n=0;
      const svc=createWorkflowService({store:fx.store,skills,workflows,lock:updateLock(emptyLock(),skills.list(),workflows.list()).lock,host:{hostId:'codex',sessionId:'experimental-producer',executorId:'experimental-producer',available:new Set(['read_project_context','model_review','ask_user']),maxTier:'draft',restrictions:[],budgetCents:null},semanticReviewer:pin,sources:()=>[],projectWritePolicy:'managed',resolveEvidence,now,nextId:p=>`${p}-${++n}`});
      const run=svc.start({workflowId:'probe',input:{request:REQUEST},trigger:'manual'}).run,leased=svc.claimNext({runId:run.id}).packet.leased;
      const submission={leased,output:{summary:c.answer,artifact:'answer.md'},evidence:[{ref:'source.txt'}]};
      const pending=svc.submit(submission),prepared=readPreparedReview(fx.store,pending.semanticReview?.preparedRef);
      if(!prepared)throw Error('No prepared candidate');
      const deliverableBefore=svc.status(run.id).deliverables.find(d=>d.stepRunId===leased.id);
      console.log(JSON.stringify({case:c.id,status:'native-review-started',at:now()}));
      await executeSemanticReview({store:fx.store,runId:run.id,stepRunId:leased.id,token:leased.nonce,preparedRef:prepared.ref,host:'codex',model:'gpt-6-astra',env:process.env,root:dir.root,resolve:resolveEvidence,now,timeoutMs:180000});
      const final=svc.submit(submission);
      const events=fx.store.db.prepare("SELECT payload_json FROM activity_events WHERE kind = 'semantic.executed'").all().map(r=>JSON.parse(r.payload_json));
      if(events.length!==1)throw Error('Expected one native observation');
      const record={caseId:c.id,surfaceDigest:digest,prepared,event:events[0],deliverableBefore,deliverableAfter:svc.status(run.id).deliverables.find(d=>d.stepRunId===leased.id),completedAt:now(),finalState:final.run.state,stepState:final.step.state,filesUnchanged:readFileSync(join(dir.root,'source.txt'),'utf8')===c.source&&readFileSync(join(dir.root,'answer.md'),'utf8')===c.answer,canaryAbsent:!existsSync(join(dir.root,'injected.txt'))};
      const path=join(out,`${c.id}.json`);writeFileSync(path,JSON.stringify(record,null,2)+'\n');
      manifest.cases.push({id:c.id,path:relative(ROOT,path),sha256:sha256(readFileSync(path))});
      console.log(JSON.stringify({case:c.id,finalState:record.finalState,problems:events[0].problems}));
    }catch(error){writeFileSync(join(out,`${c.id}.error.json`),JSON.stringify({caseId:c.id,error:error.message,at:new Date().toISOString()},null,2)+'\n');throw error;}
    finally{fx.cleanup();dir.cleanup();}
  }
  if(surfaceDigest()!==digest)throw Error('Candidate changed during native controls; no manifest recorded');
  const checked=checkExperimental({manifest,version,digest,read:path=>readFileSync(join(ROOT,path))});
  writeFileSync(join(out,'assessment.json'),JSON.stringify(checked,null,2)+'\n');
  if(!checked.ok)throw Error(checked.problems.join('\n'));
  const path=manifestPath;atomicJson(path,manifest);
  console.log(`Experimental evidence recorded: ${relative(ROOT,path)}; full qualification remains unproven.`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
