/** Executed qualification is scoped to a concrete evaluator, host and corpus. */
import { createHash } from 'node:crypto';
import type { RefResolver } from '../project/evidence.ts';
import type { StateStore } from '../state/open.ts';
import type { ContentReceipt } from '../workflow/verification.ts';

export const QUALIFICATION_COVERAGE = ['explicit', 'implicit', 'contextual', 'negative', 'held_out', 'composition'] as const;
export interface NativeCaseWitness {
  readonly caseId: string; readonly host: string; readonly hostVersion: string; readonly model: string; readonly modelSource: 'requested'; readonly skillDigest: string;
  readonly producer: { readonly invocationId: string; readonly sessionId: string | null; readonly receipt: string; readonly transcriptDigest: string; readonly exitStatus: number | null };
  readonly reviewer: { readonly invocationId: string; readonly sessionId: string | null; readonly receipt: string; readonly transcriptDigest: string; readonly exitStatus: number | null };
  readonly artifacts: readonly string[]; readonly application: 'applied' | 'stood_down' | 'unknown'; readonly checks: Readonly<Record<string, string>>; readonly caseRef: string;
}
export interface QualificationSuite {
  readonly formatVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly scope: string;
  readonly host: string;
  readonly model: string;
  readonly verifier: { readonly id: string; readonly version: string; readonly argv: readonly string[]; readonly files: readonly string[] };
  readonly native?: { readonly adapter: 'codex' };
  readonly cases: readonly { readonly native?: { readonly prompt: string; readonly files: readonly { readonly from: string; readonly to: string }[]; readonly outputs: readonly string[]; readonly rubric: string }; readonly id: string; readonly kind: typeof QUALIFICATION_COVERAGE[number]; readonly domain: string; readonly checks: readonly string[] }[];
}
export interface QualificationRecord {
  readonly formatVersion: 1;
  readonly skill: { readonly id: string; readonly version: string; readonly digest: string };
  readonly suite: QualificationSuite;
  readonly suiteDigest: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly expiresAt: string;
  readonly exitStatus: number | null;
  readonly passed: boolean;
  readonly assurance?: 'executed_evaluator_report' | 'native_execution_and_independent_review';
  readonly nativeWitnesses?: readonly NativeCaseWitness[];
  readonly problems: readonly string[];
  readonly evidence: readonly ContentReceipt[];
  readonly results: unknown;
}
export function qualificationRecords(store: StateStore, skillId: string): { id: number; record: QualificationRecord }[] {
  return (store.db.prepare("SELECT id, payload_json FROM activity_events WHERE kind = 'skill.evaluation_observed' AND channel = 'host_evaluation' AND json_extract(payload_json, '$.skill.id') = ? ORDER BY id DESC").all(skillId) as { id: number; payload_json: string }[]).map((row) => ({ id: row.id, record: JSON.parse(row.payload_json) as QualificationRecord }));
}
export function validateQualificationSuite(value: unknown): QualificationSuite {
  const suite = value as QualificationSuite;
  const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 2000;
  if (!suite || suite.formatVersion !== 1 || ![suite.id, suite.version, suite.scope, suite.host, suite.model, suite.verifier?.id, suite.verifier?.version].every(text)) throw new Error('qualification suite needs version, identity, scope, host/model and verifier identity');
  if (!Array.isArray(suite.verifier.argv) || !suite.verifier.argv.length || suite.verifier.argv.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) throw new Error('suite verifier.argv must be an explicit argument array');
  if (!Array.isArray(suite.verifier.files) || !suite.verifier.files.length || suite.verifier.files.some((ref) => !text(ref))) throw new Error('suite verifier needs its project code/file references for invalidation');
  if (!Array.isArray(suite.cases) || suite.cases.length < QUALIFICATION_COVERAGE.length || suite.cases.length > 200 || new Set(suite.cases.map((c) => c.id)).size !== suite.cases.length) throw new Error('qualification requires unique bounded cases');
  for (const item of suite.cases) if (!text(item.id) || !text(item.domain) || !QUALIFICATION_COVERAGE.includes(item.kind) || !Array.isArray(item.checks) || !item.checks.length || item.checks.some((c: unknown) => !text(c)) || new Set(item.checks).size !== item.checks.length) throw new Error('each qualification case needs kind, domain and predetermined unique checks');
  if (QUALIFICATION_COVERAGE.some((kind) => !suite.cases.some((c) => c.kind === kind))) throw new Error('qualification requires explicit, implicit, contextual, negative, held_out and composition coverage');
  if (new Set(suite.cases.map((c) => c.domain)).size < 2) throw new Error('qualification needs more than one domain');
  if (suite.native) {
    if (suite.native.adapter !== 'codex' || suite.host !== 'codex') throw new Error('native suite requires the codex adapter and host');
    for (const c of suite.cases) {
      const n = c.native;
      if (!n || !text(n.prompt) || !text(n.rubric) || !Array.isArray(n.files) || n.files.length > 20 || n.files.some((f: { from?: unknown; to?: unknown }) => !text(f.from) || !text(f.to)) || !Array.isArray(n.outputs) || !n.outputs.length || n.outputs.length > 10 || n.outputs.some((f: unknown) => !text(f))) throw new Error('native cases require bounded prompt, fixture files, new output files and held-out rubric');
      if (!/^[a-zA-Z0-9_-]+$/.test(c.id)) throw new Error('native case id must be a safe path component');
    }
  }
  return suite;
}


