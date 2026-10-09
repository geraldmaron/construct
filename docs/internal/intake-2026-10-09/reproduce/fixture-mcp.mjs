// Controlled sample source, not Construct. Standard newline-delimited MCP.
import { createInterface } from 'node:readline';
for await (const line of createInterface({input:process.stdin})) {
 const r=JSON.parse(line);if(r.id===undefined)continue;
 let result;
 if(r.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'harbor-metric-fixture',version:'1'}};
 else if(r.method==='tools/list')result={tools:[{name:'read_metric',description:'Read the controlled Harbor metric.',inputSchema:{type:'object',properties:{},additionalProperties:false}}]};
 else if(r.method==='tools/call')result={content:[{type:'text',text:JSON.stringify({id:'metric',value:100,unit:'USD',status:'degraded',updatedAt:'2026-10-01T12:00:00Z'})}]};
 else {process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,error:{code:-32601,message:'Unsupported fixture method'}})+'\n');continue;}
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\n');
}
