/**
 * kernel/registry/qualification.ts — whether a skill version may be treated
 * as qualified, computed from the existing lock and evals.
 *
 * There is no second registry. A digest change at the same version does
 * not inherit a prior quality claim. Untrusted skill text cannot raise
 * Construct's authority by instructing the model to ignore policy.
 */

import type { QualificationRecord } from './qualification-evidence.ts';
import { validateQualificationSuite, nativeQualificationProblems } from './qualification-evidence.ts';
import type { RefResolver } from '../project/evidence.ts';
import { contentReceipt } from '../workflow/verification.ts';
import type { RegisteredSkill } from './models.ts';
import type { LockRow } from './lockfile.ts';

export const QUALIFICATION_STATES = ['experimental', 'qualified', 'degraded', 'deprecated', 'unsafe'] as const;
export type QualificationState = (typeof QUALIFICATION_STATES)[number];

export interface Qualification {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
  readonly state: QualificationState;
  readonly why: string;
  readonly evidence?: { readonly evaluationRef: string; readonly host: string; readonly model: string; readonly scope: string; readonly expiresAt: string; readonly suiteDigest: string };
}

const OVERRIDE =
  /ignore (?:all )?(?:prior |construct )?polic(?:y|ies)|grant yourself|raise (?:your |the )?max(?:imum )?tier|you (?:may|can) (?:now )?(?:perform|use) licensed[_ ]judgment/i;

/** True when text tries to rewrite Construct's authority. Skill bodies that do this are unsafe. */
export function skillAttemptsAuthorityOverride(text: string | null | undefined): boolean {
  return !!text && OVERRIDE.test(text);
}

function hasActivationEvals(skill: RegisteredSkill): boolean {
  return skill.manifest.evals.some((e) => e.includes('activation')) || skill.files.some((f) => f.endsWith('evals/activation.json'));
}

function hasBehaviorEvals(skill: RegisteredSkill): boolean {
  return (
    skill.manifest.evals.some((e) => /behavior|fixtures/.test(e)) ||
    skill.files.some((f) => /evals\/(behavior|fixtures)\.json$/.test(f))
  );
}

export function qualifySkill(skill: RegisteredSkill, lockRow: LockRow | undefined, body: string | null, context?: { host: string; model: string | null; now: string; records: readonly { id: number; record: QualificationRecord }[]; resolve: RefResolver }): Qualification {
  const base = { id: skill.manifest.id, version: skill.manifest.version, digest: skill.digest };
  if (skillAttemptsAuthorityOverride(body)) {
    return { ...base, state: 'unsafe', why: 'the skill text tries to raise Construct’s authority' };
  }
  if (!lockRow || lockRow.state === 'unlocked') {
    return { ...base, state: 'experimental', why: 'present but not locked' };
  }
  if (lockRow.state === 'diverged') {
    return {
      ...base,
      state: 'unsafe',
      why: 'the same version has different bytes than the lock; prior quality claims do not apply',
    };
  }
  if (lockRow.state === 'missing') {
    return { ...base, state: 'deprecated', why: lockRow.why };
  }
  if (lockRow.state === 'outdated' || lockRow.state === 'blocked') {
    return { ...base, state: 'degraded', why: lockRow.why };
  }
  if (!hasActivationEvals(skill)) {
    return { ...base, state: 'experimental', why: 'no activation evaluation cases are declared' };
  }
  // Only the host observation adapter supplies these records; source or skill text cannot.
  const observed = context?.records.find(({ record: r }) => r.formatVersion === 1 && r.skill.id === base.id && r.skill.version === base.version && r.skill.digest === base.digest && r.suite.host === context.host && r.suite.model === context.model);
  if (observed && context) {
    const r = observed.record;
    try { validateQualificationSuite(r.suite); } catch { return { ...base, state: 'degraded', why: 'the observed qualification suite is invalid' }; }
    if (!r.passed || r.exitStatus !== 0 || r.problems.length) return { ...base, state: 'degraded', why: 'the latest executed evaluation for this digest and host failed; prior passing evidence does not hide it' };
    if (!Number.isFinite(Date.parse(r.expiresAt)) || r.expiresAt <= context.now || r.endedAt > context.now) return { ...base, state: 'degraded', why: 'executed qualification expired or has a future observation time; rerun it' };
    if (!r.evidence.length || r.evidence.some((entry) => entry.digest === null || entry.provenance !== 'witnessed' || contentReceipt(entry.ref, context.resolve).digest !== entry.digest)) return { ...base, state: 'degraded', why: 'qualification evidence or evaluator bytes changed or no longer resolve; rerun it' };
    if (r.assurance !== 'native_execution_and_independent_review') return { ...base, state: 'experimental', why: 'an evaluator command ran, but host/model labels, producer/reviewer names and skill application are reported only; native invocation and independent review witnesses are required' };
    if (!r.nativeWitnesses || r.nativeWitnesses.length !== r.suite.cases.length || r.suite.cases.some((c) => {
      const w = r.nativeWitnesses!.find((entry) => entry.caseId === c.id);
      return !w || w.host !== context.host || w.model !== context.model || w.skillDigest !== base.digest || !w.hostVersion || w.producer.exitStatus !== 0 || w.reviewer.exitStatus !== 0 || !w.producer.sessionId || !w.reviewer.sessionId || w.producer.sessionId === w.reviewer.sessionId || w.producer.invocationId === w.reviewer.invocationId || w.application !== (c.kind === 'negative' ? 'stood_down' : 'applied') || !w.artifacts.length || c.checks.some((check) => w.checks[check] !== 'pass') || [w.producer.receipt, w.reviewer.receipt, w.caseRef, ...w.artifacts].some((ref) => !r.evidence.some((entry) => entry.ref === ref && entry.digest && entry.provenance === 'witnessed'));
    })) return { ...base, state: 'degraded', why: 'qualification lacks complete matching native producer, application, artifact and independent reviewer witnesses' };
    const nativeProblems = nativeQualificationProblems(r, context.resolve);
    if (nativeProblems.length) return { ...base, state: 'degraded', why: nativeProblems.join('; ') };
    return { ...base, state: 'qualified', why: 'an observed passing evaluation covers this exact version and host within its stated scope; it is not a universal correctness or permission claim', evidence: { evaluationRef: `evaluation:${observed.id}`, host: r.suite.host, model: r.suite.model, scope: r.suite.scope, expiresAt: r.expiresAt, suiteDigest: r.suiteDigest } };
  }
  if (!hasBehaviorEvals(skill)) {
    return { ...base, state: 'experimental', why: 'activation cases only; no behavior evaluation cases are declared' };
  }
  return { ...base, state: 'experimental', why: context && !context.model ? 'current model is unspecified; executed evidence is scoped to a model and cannot qualify an unspecified one' : 'lock and evaluation cases are present; no passing execution record is bound to this digest, host and model' };
}
