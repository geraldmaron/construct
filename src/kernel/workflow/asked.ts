/**
 * kernel/workflow/asked.ts — the reading a run was started with, frozen on
 * the run once.
 *
 * It lives in run.bindings.asked and holds the inputs to the judgment, never
 * the judgment itself: every judgment is recomputed from the run's structure
 * plus what was declared here, so resuming a run cannot drop what the host
 * declared. It also holds the period the run covers, worked out into dates
 * when the run was created, the sources it names, and the trigger firing
 * that started it; run.input keeps the period as it was given. A run with no
 * reading reads as an empty one.
 */

import { PERIOD_RELATIVES, PERIOD_SEMANTICS, type PeriodSpec, type ResolvedPeriod } from '../registry/slots.ts';
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

/** A source the request named: by the id it is declared under, or only by name when it is not. */
export interface NamedSource {
  readonly name: string;
  readonly id: string | null;
  readonly registered: boolean;
}

export interface AskedSources {
  /** The declared source ids the run's input names. */
  readonly registered: readonly string[];
  readonly named: readonly NamedSource[];
}

/** The standing trigger firing that started the run, and the instant it was due. */
export interface Firing {
  readonly triggerId: string;
  readonly dueAt: string;
}

export interface AskedReading {
  readonly declared?: Declared | null;
  readonly judgedBy?: JudgedBy | null;
  readonly assumptions?: readonly Assumption[];
  /** The period the run covers, in dates. */
  readonly period?: ResolvedPeriod | null;
  /** The same period as it was given. */
  readonly periodSpec?: PeriodSpec | null;
  readonly sources?: AskedSources | null;
  readonly firing?: Firing | null;
}

const JUDGED_BY = new Set(['host', 'person', 'trigger_definition', 'none']);
const SEMANTICS: ReadonlySet<string> = new Set(PERIOD_SEMANTICS);
const RELATIVES: ReadonlySet<string> = new Set(PERIOD_RELATIVES);
const HOWS = new Set(['relative', 'quarter', 'year', 'dates']);
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

function numberOrAbsent(x: unknown): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
}

/** The optional period fields both shapes share, kept only when of the right type. */
function periodExtras(x: Record<string, unknown>): { relative?: ResolvedPeriod['relative']; n?: number; quarter?: number; year?: number; phrase?: string } {
  const relative = typeof x.relative === 'string' && RELATIVES.has(x.relative) ? (x.relative as ResolvedPeriod['relative']) : undefined;
  const [n, quarter, year] = [numberOrAbsent(x.n), numberOrAbsent(x.quarter), numberOrAbsent(x.year)];
  return {
    ...(relative !== undefined ? { relative } : {}),
    ...(n !== undefined ? { n } : {}),
    ...(quarter !== undefined ? { quarter } : {}),
    ...(year !== undefined ? { year } : {}),
    ...(typeof x.phrase === 'string' ? { phrase: x.phrase } : {}),
  };
}

function periodFrom(x: unknown): ResolvedPeriod | null {
  if (!isRecord(x) || typeof x.semantics !== 'string' || !SEMANTICS.has(x.semantics) || typeof x.to !== 'string' || typeof x.timezone !== 'string'
    || typeof x.how !== 'string' || !HOWS.has(x.how) || typeof x.resolvedAt !== 'string' || !(x.from === null || typeof x.from === 'string')) return null;
  return {
    semantics: x.semantics as ResolvedPeriod['semantics'],
    from: x.from,
    to: x.to,
    timezone: x.timezone,
    how: x.how as ResolvedPeriod['how'],
    ...periodExtras(x),
    resolvedAt: x.resolvedAt,
    endsAfterToday: x.endsAfterToday === true,
    assumptions: Array.isArray(x.assumptions) ? x.assumptions.filter((a): a is string => typeof a === 'string') : [],
  };
}

function periodSpecFrom(x: unknown): PeriodSpec | null {
  if (!isRecord(x) || typeof x.semantics !== 'string' || !SEMANTICS.has(x.semantics)) return null;
  return {
    semantics: x.semantics as PeriodSpec['semantics'],
    ...periodExtras(x),
    ...(typeof x.from === 'string' ? { from: x.from } : {}),
    ...(typeof x.to === 'string' ? { to: x.to } : {}),
    ...(typeof x.timezone === 'string' ? { timezone: x.timezone } : {}),
  };
}

function sourcesFrom(x: unknown): AskedSources | null {
  if (!isRecord(x)) return null;
  const registered = Array.isArray(x.registered) ? x.registered.filter((id): id is string => typeof id === 'string') : [];
  const named = Array.isArray(x.named)
    ? x.named.filter((n): n is Record<string, unknown> => isRecord(n) && typeof n.name === 'string')
      .map((n) => ({ name: n.name as string, id: stringOrNull(n.id), registered: n.registered === true }))
    : [];
  return { registered, named };
}

function firingFrom(x: unknown): Firing | null {
  return isRecord(x) && typeof x.triggerId === 'string' && typeof x.dueAt === 'string' ? { triggerId: x.triggerId, dueAt: x.dueAt } : null;
}

/** A reading in its stored shape: anything not of the right type is left out. */
export function askedFrom(raw: unknown): AskedReading {
  if (!isRecord(raw)) return {};
  const out: {
    declared?: Declared | null; judgedBy?: JudgedBy | null; assumptions?: readonly Assumption[];
    period?: ResolvedPeriod | null; periodSpec?: PeriodSpec | null; sources?: AskedSources | null; firing?: Firing | null;
  } = {};
  if ('declared' in raw) out.declared = declaredFrom(raw.declared);
  if ('judgedBy' in raw) out.judgedBy = judgedByFrom(raw.judgedBy);
  if ('assumptions' in raw) out.assumptions = assumptionsFrom(raw.assumptions);
  if ('period' in raw) out.period = periodFrom(raw.period);
  if ('periodSpec' in raw) out.periodSpec = periodSpecFrom(raw.periodSpec);
  if ('sources' in raw) out.sources = sourcesFrom(raw.sources);
  if ('firing' in raw) out.firing = firingFrom(raw.firing);
  return out;
}

/** The reading frozen on a run; empty for a run started without one. */
export function askedOf(run: { readonly bindings: unknown }): AskedReading {
  return isRecord(run.bindings) ? askedFrom(run.bindings.asked) : {};
}