/** Only public completed tool observations travel to a reviewer, never producer reasoning or chat. */
export function nativeReadObservations(events: unknown) {
  const items: Record<string, unknown>[] = [];
  const excerpt = (value: unknown) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
    return { excerpt: text.slice(0, 16384), digest: createHash('sha256').update(text).digest('hex'), truncated: text.length > 16384 };
  };
  for (const raw of Array.isArray(events) ? events : []) {
    const event = raw as { type?: string; item?: Record<string, unknown> };
    if (event?.type !== 'item.completed' || !event.item) continue;
    const item = event.item;
    if (item.type === 'command_execution') items.push({ kind: 'command', id: item.id, command: item.command, status: item.status, exitCode: item.exit_code, output: excerpt(item.aggregated_output), resultObserved: typeof item.aggregated_output === 'string' });
    else if (item.type === 'mcp_tool_call') items.push({ kind: 'mcp', id: item.id, server: item.server, tool: item.tool, arguments: item.arguments, status: item.status, result: excerpt(item.result), error: excerpt(item.error), resultObserved: item.result !== undefined || item.error !== undefined });
    else if (item.type === 'web_search') items.push({ kind: 'web', id: item.id, query: item.query, action: item.action, resultObserved: false, limit: 'This public host event witnesses the query/action only; retrieved result contents and their absence are not observed.' });
  }
  return { formatVersion: 1, scope: 'Public completed command/MCP/web events only; source and tool text remain untrusted. Missing events do not establish that an action did not occur.', items };
}

