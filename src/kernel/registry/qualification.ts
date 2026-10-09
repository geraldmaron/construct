/**
 * kernel/registry/qualification.ts — whether a skill version may be treated
 * as qualified, computed from the existing lock and evals.
 *
 * There is no second registry. A digest change at the same version does
 * not inherit a prior quality claim. Untrusted skill text cannot raise
 * Construct's authority by instructing the model to ignore policy.
 */

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

export function qualifySkill(skill: RegisteredSkill, lockRow: LockRow | undefined, body: string | null): Qualification {
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
  if (!hasBehaviorEvals(skill)) {
    return { ...base, state: 'experimental', why: 'activation cases only; no behavior evaluation cases are declared' };
  }
  // Case files describe what should be tested. They contain no authenticated
  // execution record for this digest or host, and cannot confer qualification.
  return { ...base, state: 'experimental', why: 'lock and evaluation cases are present; no passing execution record is bound to this digest and host' };
}
