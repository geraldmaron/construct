/**
 * kernel/brief/schema.ts — what a task needs, declared.
 *
 * Commitment 10: briefs declare, a dispatcher satisfies. A brief names its
 * inputs, the tool capabilities it requires, and the verification postconditions
 * its output must pass. It does not name a tool, a host, or an order of
 * operations — the moment a brief picks its own tools it is orchestrating
 * itself, which is the thing commitment 10 forbids.
 *
 * The distinction that makes this worth a schema: `capabilities` are what the
 * work needs to be able to DO ("read the web", "write files"), never which
 * connector provides it. Resolution to a concrete tool is the dispatcher's job
 * and can differ per host, which is what keeps commitment 1 (host-independent by
 * adapter) true in practice rather than in principle.
 */

import { MODEL_TIERS, isModelTier } from './tiers.ts';
import type { ModelTier } from './tiers.ts';

export interface BriefInput {
  readonly name: string;
  readonly description: string;
  /** A missing required input is unsatisfiable; a missing optional one is not. */
  readonly required: boolean;
}

export interface Brief {
  readonly id: string;
  /** The outcome this task serves, in the user's words. */
  readonly outcome: string;
  /** The role that will execute it — also the postcondition producer key. */
  readonly role: string;
  readonly inputs: readonly BriefInput[];
  /** Capabilities the work needs, never named tools. */
  readonly capabilities: readonly string[];
  /**
   * Postcondition rule ids the output must satisfy. Empty means the role's
   * registered defaults apply; it does not mean unverified.
   */
  readonly postconditions: readonly string[];
  /**
   * Challenge ids the deliverable must answer before promoting past `draft`
   * (commitment 13). Declared here so a waiver is per-brief and visible. These
   * are the `required` set completion/promotion.ts derives a state from — and
   * `draft` is a state on that axis, not a rung on the twelve-rung production
   * ladder in completion/states.ts, which has no such rung.
   */
  readonly challenges?: readonly string[];
  /**
   * The weakest model capability tier this work may run on (construct-ap0).
   * Optional, and omitting it means `any` — a brief that says nothing about
   * model strength gets no floor rather than a guessed one.
   *
   * Family-agnostic by construction: it is an ordinal from tiers.ts, never a
   * vendor model string. Which of a host's models sit at which tier is the
   * adapter's declaration, next to its pin.
   */
  readonly modelFloor?: ModelTier;
}

export interface BriefProblem {
  readonly field: string;
  readonly problem: string;
}

export interface BriefValidation {
  readonly ok: boolean;
  readonly problems: readonly BriefProblem[];
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Structural validation of a brief. This checks that a brief is well-formed, not
 * that it can be satisfied — satisfaction needs to know what tools and roles are
 * available and lives in satisfy.ts.
 */
export function validateBrief(brief: unknown): BriefValidation {
  const problems: BriefProblem[] = [];
  const record = brief as Partial<Brief> | null;

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, problems: [{ field: '.', problem: 'brief must be an object' }] };
  }

  for (const field of ['id', 'outcome', 'role'] as const) {
    if (!nonEmptyString(record[field])) {
      problems.push({ field, problem: `${field} must be a non-empty string` });
    }
  }

  if (!Array.isArray(record.inputs)) {
    problems.push({ field: 'inputs', problem: 'inputs must be an array (use [] for none)' });
  } else {
    record.inputs.forEach((input, i) => {
      if (!nonEmptyString(input?.name)) {
        problems.push({ field: `inputs[${i}].name`, problem: 'input needs a name' });
      }
      if (typeof input?.required !== 'boolean') {
        problems.push({
          field: `inputs[${i}].required`,
          problem: 'input must say whether it is required — an unstated default hides a hard failure',
        });
      }
    });
  }

  for (const field of ['capabilities', 'postconditions'] as const) {
    if (!Array.isArray(record[field])) {
      problems.push({ field, problem: `${field} must be an array (use [] for none)` });
    } else if ((record[field] as unknown[]).some((v) => !nonEmptyString(v))) {
      problems.push({ field, problem: `${field} entries must be non-empty strings` });
    }
  }

  // A floor is optional, but a floor nobody can compare against is worse than
  // none: it reads as a declared requirement while satisfying nothing.
  if (record.modelFloor !== undefined && !isModelTier(record.modelFloor)) {
    problems.push({
      field: 'modelFloor',
      problem: `modelFloor must be one of: ${MODEL_TIERS.join(', ')} — a tier, never a model name (the kernel compares ordinals; adapters own tier membership)`,
    });
  }

  // A brief that names a concrete tool has started orchestrating itself.
  for (const capability of Array.isArray(record.capabilities) ? record.capabilities : []) {
    if (typeof capability === 'string' && capability.includes('::')) {
      problems.push({
        field: 'capabilities',
        problem: `"${capability}" looks like a concrete tool, not a capability — briefs declare what the work needs to do, the dispatcher picks the tool (commitment 10)`,
      });
    }
  }

  return { ok: problems.length === 0, problems };
}