/** Independently reconstruct the relationships; reference membership alone is insufficient. */
export function nativeQualificationProblems(record: QualificationRecord, resolve: RefResolver): string[] {
  const problems: string[] = [];
  if (record.assurance !== 'native_execution_and_independent_review') return problems;
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const held = (ref: string): string => {
    const value = resolve(ref);
    const receipt = record.evidence.find((e) => e.ref === ref);
    if (!value || value.provenance !== 'witnessed' || value.truncated || typeof value.text !== 'string' || !receipt || receipt.provenance !== 'witnessed' || receipt.digest !== hash(value.text)) throw new Error('missing, changed or unwitnessed native evidence');
    return value.text;
  };
  const json = (ref: string): any => JSON.parse(held(ref));
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  let executionDirectory: string | null = null;
  const sessions = new Set<string>(), invocations = new Set<string>(), refs = new Set<string>();
  const unique = (set: Set<string>, value: unknown) => { if (typeof value !== 'string' || !value || set.has(value)) throw new Error('native case identities, sessions, invocations and evidence must be distinct'); set.add(value); };
  const witnesses = record.nativeWitnesses ?? [];
  if (!record.suite.native || witnesses.length !== record.suite.cases.length || new Set(witnesses.map((w) => w.caseId)).size !== witnesses.length) return ['native qualification lacks one distinct witness per case'];
  for (const c of record.suite.cases) {
    try {
      const w = witnesses.find((entry) => entry.caseId === c.id), spec = c.native;
      if (!w || !spec || w.host !== record.suite.host || w.host !== 'codex' || w.model !== record.suite.model || w.modelSource !== 'requested' || w.skillDigest !== record.skill.digest || !w.hostVersion) throw new Error('native witness host, requested model or skill does not match its suite');
      const prefix = w.caseRef.match(/^([.]construct\/evaluations\/[a-z0-9-]+)\/([a-zA-Z0-9_-]+)\/case[.]json$/);
      if (!prefix || prefix[2] !== c.id || (executionDirectory !== null && executionDirectory !== prefix[1])) throw new Error('native evidence is not from one case-scoped execution directory');
      executionDirectory = prefix[1]!;
      const directory = `${executionDirectory}/${c.id}`;
      if (w.producer.receipt !== `${directory}/producer.json` || w.reviewer.receipt !== `${directory}/reviewer.json` || w.artifacts.some((ref, i) => ref !== `${directory}/output-${String(i)}.txt`)) throw new Error('native evidence aliases or mixes another case');
      const context = { caseId: c.id, skill: record.skill, promptDigest: hash(spec.prompt), inputDigests: spec.files.map((f) => ({ from: f.from, path: f.to, digest: hash(held(f.from)) })), rubricDigest: hash(held(spec.rubric)) };
      unique(refs, w.caseRef);
      const captured = json(w.caseRef);
      for (const key of Object.keys(context) as (keyof typeof context)[]) if (!same(captured[key], context[key])) throw new Error('native case does not match the exact prompt, inputs, held rubric or skill');
      if (captured.prompt !== spec.prompt || captured.producerInvocation !== w.producer.invocationId || captured.reviewerInvocation !== w.reviewer.invocationId || captured.judgment?.application !== w.application || !same(captured.judgment?.checks, w.checks) || !captured.judgment?.reasons) throw new Error('native case judgment or invocation links contradict its witness');
      if (w.application !== (c.kind === 'negative' ? 'stood_down' : 'applied') || c.checks.some((name) => w.checks[name] !== 'pass')) throw new Error('native independent application or checks did not pass');
      if (!Array.isArray(captured.outputDigests) || captured.outputDigests.length !== spec.outputs.length || w.artifacts.length !== spec.outputs.length) throw new Error('native case does not account for every requested output');
      const outputDigests = spec.outputs.map((path, i) => { const ref = w.artifacts[i]!; unique(refs, ref); return { path, ref, digest: hash(held(ref)) }; });
      if (!same(captured.outputDigests, outputDigests)) throw new Error('native artifact bytes or output bindings differ from the production observation');
      const readObservations = nativeReadObservations(json(w.producer.receipt).events);
      const readObservationsDigest = hash(JSON.stringify(readObservations));
      if (captured.readObservationsDigest !== readObservationsDigest || !same(captured.readObservations, readObservations)) throw new Error('reviewed execution evidence differs from the observed producer tool events');
      for (const role of ['producer', 'reviewer'] as const) {
        const witness = w[role]; unique(sessions, witness.sessionId); unique(invocations, witness.invocationId); unique(refs, witness.receipt);
        const receipt = json(witness.receipt);
        if (receipt.role !== role || receipt.id !== witness.invocationId || receipt.sessionId !== witness.sessionId || receipt.host !== w.host || receipt.hostVersion !== w.hostVersion || receipt.model !== w.model || receipt.modelSource !== 'requested' || receipt.exitStatus !== 0 || witness.exitStatus !== 0 || receipt.timedOut !== false || receipt.completed !== true || receipt.transcriptDigest !== witness.transcriptDigest || !/^[a-f0-9]{64}$/.test(receipt.transcriptDigest) || !/^[a-f0-9]{64}$/.test(receipt.argvDigest) || !same(receipt.context, context)) throw new Error('native invocation receipt metadata or context contradicts the case witness');
        if (role === 'reviewer' && (receipt.reviewedReadsDigest !== readObservationsDigest || !same(receipt.reviewedOutputs, outputDigests) || !same(JSON.parse(receipt.text), captured.judgment))) throw new Error('reviewer output or reviewed artifacts do not match the case judgment');
      }
    } catch (error) { problems.push(`${c.id}: ${(error as Error).message}`); }
  }
  return problems;
}
