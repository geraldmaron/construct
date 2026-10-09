from pathlib import Path
import subprocess,json,hashlib
base=Path(__file__).resolve().parent/'consumer'
env=json.loads((base/'public-env.json').read_text())
project=base/'project'
(base/'home/.codex').mkdir(exist_ok=True)
(project/'docs').mkdir(exist_ok=True)
(project/'README.md').write_text('# Harbor alpha trial\n\nA disposable project measuring a small service.\nNo customer data.\n')
(project/'docs/decision.md').write_text('# Architecture decision\n\nThe service does not store customer passwords.\nNever publish source material outside this project.\n')
(project/'package.json').write_text(json.dumps({'name':'harbor-trial','version':'1.0.0','private':True,'scripts':{'test':'node --test checks.test.mjs'}}))
(project/'checks.test.mjs').write_text("import {test} from 'node:test'; import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs'; test('the report names its source',()=>assert.match(readFileSync('digest.md','utf8'),/metric/));\n")
commands=[['git','init','-q'],['construct','version'],['construct','doctor','--json'],['construct','init'],['construct','init','--client=codex'],['construct','status','--json'],['construct','doctor','--json'],['construct','init','--client=codex'],['construct','source','add','local-docs','--kind=directory','--locator='+str(project/'docs'),'--purpose=local architecture decisions'],['construct','source','refresh','local-docs','--json'],['construct','source','list','--json'],['construct','source','add','sample-api','--kind=api','--locator=http://127.0.0.1/sample','--purpose=sample API']]
records=[]
for cmd in commands:
 try:
  p=subprocess.run(cmd,env=env,cwd=project,text=True,capture_output=True,timeout=35)
  r={'command':cmd,'exit':p.returncode,'stdout':p.stdout,'stderr':p.stderr}
 except subprocess.TimeoutExpired as e:r={'command':cmd,'timeout':35,'stdout':str(e.stdout),'stderr':str(e.stderr)}
 records.append(r)
 (base/'setup-transcript.json').write_text(json.dumps(records,indent=2))
 print(json.dumps({'command':cmd,'exit':r.get('exit'),'timeout':r.get('timeout'),'excerpt':(r['stdout']+r['stderr'])[:500]}),flush=True)
