import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const repo=(await import('node:url')).fileURLToPath(new URL('../../../../../',import.meta.url)).replace(/\/$/,'');
const [{freshStore},{tmp,writeWorkflow,workflowManifest,step},{createSkillRegistry},{createWorkflowRegistry},{updateLock},{emptyLock},{createWorkflowService},{executeSemanticReview,pinSemanticReviewer}] = await Promise.all([
 import(repo+'/tests/kernel/state/support.ts'),import(repo+'/tests/kernel/registry/support.ts'),import(repo+'/src/kernel/registry/skill-registry.ts'),import(repo+'/src/kernel/registry/workflow-registry.ts'),import(repo+'/src/kernel/registry/lockfile.ts'),import(repo+'/src/kernel/project/lock.ts'),import(repo+'/src/kernel/workflow/service.ts'),import(repo+'/src/hosts/semantic-review.ts')]);
const out=join(import.meta.dirname,'native-semantic-attempt-7');mkdirSync(out,{recursive:true});
const cases=[{id:'correct',answer:'Plans A and B each save $2,000 net annually, so neither leads on the stated financial evidence. If A saves twice as many hours, its net benefit becomes $8,000 annually. Other qualitative differences are unknown from the supplied data.'},{id:'incorrect-counterfactual',answer:'Plans A and B each save $2,000 net annually, so neither leads on the stated financial evidence. If A saves twice as many hours, its net benefit becomes $11,000 annually. Other qualitative differences are unknown from the supplied data.'}];
const request='Compare the net annual benefit of plans A and B using the source, recommend based on that comparison, and calculate A’s net annual benefit if its hours saved double. This is an assessment only.';
const source='Current approved planning data: A saves 120 staff hours annually and costs $4,000 annually. B saves 100 staff hours annually and costs $3,000 annually. An avoided staff hour is valued at $50. For the counterfactual, only A’s hours saved double; its annual cost and hourly value stay fixed.';
writeFileSync(join(out,'frozen-cases.json'),JSON.stringify({request,source,cases,expected:{correct:'pass','incorrect-counterfactual':'reasoning failure'},model:'gpt-6-astra',timeoutMs:180000},null,2));
for(const c of cases){
 const fx=freshStore(),dir=tmp();
 try{
  writeFileSync(join(dir.root,'AGENTS.md'),'Review only the supplied held-text bundle. Do not use tools or modify files.\n');
  writeFileSync(join(dir.root,'source.txt'),source);writeFileSync(join(dir.root,'answer.md'),c.answer);
  writeWorkflow(join(dir.root,'workflows'),'probe',workflowManifest('probe','1.0.0',[step('final',{outputs:['summary','artifact']})],{inputSchema:{request:'string'},requiredInputs:['request'],deliverable:{kind:'outcome',schema:'outcome/v1',challenge:false}}));
  const skills=createSkillRegistry({builtinDir:join(dir.root,'skills'),projectDir:null}),workflows=createWorkflowRegistry({builtinDir:join(dir.root,'workflows'),projectDir:null});
  const pin=pinSemanticReviewer('codex',process.env,dir.root);if(!pin)throw Error('No qualified startup native identity');
  const resolve=ref=>{if(!['source.txt','answer.md'].includes(ref))return null;const text=readFileSync(join(dir.root,ref),'utf8');return {ref,kind:'file',provenance:'witnessed',path:join(dir.root,ref),text,digest:createHash('sha256').update(text).digest('hex')};};
  const now=()=>new Date().toISOString();let n=0;
  const svc=createWorkflowService({store:fx.store,skills,workflows,lock:updateLock(emptyLock(),skills.list(),workflows.list()).lock,host:{hostId:'codex',sessionId:'test-producer',executorId:'test-producer',available:new Set(['read_project_context','model_review','ask_user']),maxTier:'draft',restrictions:[],budgetCents:null},semanticReviewer:pin,sources:()=>[],projectWritePolicy:'managed',resolveEvidence:resolve,now,nextId:p=>`${p}-${++n}`});
  const run=svc.start({workflowId:'probe',input:{request},trigger:'manual'}).run,leased=svc.claimNext({runId:run.id}).packet.leased;
  const submit={leased,output:{summary:c.answer,artifact:'answer.md'},evidence:[{ref:'source.txt'}]};
  const pending=svc.submit(submit);if(!pending.semanticReview?.preparedRef)throw Error('No prepared candidate');
  console.log(JSON.stringify({case:c.id,status:'native-review-started',at:now()}));
  const review=await executeSemanticReview({store:fx.store,runId:run.id,stepRunId:leased.id,token:leased.nonce,preparedRef:pending.semanticReview.preparedRef,host:'codex',model:'gpt-6-astra',env:process.env,root:dir.root,resolve,now,timeoutMs:180000});
  const final=svc.submit(submit);
  const result={case:c.id,review,finalState:final.run.state,stepState:final.step.state,at:now(),pin:{...pin,binary:'native-installed-binary'},events:fx.store.db.prepare("SELECT payload_json FROM activity_events WHERE kind = 'semantic.executed'").all().map(r=>JSON.parse(r.payload_json)),observedFilesUnchanged:readFileSync(join(dir.root,'source.txt'),'utf8')===source&&readFileSync(join(dir.root,'answer.md'),'utf8')===c.answer};
  writeFileSync(join(out,c.id+'.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({case:c.id,passed:review.passed,finalState:final.run.state,problems:review.receipt.problems}));
 }catch(e){writeFileSync(join(out,c.id+'.error.json'),JSON.stringify({error:e.message,at:new Date().toISOString()},null,2));console.log(JSON.stringify({case:c.id,error:e.message}));}
 finally{fx.cleanup();dir.cleanup();}
}
