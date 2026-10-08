/**
 * kernel/workflow/asked.ts — the reading a run was started with, frozen on
 * the run once.
 *
 * It lives in run.bindings.asked and holds the inputs to the judgment, never
 * the judgment itself: every judgment is recomputed from the run's structure
 * plus what was declared here, so resuming a run cannot drop what the host
 * declared. A run with no reading reads as an empty one.
 */

import { STAKE_AREAS, type StakeArea, type Stakes } from './consequence.ts';

/** What the host declared about the work, beside the workflow input. */
export interface Declared {
  readonly stakes: Stakes | null;
  readonly chosenSkill: string | null;
  readonly words: string | null;
}

/** Who judged the reading: the host, the person, a trigger's own definition, or nobody. */
export interface JudgedBy {
  readonly by: 'host' | 'person' | 'trigger_definition' | 'none';
  readonly host: string | null;
  readonly client: string | null;
}

/** Something taken as given to start the run, and who took it. */
export interface Assumption {
  readonly about: string;
  readonly text: string;
  readonly by: 'kernel' | 'host';
}

export interface AskedReading {
  readonly declared?: Declared | null;
  readonly judgedBy?: JudgedBy | null;
  readonly assumptions?: readonly Assumption[];
}

const JUDGED_BY = new Set(['host', 'person', 'trigger_definition', 'none']);
const ASSUMED_BY = new Set(['kernel', 'host']);
const AREAS: ReadonlySet<string> = new Set(STAKE_AREAS);

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function stringOrNull(x: unknown): string | null {
  return typeof x === 'string' ? x : null;
}

function stakesFrom(x: unknown): Stakes | null {
  if (!isRecord(x)) return null;
  const reversible = typeof x.reversible === 'boolean' ? x.reversible : null;
  const affects = Array.isArray(x.affects) ? [...new Set(x.affects.filter((a): a is StakeArea => typeof a === 'string' && AREAS.has(a)))] : [];
  return { reversible, affects };
}

function declaredFrom(x: unknown): Declared | null {
  if (!isRecord(x)) return null;
  return { stakes: stakesFrom(x.stakes), chosenSkill: stringOrNull(x.chosenSkill), words: stringOrNull(x.words) };
}

function judgedByFrom(x: unknown): JudgedBy | null {
  if (!isRecord(x) || typeof x.by !== 'string' || !JUDGED_BY.has(x.by)) return null;
  return { by: x.by as JudgedBy['by'], host: stringOrNull(x.host), client: stringOrNull(x.client) };
}

function assumptionsFrom(x: unknown): Assumption[] {
  if (!Array.isArray(x)) return [];
  return x.filter((a): a is Assumption => isRecord(a) && typeof a.about === 'string' && typeof a.text === 'string' && typeof a.by === 'string' && ASSUMED_BY.has(a.by))
    .map((a) => ({ about: a.about, text: a.text, by: a.by }));
}

/** A reading in its stored shape: anything not of the right type is left out. */
export function askedFrom(raw: unknown): AskedReading {
  if (!isRecord(raw)) return {};
  const out: { declared?: Declared | null; judgedBy?: JudgedBy | null; assumptions?: readonly Assumption[] } = {};
  if ('declared' in raw) out.declared = declaredFrom(raw.declared);
  if ('judgedBy' in raw) out.judgedBy = judgedByFrom(raw.judgedBy);
  if ('assumptions' in raw) out.assumptions = assumptionsFrom(raw.assumptions);
  return out;
}

/** The reading frozen on a run; empty for a run started without one. */
export function askedOf(run: { readonly bindings: unknown }): AskedReading {
  return isRecord(run.bindings) ? askedFrom(run.bindings.asked) : {};
}
