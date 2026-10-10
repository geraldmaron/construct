// Public installed CLI and MCP only. No imports from Construct implementation/tests.
// This exercises public surfaces; the scripted caller is NOT a live implicit-routing eval.
import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const base=join(dirname(fileURLToPath(import.meta.url)),'consumer');
const project=join(base,'project');
const env=JSON.parse(readFileSync(join(base,'public-env.json'),'utf8'));
const observations=[], transcript=[];
function save(){writeFileSync(join(base,'usage-observations.json'),JSON.stringify(observations,null,2));writeFileSync(join(base,'usage-transcript.json'),JSON.stringify(transcript,(k,v)=>/^(token|claimToken)$/.test(k)?'[omitted]':v,2));}
function cli(args){const p=spawnSync('construct',args,{cwd:project,env,encoding:'utf8',timeout:15000});const r={command:['construct',...args],exit:p.status,stdout:p.stdout,stderr:p.stderr};transcript.push(r);save();return r;}
function connect(command,args){
 const p=spawn(command,args,{cwd:project,env,stdio:['pipe','pipe','pipe']});let n=0;const pending=new Map();
 p.stderr.on('data',b=>transcript.push({stderr:b.toString()}));
 createInterface({input:p.stdout}).on('line',line=>{let r;try{r=JSON.parse(line)}catch{return;}transcript.push({response:r});const w=pending.get(r.id);if(w){pending.delete(r.id);clearTimeout(w.timer);r.error?w.reject(new Error(JSON.stringify(r.error))):w.resolve(r.result)}save();});
 const rpc=(method,params={})=>new Promise((resolve,reject)=>{const id=++n;const r={jsonrpc:'2.0',id,method,params};transcript.push({command,args,request:r});pending.set(id,{resolve,reject,timer:setTimeout(()=>reject(new Error('RPC timeout '+method)),15000)});p.stdin.write(JSON.stringify(r)+'\n');});
 return {rpc,call:async(name,args={})=>{const r=await rpc('tools/call',{name,arguments:args});return r.structuredContent??r;},close:()=>new Promise(resolve=>{p.once('exit',resolve);p.stdin.end();setTimeout(()=>p.kill('SIGTERM'),1000).unref();}),init:()=>rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'isolated-public-usage-audit',version:'1'}})};
}
let metric={id:'metric',value:100,unit:'USD',status:'healthy',updatedAt:'2026-10-01T12:00:00Z'};
const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/openapi.json'?{openapi:'3.1.0',info:{title:'Harbor fixture',version:'1'},paths:{'/metric':{get:{responses:{'200':{description:'metric'}}}}}}:metric));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port+'/metric';
let c,fixture;
try {
 c=connect('construct',['serve','--client=codex']);await c.init();
 const boot=await c.call('bootstrap');const list=await c.rpc('tools/list');
 observations.push({id:'U01-public-bootstrap',version:boot.construct.version,sourceHealth:boot.sources,capabilities:boot.capabilities,tools:list.tools.map(t=>t.name)});
 observations.push({id:'U02-question',reading:await c.call('classify_request',{kind:'answer',words:'What must this project avoid?'}),contradictoryAnswer:await c.call('check_answer',{answer:'The service stores customer passwords.',citations:[{ref:'docs/decision.md'}]})});
 const apiRead=await fetch(url).then(r=>r.json());
 fixture=connect(process.execPath,[join(base,'../fixture-mcp.mjs')]);await fixture.init();const fixtureTools=await fixture.rpc('tools/list');const fixtureRead=await fixture.rpc('tools/call',{name:'read_metric',arguments:{}});
 observations.push({id:'U03-real-controlled-source-reads',api:{url,read:apiRead},mcp:{tools:fixtureTools,read:fixtureRead},beforeDeclaration:await c.call('sources',{action:'list'})});
 await c.call('sources',{action:'declare',id:'metrics-api',kind:'other',purpose:'Controlled local HTTP metric'});
 await c.call('sources',{action:'report',id:'metrics-api',items:[{ref:'metric',url,updatedAt:apiRead.updatedAt,text:JSON.stringify(apiRead)}]});
 await c.call('sources',{action:'declare',id:'metrics-mcp',kind:'other',purpose:'Controlled MCP metric'});
 await c.call('sources',{action:'report',id:'metrics-mcp',items:[{ref:'metric-mcp',url:'https://example.invalid/metric-mcp',updatedAt:apiRead.updatedAt,text:fixtureRead.content[0].text}]});
 const reading=await c.call('classify_request',{kind:'manage',words:'Put together a short digest using the metric API and local architecture decisions.',deliverable:{kind:'other',describe:'short project digest'},target:'digest.md',sources:[{name:'metric API',id:'metrics-api',role:'read'},{name:'local architecture decisions',id:'local-docs',role:'read'}]});
 const started=await c.call('start_outcome',{workflowId:'managed-outcome',intake:reading.intake});const runId=started.run.id;
 const submit=async(output,evidence=[])=>{const w=(await c.call('claim_work',{runId})).work;if(!w)throw new Error('No claimed step');return c.call('submit_work',{stepRunId:w.stepRunId,token:w.token,output,evidence});};
 await submit({plan:['Read the metric API and local decision, write the digest, run the fixture check.'],assumptions:[],blockers:[]});
 writeFileSync(join(project,'digest.md'),'# Harbor digest\n\nThe metric API reports healthy service status. The architecture decision forbids storing customer passwords.\n');
 const done=await submit({summary:'The metric API reports healthy status.',findings:['The metric API reports healthy status.','The service does not store customer passwords.'],changes:['digest.md'],artifact:'digest.md'},[{ref:url},{ref:'docs/decision.md'}]);
 const test=spawnSync('npm',['test'],{cwd:project,env,encoding:'utf8',timeout:15000});transcript.push({command:['npm','test'],exit:test.status,stdout:test.stdout,stderr:test.stderr});
 const verified=await submit({verification:{command:'npm test',exitStatus:test.status,revision:'disposable-fixture',result:'The report names its source.'},passed:test.status===0},[{ref:'checks.test.mjs'}]);
 observations.push({id:'U04-public-outcome',started,done,actualTestExit:test.status,verified});
 metric={...metric,value:999,unit:'cents',status:'degraded',schemaVersion:2};const changed=await fetch(url).then(r=>r.json());
 const sameTime=await c.call('sources',{action:'report',id:'metrics-api',items:[{ref:'metric',url,updatedAt:changed.updatedAt,text:JSON.stringify(changed)}]});
 metric.updatedAt='2026-10-02T12:00:00Z';const newer=await fetch(url).then(r=>r.json());
 const newTime=await c.call('sources',{action:'report',id:'metrics-api',items:[{ref:'metric',url,updatedAt:newer.updatedAt,text:JSON.stringify(newer)}]});
 observations.push({id:'U05-api-schema-and-content-change',sameTimestamp:sameTime,newTimestamp:newTime,status:await c.call('run_status',{runId})});
 const accepted=await c.call('promote_deliverable',{deliverableId:verified.deliverable.id,to:'accepted',reason:'Request acceptance for the disposable test only.'});
 observations.push({id:'U06-permission-boundary',acceptanceRequest:accepted});
 const interrupted=await c.call('start_outcome',{workflowId:'managed-outcome',input:{request:'Write a second local summary after resumption.'}});const wr=(await c.call('claim_work',{runId:interrupted.run.id})).work;
 await c.call('submit_work',{stepRunId:wr.stepRunId,token:wr.token,output:{plan:['Read project files after resume.'],assumptions:[],blockers:[]},evidence:[]});
 await c.close();c=connect('construct',['serve','--client=codex']);await c.init();await c.call('bootstrap');
 observations.push({id:'U07-resume-new-server',status:await c.call('run_status',{runId:interrupted.run.id}),claimed:await c.call('claim_work',{runId:interrupted.run.id})});
 cli(['run','cancel',interrupted.run.id]);
 const scheduled=await c.call('classify_request',{kind:'maintain',words:'Every Monday at nine UTC give me a digest of this project.',deliverable:{kind:'other',describe:'project digest'},schedule:{cron:'0 9 * * 1',timezone:'UTC'}});
 const scheduleCommand=cli(['workflow','schedule','managed-outcome','--cron=0 9 * * 1','--timezone=UTC','--trigger-id=weekly','--max-tier=project_write','--input=request=Produce the weekly digest']);
 const recipe=cli(['workflow','recipe','weekly','--clock=github-actions']);const fire=cli(['workflow','fire','weekly','--key=disposable-tick','--json']);const repeat=cli(['workflow','fire','weekly','--key=disposable-tick','--json']);
 observations.push({id:'U08-schedule',reading:scheduled,definition:scheduleCommand,recipe,fire,repeat});
 cli(['workflow','disable','weekly']);
 observations.push({id:'U09-no-external-source-write',externalWrites:0,clockInstalled:false,productionSchedule:false});
}catch(e){observations.push({id:'usage-error',error:String(e),stack:e.stack});process.exitCode=1;}
finally {if(c)await c.close();if(fixture)await fixture.close();await new Promise(resolve=>server.close(resolve));save();}
console.log(JSON.stringify(observations.map(o=>({id:o.id,error:o.error})),null,2));
