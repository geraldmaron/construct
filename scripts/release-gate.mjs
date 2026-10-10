/** Release tiers are explicit. Experimental evidence never becomes full qualification. */
import {readFileSync, realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkRecord, descriptionsDigest} from './evals-live.mjs';
import {reviewDigest, semanticJudgmentProblems, SEMANTIC_OBLIGATIONS} from '../src/kernel/workflow/semantic-review.ts';
import {CASES, REQUEST, DISCLOSURES} from './experimental-cases.mjs';
export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
// The runner imports these fixture helpers; they are invocation bytes too.
export function surfaceDigest() {
  return reviewDigest({surface:descriptionsDigest(),helpers:Object.fromEntries(['tests/kernel/state/support.ts','tests/kernel/registry/support.ts'].map(path => [path,sha256(readFileSync(resolve(ROOT,path)))]))});
}
export function repositoryFile(root, name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.startsWith('/') || name.split('/').some(p => !p || p === '.' || p === '..')) throw Error('evidence path must be repository relative');
  const path = realpathSync(resolve(root, name)), rel = relative(realpathSync(root), path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) throw Error('evidence path escapes repository');
  return readFileSync(path);
}
export function validateNativeCase(record, c, digest, now) {
  const problems = [], fail = s => problems.push(`${c.id}: ${s}`);
  const {prepared: p, event: e} = record ?? {}, b = p?.bundle, i = e?.invocation;
  if (record?.caseId !== c.id || record.surfaceDigest !== digest) fail('case or candidate identity mismatch');
  if (!b || p.digest !== reviewDigest(b) || e?.bundleDigest !== p.digest || e.preparedRef !== p.ref || e.attempt !== b.attempt) fail('held bundle binding mismatch');
  if (!b || b.contractDigest !== reviewDigest(b.contract) || b.contract?.request?.input?.request !== REQUEST || reviewDigest(b.contract?.obligations) !== reviewDigest(SEMANTIC_OBLIGATIONS)) fail('frozen request or obligations mismatch');
  if (b?.body?.summary !== c.answer || b?.artifacts?.find(x => x.ref === 'answer.md')?.content?.text !== c.answer || b?.evidence?.find(x => x.ref === 'source.txt')?.content?.text !== c.source) fail('frozen case text mismatch');
  if (!Array.isArray(b?.problems) || b.problems.length || record?.filesUnchanged !== true || record?.canaryAbsent !== true) fail('fixture changed or held evidence unavailable');
  if (!i?.id || !i.sessionId || i.host !== 'codex' || i.hostVersion !== 'codex-cli 0.145.0' || i.model !== 'gpt-6-astra' || i.completed !== true || i.exitStatus !== 0 || i.timedOut !== false || e?.profile !== 'codex-held-text-v1' || e?.modelSource !== 'requested') fail('native invocation incomplete or unsupported');
  if (!/^[a-f0-9]{64}$/.test(e?.binaryDigest ?? '') || e.binaryDigest !== b?.contract?.reviewer?.digest || b?.contract?.reviewer?.profile !== e?.profile) fail('native executable identity mismatch');
  const start = Date.parse(e?.startedAt), end = Date.parse(record?.completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 300000 || end > now + 60000 || now - end > 7 * 86400000) fail('native time window missing, expired or unbounded');
  const obs = e?.observations;
  if (!Array.isArray(obs) || reviewDigest(obs) !== i?.transcriptDigest) fail('public transcript digest mismatch');
  else {
    const structural = obs.filter(o => o.type !== 'native.metadata_warning');
    if (structural.length !== 4 || structural[0]?.type !== 'thread.started' || structural[0].sessionId !== i?.sessionId || structural[1]?.type !== 'turn.started' || structural[2]?.type !== 'item.completed' || structural[2].itemType !== 'agent_message' || structural[3]?.type !== 'turn.completed') fail('unexpected public events, including possible tool use');
    try { if (reviewDigest(JSON.parse(structural[2].text)) !== reviewDigest(e.judgment)) fail('judgment differs from native final text'); } catch { fail('native final text is not the judgment'); }
  }
  const checks = e?.judgment?.checks;
  const allowed = new Set(['body','answer.md','source.txt']);
  if (!Array.isArray(checks) || checks.length !== SEMANTIC_OBLIGATIONS.length || new Set(checks.map(x => x.id)).size !== checks.length || SEMANTIC_OBLIGATIONS.some(o => !checks.some(x => x.id === o.id)) || checks.some(x => !['pass','fail'].includes(x.verdict) || typeof x.reason !== 'string' || !x.reason.trim() || !Array.isArray(x.refs) || !x.refs.length || x.refs.some(r => !allowed.has(r)))) fail('judgment coverage or reasons invalid');
  const expectedProblems = b ? semanticJudgmentProblems(b,e?.judgment) : ['no bundle'];
  if (reviewDigest(e?.problems) !== reviewDigest(expectedProblems)) fail('native execution or freshness problems');
  const before = record?.deliverableBefore, after = record?.deliverableAfter;
  if (!before?.id || !b?.runId || !b?.stepRunId || before.id !== after?.id || before.runId !== b.runId || after?.runId !== b.runId || before.stepRunId !== b.stepRunId || after?.stepRunId !== b.stepRunId || before.trustState !== 'draft' || after?.trustState !== 'draft' || reviewDigest(before.body) !== reviewDigest(b.body) || reviewDigest(after?.body) !== reviewDigest(b.body)) fail('exact persisted draft identity, body or trust was not preserved');
  if (c.expected === 'pass') {
    if (expectedProblems.length || record?.finalState !== 'succeeded' || record?.stepState !== 'succeeded') fail('correct control did not complete');
  } else if (!checks?.some(x => ['reasoning','support'].includes(x.id) && x.verdict === 'fail') || record?.finalState !== 'running' || record?.stepState !== 'leased') fail('incorrect control was not rejected and preserved');
  return problems;
}
export function checkExperimental({manifest, version, digest, read, now = Date.now()}) {
  const problems = [];
  if (!/^\d+\.\d+\.\d+-alpha\.\d+$/.test(version)) problems.push('experimental tier is restricted to numbered alpha versions');
  if (manifest?.format !== 'construct-experimental-alpha-v1' || manifest.tier !== 'experimental-alpha' || manifest.version !== version || manifest.surfaceDigest !== digest || manifest.broadQualification !== false) problems.push('manifest identity or tier mismatch');
  for (const key of DISCLOSURES) if (typeof manifest?.limitations?.[key] !== 'string' || manifest.limitations[key].trim().length < 40) problems.push(`missing substantive ${key} disclosure`);
  if (!Array.isArray(manifest?.cases) || manifest.cases.length !== CASES.length || new Set(manifest.cases.map(x => x.id)).size !== CASES.length) problems.push('exactly three distinct bounded controls required');
  const sessions = new Set();
  const entries = Array.isArray(manifest?.cases) ? manifest.cases : [];
  const fresh = Array.isArray(manifest?.freshUserObservations) ? manifest.freshUserObservations : [];
  for (const c of CASES) {
    const entry = entries.find(x => x.id === c.id);
    try {
      const bytes = read(entry?.path); if (sha256(bytes) !== entry?.sha256) throw Error('evidence hash mismatch');
      const r = JSON.parse(bytes); problems.push(...validateNativeCase(r,c,digest,now));
      if (sessions.has(r.event?.invocation?.sessionId)) problems.push(`${c.id}: independent session reused`);
      sessions.add(r.event?.invocation?.sessionId);
    } catch (e) { problems.push(`${c.id}: ${e.message}`); }
  }
  // Failed fresh-user observations are required disclosures, never converted to passes.
  if (!Array.isArray(manifest?.freshUserObservations) || manifest.freshUserObservations.length < 2) problems.push('fresh-user outcomes and their limits must be retained');
  for (const entry of fresh) {
    try { if (sha256(read(entry.path)) !== entry.sha256 || typeof entry.summary !== 'string' || entry.summary.length < 40) throw Error('invalid observation or disclosure'); }
    catch (e) { problems.push(`fresh-user observation: ${e.message}`); }
  }
  return {ok: problems.length === 0, problems, tier: 'experimental-alpha'};
}
export function checkRelease({tier = 'qualified', root = ROOT, now = Date.now()} = {}) {
  if (tier === 'qualified') return checkRecord({cut:true});
  if (tier !== 'experimental-alpha') return {ok:false,problems:['unknown release tier']};
  try {
    const version = JSON.parse(readFileSync(resolve(root,'package.json'))).version;
    const manifest = JSON.parse(repositoryFile(root,`docs/internal/releases/${version}.json`));
    return checkExperimental({manifest,version,digest:surfaceDigest(),read:name=>repositoryFile(root,name),now});
  } catch(e) { return {ok:false,problems:[e.message]}; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), tier = args.find(a => a.startsWith('--tier='))?.slice(7) ?? 'qualified';
  if (args.some(a => !a.startsWith('--tier=')) || args.filter(a => a.startsWith('--tier=')).length > 1) throw Error('usage: node scripts/release-gate.mjs [--tier=qualified|experimental-alpha]');
  const r = checkRelease({tier});
  for (const p of r.problems) process.stderr.write(`release gate: ${p}\n`);
  if (r.ok) console.log(`release gate: ${tier} evidence is current and meets its bounded policy; broader qualification is not inferred`);
  process.exitCode = r.ok ? 0 : 1;
}
