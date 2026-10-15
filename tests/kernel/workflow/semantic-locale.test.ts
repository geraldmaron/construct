import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brokerFixture } from '../broker/support.ts';
import { semanticContract } from '../../../src/kernel/workflow/semantic-review.ts';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const peer = `
import { openStateStore } from './src/kernel/state/open.ts';
import { getRun } from './src/kernel/state/runs.ts';
import { listSteps } from './src/kernel/state/steps.ts';
import { appendActivity } from './src/kernel/state/activity.ts';
import { projectResolver } from './src/kernel/source/resolver.ts';
import { canonicalReview, prepareSemanticReview, readPreparedReview, reviewDigest, reviewFreshnessProblems, reviewContractDigest, semanticReviewStatus } from './src/kernel/workflow/semantic-review.ts';
let raw=''; for await (const chunk of process.stdin) raw+=chunk;
const input=JSON.parse(raw), store=openStateStore(input.database);
try {
 const resolve=projectResolver(store,input.root), run=getRun(store,input.runId);
 const args={run,leased:input.leased,body:{artifact:'brief.md',data:{z:1,'ä':2,'😀':3}},evidence:[{ref:'z.md'},{ref:'ä.md'}],resolve,at:input.at};
 if(input.mode==='prepare') {
  const p=prepareSemanticReview(store,args);
  process.stdout.write(JSON.stringify({ref:p.ref,digest:p.digest,canonical:canonicalReview(p.bundle),contractDigest:p.bundle.contractDigest}));
 } else if(input.mode==='read') {
  const p=readPreparedReview(store,input.ref);
  const again=p?prepareSemanticReview(store,args):null;
  process.stdout.write(JSON.stringify({readable:!!p,problems:p?reviewFreshnessProblems(store,p,resolve):[],digest:again?.digest,ref:again?.ref,contractValid:p?reviewContractDigest(p.bundle)===p.bundle.contractDigest:false}));
 } else if(input.mode==='legacy') {
  const p=readPreparedReview(store,input.ref), bundle={...p.bundle}; delete bundle.canonicalization;
  bundle.stepRunId=listSteps(store,run.id).at(-1).id;
  bundle.contractDigest=reviewDigest(bundle.contract);
  const event=appendActivity(store,{kind:'semantic.prepared',channel:'kernel',runId:run.id,stepRunId:bundle.stepRunId,at:input.at,payload:{bundle,digest:reviewDigest(bundle)}});
  process.stdout.write(JSON.stringify({ref:'review:'+event.id}));
 } else {
  const p=readPreparedReview(store,input.ref);
  process.stdout.write(JSON.stringify({readable:!!p,problems:semanticReviewStatus(store,run,resolve,input.at).problems,unrelated:canonicalReview({canonicalization:'utf16-codeunit-v1',z:1,'ä':2})}));
 }
} finally {store.close();}
`;

test('new Unicode-bearing packets and unchanged resubmissions survive a locale handoff', () => {
  const f = brokerFixture();
  try {
    const started = f.broker.workflow.start({ workflowId: 'managed-outcome', input: { request: 'Review Unicode evidence' }, trigger: 'manual' });
    const contract = semanticContract({ words: 'Review Unicode evidence', data: { z: 1, ä: 2 } }, { host: 'synthetic-test-only', version: 'fixture', profile: 'fixture', digest: 'fixture' });
    f.broker.store.db.prepare('UPDATE workflow_runs SET bindings_json=? WHERE id=?').run(JSON.stringify({ ...(started.run.bindings as object), semanticContract: contract }), started.run.id);
    const leased = f.broker.workflow.claimNext({ runId: started.run.id }).packet!.leased;
    for (const file of ['brief.md', 'z.md', 'ä.md']) writeFileSync(join(f.box.cwd, file), 'Unicode fixture evidence.');
    const args = { database: f.broker.store.path, root: f.box.cwd, runId: started.run.id, leased, at: f.ctx.now() };
    const invoke = (locale: string, extra: Record<string, unknown>) => {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', peer], { cwd: repository, env: { ...f.ctx.env, LC_ALL: locale }, encoding: 'utf8', input: JSON.stringify({ ...args, ...extra }), timeout: 10_000 });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout) as { ref: string; digest: string; canonical: string; readable: boolean; problems: string[]; contractValid: boolean; unrelated: string };
    };
    const initial = invoke('en_US.UTF-8', { mode: 'prepare' });
    const migrated = invoke('sv_SE.UTF-8', { mode: 'read', ref: initial.ref });
    assert.equal(migrated.readable, true);
    assert.equal(migrated.contractValid, true);
    assert.deepEqual(migrated.problems, []);
    assert.equal(migrated.digest, initial.digest);
    assert.equal(migrated.ref, initial.ref, 'unchanged resubmission retains its prepared generation');
    const legacy = invoke('en_US.UTF-8', { mode: 'legacy', ref: initial.ref });
    const localLegacy = invoke('en_US.UTF-8', { mode: 'legacy-read', ref: legacy.ref });
    const foreignLegacy = invoke('sv_SE.UTF-8', { mode: 'legacy-read', ref: legacy.ref });
    assert.equal(localLegacy.readable, true, 'legacy serialization is preserved under its original locale');
    assert.equal(foreignLegacy.readable, false, 'a legacy digest must not be silently rehashed as a supported new packet');
    assert.match(foreignLegacy.problems.join(), /legacy.*locale-dependent canonicalization/);
    assert.notEqual(localLegacy.unrelated, foreignLegacy.unrelated, 'arbitrary user objects and other frozen hash callers retain legacy behavior');
  } finally { f.cleanup(); }
});
