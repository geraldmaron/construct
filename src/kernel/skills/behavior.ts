/**
 * kernel/skills/behavior.ts — deterministic checks of a skill's own text:
 * that it forbids inventing facts, and that override text in the skill or an
 * untrusted injection cannot raise Construct's action tier.
 *
 * Whether a skill applies to a request, or stands down, is the host model's
 * judgment, and only a native evaluation with that model shows it; nothing
 * here matches a request's words.
 */

import { skillAttemptsAuthorityOverride } from '../registry/qualification.ts';
import type { RegisteredSkill } from '../registry/models.ts';

export const BEHAVIOR_KINDS = ['forbids_invention', 'authority_boundary'] as const;
export type BehaviorKind = (typeof BEHAVIOR_KINDS)[number];

export interface BehaviorCase {
  readonly id: string;
  readonly kind: BehaviorKind;
  readonly text?: string;
  readonly injection?: string;
}

export interface BehaviorFile {
  readonly format: 'construct-skill-behavior';
  readonly formatVersion: 1;
  readonly cases: readonly BehaviorCase[];
}

export function validateBehaviorFile(raw: unknown, path: string): BehaviorFile {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${path}: behavior evals must be an object`);
  const o = raw as Record<string, unknown>;
  if (o.format !== 'construct-skill-behavior') throw new Error(`${path}: format must be construct-skill-behavior`);
  if (o.formatVersion !== 1) throw new Error(`${path}: formatVersion must be 1`);
  if (!Array.isArray(o.cases) || o.cases.length === 0) throw new Error(`${path}: cases must be a non-empty list`);
  const cases: BehaviorCase[] = [];
  for (const [i, c] of o.cases.entries()) {
    if (c === null || typeof c !== 'object' || Array.isArray(c)) throw new Error(`${path}: cases[${String(i)}] must be an object`);
    const row = c as Record<string, unknown>;
    if (typeof row.id !== 'string' || !row.id.trim()) throw new Error(`${path}: cases[${String(i)}].id is required`);
    if (!(BEHAVIOR_KINDS as readonly string[]).includes(row.kind as string)) {
      throw new Error(`${path}: cases[${String(i)}].kind is not a behavior kind`);
    }
    cases.push({
      id: row.id,
      kind: row.kind as BehaviorKind,
      text: typeof row.text === 'string' ? row.text : undefined,
      injection: typeof row.injection === 'string' ? row.injection : undefined,
    });
  }
  return { format: 'construct-skill-behavior', formatVersion: 1, cases };
}

const FORBIDS_INVENTION =
  /do not invent|never invent|leave it unknown|unknowns stay unknown|ask, do not invent|do not mark a placeholder verified/i;

export interface BehaviorEvalInput {
  readonly skill: RegisteredSkill;
  readonly body: string;
}

export function evaluateBehaviorCase(input: BehaviorEvalInput, c: BehaviorCase): { readonly ok: boolean; readonly why: string } {
  const { body } = input;
  if (c.kind === 'forbids_invention') {
    if (!FORBIDS_INVENTION.test(body)) {
      return { ok: false, why: `${c.id}: skill body does not forbid inventing unknown facts` };
    }
    return { ok: true, why: `${c.id}: invention is forbidden` };
  }
  if (c.kind === 'authority_boundary') {
    if (skillAttemptsAuthorityOverride(body)) {
      return { ok: false, why: `${c.id}: skill body itself tries to override policy` };
    }
    const injection = c.injection ?? '';
    if (!skillAttemptsAuthorityOverride(injection)) {
      return { ok: false, why: `${c.id}: fixture injection was not recognized as an override attempt` };
    }
    return { ok: true, why: `${c.id}: override text is data, not a grant` };
  }
  return { ok: false, why: `${c.id}: unknown kind` };
}
