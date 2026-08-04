/**
 * kernel/brief/satisfy.ts — the dispatcher half of commitment 10: resolve a
 * brief's declared requirements against the tools and roles actually available.
 *
 * The load-bearing behavior is the failure mode. When a requirement cannot be
 * met, this reports it as unsatisfied and `ok` is false — it never picks a
 * near-enough tool, never drops a postcondition it cannot enforce, and never
 * proceeds with a required input missing. Silent degradation is how a run
 * produces a confident deliverable that skipped the check that mattered, and
 * commitment 15 makes that the one failure this system may not have.
 *
 * Resolution is deterministic: for a capability satisfied by several tools, the
 * first in the caller's list wins. Host order is the caller's decision, so an
 * identical brief against an identical host list always resolves identically —
 * which is what makes a resumed or replayed run comparable to the original.
 */

import { describePostconditions } from '../capabilities/postconditions.ts';
import { validateBrief } from './schema.ts';
import type { Brief } from './schema.ts';
import { meetsFloor } from './tiers.ts';
import type { ModelTier } from './tiers.ts';

export interface Tool {
  readonly name: string;
  /** Capabilities this tool provides. */
  readonly capabilities: readonly string[];
}

export interface Availability {
  readonly tools: readonly Tool[];
  readonly roles: readonly string[];
  /** Input names the caller can actually supply. */
  readonly inputs?: readonly string[];
  /**
   * The tier of the model that will actually run this brief, as declared by the
   * host adapter. Absent means the host did not say — which does NOT satisfy a
   * floor above `any` (see meetsFloor).
   */
  readonly modelTier?: ModelTier;
  /** The concrete model identity, recorded so a claim about a run is qualified. */
  readonly model?: string;
}

/**
 * A requirement that is not met but does not stop dispatch.
 *
 * Kept apart from `Unsatisfied` on purpose. Unsatisfied means the work cannot
 * honestly be done and `ok` goes false; degraded means it will be done on
 * something weaker than the brief asked for, and both the user and every later
 * claim about the run need to know. Folding the two together would force a
 * choice between refusing the free local-model path outright and saying nothing
 * at all, and both of those have already been wrong here once.
 */
export interface Degradation {
  readonly kind: 'below-model-floor';
  readonly what: string;
  readonly why: string;
}

export const UNSATISFIED_KINDS = [
  'malformed-brief',
  'unknown-role',
  'missing-input',
  'missing-capability',
  'unknown-postcondition',
] as const;

export type UnsatisfiedKind = (typeof UNSATISFIED_KINDS)[number];

export interface Unsatisfied {
  readonly kind: UnsatisfiedKind;
  readonly what: string;
  readonly why: string;
}

export interface Binding {
  readonly capability: string;
  readonly tool: string;
}

export interface Resolution {
  readonly ok: boolean;
  readonly brief: string;
  readonly role: string;
  readonly bindings: readonly Binding[];
  readonly postconditions: readonly string[];
  readonly unsatisfied: readonly Unsatisfied[];
  /**
   * Requirements met by something weaker than declared. Never empty silently:
   * a non-empty list here is what the caller is obliged to record.
   */
  readonly degradations: readonly Degradation[];
}

/**
 * Resolve a brief against what is available.
 *
 * `postconditions` on the result is what will actually be enforced: the brief's
 * declared ids when it names any, otherwise the role's registered defaults. An
 * empty declaration means "the role's defaults", never "none" — that default is
 * why a brief author cannot silently opt out of verification by omission.
 */
export function satisfyBrief(brief: Brief, available: Availability): Resolution {
  const unsatisfied: Unsatisfied[] = [];

  const validation = validateBrief(brief);
  if (!validation.ok) {
    return {
      ok: false,
      brief: typeof brief?.id === 'string' ? brief.id : '(malformed)',
      role: typeof brief?.role === 'string' ? brief.role : '(none)',
      bindings: [],
      postconditions: [],
      unsatisfied: validation.problems.map((p) => ({
        kind: 'malformed-brief' as const,
        what: p.field,
        why: p.problem,
      })),
      degradations: [],
    };
  }

  if (!available.roles.includes(brief.role)) {
    unsatisfied.push({
      kind: 'unknown-role',
      what: brief.role,
      why: `no role "${brief.role}" is available to execute this brief`,
    });
  }

  const suppliable = new Set(available.inputs ?? []);
  for (const input of brief.inputs) {
    if (input.required && !suppliable.has(input.name)) {
      unsatisfied.push({
        kind: 'missing-input',
        what: input.name,
        why: `required input "${input.name}" (${input.description}) is not available`,
      });
    }
  }

  const bindings: Binding[] = [];
  for (const capability of brief.capabilities) {
    const tool = available.tools.find((t) => t.capabilities.includes(capability));
    if (!tool) {
      unsatisfied.push({
        kind: 'missing-capability',
        what: capability,
        why: `no available tool provides "${capability}"`,
      });
      continue;
    }
    bindings.push({ capability, tool: tool.name });
  }

  const registered = describePostconditions(brief.role).map((p) => p.id);
  let postconditions: string[];
  if (brief.postconditions.length === 0) {
    postconditions = registered;
  } else {
    postconditions = [...brief.postconditions];
    const known = new Set(registered);
    for (const id of brief.postconditions) {
      if (!known.has(id)) {
        unsatisfied.push({
          kind: 'unknown-postcondition',
          what: id,
          why: `postcondition "${id}" is not registered for role "${brief.role}", so it cannot be enforced`,
        });
      }
    }
  }

  // The model floor, checked last because it is the one requirement that does
  // not stop a dispatch. `ok` deliberately ignores degradations: the run happens,
  // and the record says what it happened on.
  const degradations: Degradation[] = [];
  const floor = brief.modelFloor ?? 'any';
  if (!meetsFloor(available.modelTier, floor)) {
    const ran = available.model ? `"${available.model}"` : 'the host default';
    const at = available.modelTier
      ? `tier "${available.modelTier}"`
      : 'an undeclared tier — the host did not say, and silence is not compliance';
    degradations.push({
      kind: 'below-model-floor',
      what: floor,
      why: `brief declares a "${floor}" model floor but ${ran} is ${at}; the work ran anyway and this result is qualified by that`,
    });
  }

  return {
    ok: unsatisfied.length === 0,
    brief: brief.id,
    role: brief.role,
    bindings,
    postconditions,
    unsatisfied,
    degradations,
  };
}

/** A one-line reason a brief could not be dispatched, for logs and the CLI. */
export function explainUnsatisfied(resolution: Resolution): string {
  if (resolution.ok) return `${resolution.brief}: satisfiable`;
  return `${resolution.brief}: ${resolution.unsatisfied
    .map((u) => `[${u.kind}] ${u.why}`)
    .join('; ')}`;
}
