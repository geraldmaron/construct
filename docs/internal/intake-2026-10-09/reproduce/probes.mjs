// Safe diagnostic probes. Run: node probes.mjs /path/to/construct
// Imports repository code unchanged; all writes are isolated fixtures, removed afterward.
import { mkdtempSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2] ?? '.');
const imp = p => import(pathToFileURL(join(root, p)).href);
const { brokerFixture } = await imp('tests/kernel/broker/support.ts');
const { TOOLS, toolsFor } = await imp('src/kernel/broker/tools.ts');
const { readDirectorySource } = await imp('src/hosts/sources/directory.ts');
const { hostCapabilitiesFor } = await imp('src/cli/broker-context.ts');
const { provides } = await imp('src/kernel/registry/capability-registry.ts');
const { currentManifest } = await imp('src/kernel/source/manifest.ts');
const { qualifySkill } = await imp('src/kernel/registry/qualification.ts');
const results = [];
const call = async (fx, name, args={}) => { const t=TOOLS.find(t=>t.name===name); return t.run(fx.broker,t.validate(args)); };
const fixture = async (id, fn, surface='interactive') => {
  const fx=brokerFixture(surface);
  try {results.push({id,...await fn(fx)});} catch(e) {results.push({id,error:String(e),stack:e.stack});}
  finally {fx.cleanup();}
};
await fixture('P01-inferred-capabilities', async fx => {
  const h=hostCapabilitiesFor({client:'unknown',surface:'interactive',sessionId:'empty',executorId:'empty',actor:'model'},'empty',[]);
  const reading=await call(fx,'classify_request',{kind:'manage',words:'Research our customer API and prepare a brief.',deliverable:{kind:'research/brief'}});
  return {noReadersOrToolInventory:{available:[...h.available],jiraRead:provides(h,'read_source:jira'),hrisWrite:provides(h,'write_source:hris'),probed:h.probed,exercised:[...h.exercised]},matches:reading.matches.map(m=>({workflow:m.workflowId,status:m.status}))};
});
await fixture('P02-maintain-does-not-schedule',async fx=>{
  const r=await call(fx,'classify_request',{kind:'maintain',words:'Every Monday at nine UTC produce a project digest.',deliverable:{kind:'other',describe:'project digest'},schedule:{cron:'0 9 * * 1',timezone:'UTC'}});
  const started=await call(fx,'start_outcome',{workflowId:'managed-outcome',intake:r.intake});
  return {next:r.next,started,triggerCount:fx.broker.triggers.list().length,tools:toolsFor('interactive').map(t=>t.name)};
});
await fixture('P03-clock-without-executor',async fx=>{
  const t=fx.broker.triggers.define({id:'weekly',workflowId:'managed-outcome',kind:'schedule',scheduleExpression:'0 9 * * 1',timezone:'UTC',adapter:'cron',overlap:'skip',maxTier:'project_write',delivery:{destination:'inbox'},input:{request:'Summarize the project'}});
  return {defined:t.id,fire:fx.broker.triggers.fire({triggerId:t.id,firingKey:'one'}),repeat:fx.broker.triggers.fire({triggerId:t.id,firingKey:'one'}),ciRecipe:fx.broker.triggers.recipe(t.id,'github-actions')};
},'headless');
{
 const dir=mkdtempSync(join(tmpdir(),'construct-intake-hash-'));const file=join(dir,'decision.md');
 try {
  const stamp=new Date('2026-10-01T12:00:00Z');
  writeFileSync(file,'ALLOW');utimesSync(file,stamp,stamp);
  const a=await readDirectorySource({sourceId:'dir',kind:'directory',locator:dir});
  writeFileSync(file,'DENY!');utimesSync(file,stamp,stamp);
  const b=await readDirectorySource({sourceId:'dir',kind:'directory',locator:dir});
  utimesSync(file,stamp,new Date(stamp.getTime()+10000));
  const c=await readDirectorySource({sourceId:'dir',kind:'directory',locator:dir});
  results.push({id:'P04-size-mtime-cache',sameMetadataChangedBytesDetected:a.report.digest!==b.report.digest,changedMtimeDetected:b.report.digest!==c.report.digest,coverage:b.report.coverage});
 }finally{rmSync(dir,{recursive:true,force:true});}
}
await fixture('P05-same-source-time-new-text',async fx=>{
 await call(fx,'sources',{action:'declare',id:'api',kind:'other'});
 const item={ref:'metric',updatedAt:'2026-09-01T00:00:00Z',url:'https://example.invalid/metric'};
 const a=await call(fx,'sources',{action:'report',id:'api',items:[{...item,text:'Revenue is 100 dollars.'}]});
 const b=await call(fx,'sources',{action:'report',id:'api',items:[{...item,text:'Revenue is 999 dollars.'}]});
 return {first:a.outcome,second:b.outcome,changes:b.changes,storedText:currentManifest(fx.broker.store,'api')[0].text};
});
await fixture('P06-reported-evidence-not-attestation',async fx=>{
 await call(fx,'sources',{action:'declare',id:'web',kind:'other'});
 const absent=await call(fx,'check_answer',{answer:'The service is available.',citations:[{ref:'https://example.invalid/health'}]});
 await call(fx,'sources',{action:'report',id:'web',items:[{ref:'health',url:'https://example.invalid/health',text:'The service is available.'}]});
 const present=await call(fx,'check_answer',{answer:'The service is available.',citations:[{ref:'https://example.invalid/health',excerpt:'The service is available.'}]});
 return {networkRequests:0,withoutReport:absent,withSyntheticReport:present};
});
await fixture('P07-substantive-contradiction',async fx=>{
 writeFileSync(join(fx.broker.root,'decision.md'),'The service does not store customer passwords.');
 return {check:await call(fx,'check_answer',{answer:'The service stores customer passwords.',citations:[{ref:'decision.md'}]})};
});
await fixture('P08-unwitnessed-verification',async fx=>{
 const started=await call(fx,'start_outcome',{workflowId:'managed-outcome',input:{request:'Prepare a local summary.'}});
 const submit=async(output,evidence=[])=>{const w=(await call(fx,'claim_work',{runId:started.run.id})).work;return call(fx,'submit_work',{stepRunId:w.stepRunId,token:w.token,output,evidence});};
 await submit({plan:['Read README and summarize.'],assumptions:[],blockers:[]});
 const done=await submit({summary:'The project is a demo.',findings:['The project is a demo.'],changes:[],artifact:null},[{ref:'README.md'}]);
 const verified=await submit({verification:'Checks passed.',passed:true});
 return {commandsExecuted:0,doStep:done.step,verify:verified};
});
await fixture('P09-qualification-is-file-presence',async fx=>{
 const skill=fx.broker.skills.get('construct');
 const fake={...skill,manifest:{...skill.manifest,evals:['evals/activation-never-run.json','evals/behavior-never-run.json']},files:[]};
 const q=qualifySkill(fake,{kind:'skill',id:'construct',state:'current',why:'synthetic current lock'},'A benign method.');
 return {actualEvalExecutions:0,syntheticFilenames:q};
});
await fixture('P10-plain-answer-no-run',async fx=>{
 const before=fx.broker.store.db.prepare('SELECT count(*) AS n FROM workflow_runs').get().n;
 const r=await call(fx,'classify_request',{kind:'answer',words:'What does a workflow mean?'});
 const after=fx.broker.store.db.prepare('SELECT count(*) AS n FROM workflow_runs').get().n;
 return {recorded:r.recorded,before,after,next:r.next};
});
process.stdout.write(JSON.stringify({runtime:process.version,results},null,2)+'\n');
