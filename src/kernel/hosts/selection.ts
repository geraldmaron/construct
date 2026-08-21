/**
 * kernel/hosts/selection.ts — which of the resources actually present on this
 * machine should carry a run, when the user did not name one.
 *
 * Doctor could already say which hosts are installed, at what version against
 * their pin, and what their auth probe answered. Nothing used any of it to
 * decide anything: dispatch took whatever `--host` said, defaulted to a single
 * name, and failed if that binary was absent. This module is the missing
 * decision, and it is deliberately the same shape as the one the licensed
 * ladder already makes in connectors/seam.ts: a pure function over what is
 * actually available, returning which rung answered and why, with every
 * passed-over resource named so the choice can be audited afterwards instead
 * of only trusted at the moment it was made.
 *
 * It selects among adapters that already exist. It starts nothing, wraps
 * nothing, and knows no vendor. A resource arrives already described, its tier
 * resolved by the host layer that owns model strings and its cost class
 * resolved by that same layer from the same probe doctor reads. The kernel
 * compares ordinals and set membership, which is the whole of what it is
 * allowed to know.
 *
 * Two rungs answer and one refuses. `clears` is a present resource that
 * carries the needed capabilities and meets the declared model floor.
 * `degraded` is a present resource that carries the capabilities but clears no
 * floor, chosen anyway with the note the model matrix already requires,
 * because refusing there would make the free local path unusable for exactly
 * the work it was chosen for. `refused` is the honest end: nothing present
 * carries what the work needs, said in terms of what was needed and what was
 * found, never a generic failure.
 *
 * A capability is a hard requirement and a floor is not. That asymmetry is not
 * a preference: a host with no `outward-write` genuinely cannot carry out an
 * approved change however strong its model is, while a model below a floor
 * produces a weaker deliverable that is still a deliverable, and the record
 * says so.
 */

import { CAPABILITIES } from './interface.ts';
import { isModelTier, meetsFloor, tierRank } from '../brief/tiers.ts';
import type { ModelTier } from '../brief/tiers.ts';

/**
 * What a call on a resource costs, ordered cheapest first. The order IS the
 * semantics: `costRank` is the index, so entries may be appended but never
 * reordered.
 *
 * `unknown` sits last rather than in the middle. A resource whose price nobody
 * probed is treated as if it bills, for the same reason a host reporting cost
 * zero and zero steps is recorded as unmeasured rather than free: silence
 * about spend is not evidence of cheapness, and the direction that costs a
 * user money is the wrong direction to guess in.
 */
export const COST_CLASSES = ['local', 'subscription', 'metered', 'unknown'] as const;

export type CostClass = (typeof COST_CLASSES)[number];

/** What each class claims, in the terms a user reasons about spend in. */
export const COST_MEANING: Readonly<Record<CostClass, string>> = {
  local: 'served on this machine, so re-running it costs time and nothing else',
  subscription: 'already paid for by a login this machine proved, so a run spends capacity rather than money',
  metered: 'billed per call against an API key',
  unknown: 'what a call here costs was never measured, so it is ordered last as though it bills',
};

/** Where a cost class sits on the scale. Lower is cheaper. */
export function costRank(cost: CostClass): number {
  return COST_CLASSES.indexOf(cost);
}

/**
 * One resource this machine could dispatch through, as the host layer found
 * it. Everything vendor-shaped has already been resolved on the way in: the
 * kernel never sees a model string it has to recognise, a binary path, or a
 * version.
 */
export interface Resource {
  /** The name `--host` would take for it. */
  readonly host: string;
  /** Whether the binary answered at all. */
  readonly found: boolean;
  /** Whether an adapter can actually dispatch work through it today. */
  readonly dispatchable: boolean;
  /** Capabilities its adapter declares, drawn from the host interface's list. */
  readonly capabilities: readonly string[];
  /**
   * The tier of the model this resource would run, or null when the host would
   * not say. Null is not `any`: silence is not compliance, so it satisfies no
   * floor above `any`.
   */
  readonly tier: ModelTier | null;
  readonly costClass: CostClass;
  /** One sentence naming what the cost class rests on, in the host layer's words. */
  readonly costReason: string;
  /** How this resource was found, in one line. Carried, never parsed. */
  readonly presence: string;
}

/** What a run needs of whatever carries it. */
export interface WorkNeed {
  /** The strongest model floor any of the run's briefs declared. */
  readonly floor: ModelTier;
  /** Host capabilities the work cannot proceed without. */
  readonly capabilities: readonly string[];
  /**
   * Whether running this work and throwing the result away is free of
   * consequence outside the store. Re-runnable work may be sent to a resource
   * below its floor, loudly recorded, because a weak deliverable can be
   * discarded and the work run again. Work that acts on the world outside this
   * process cannot be un-run, so nothing chooses a below-floor resource for it
   * on the user's behalf.
   */
  readonly rerunnable: boolean;
}

/** Which rung answered. */
export type SelectionRung = 'clears' | 'degraded' | 'refused';

/** One resource that did not carry the work, and the reason it did not. */
export interface RejectedResource {
  readonly host: string;
  readonly why: string;
}

export interface Selection {
  readonly rung: SelectionRung;
  /** The chosen resource's name, or null when nothing was chosen. */
  readonly host: string | null;
  readonly costClass: CostClass | null;
  readonly tier: ModelTier | null;
  /** Why this rung answered, stated in what was present rather than in policy. */
  readonly reason: string;
  /**
   * The note that travels with a below-floor choice, or null when the chosen
   * resource cleared the floor. Present exactly when `rung` is `degraded`.
   */
  readonly degradation: string | null;
  /** Every resource that did not carry the work, each with its own reason. */
  readonly rejected: readonly RejectedResource[];
}

/** Every work-log entry a selection writes uses this action, whichever rung answered. */
export const HOST_SELECTION_ACTION = 'resource-selected';

const HOST_CAPABILITIES = new Set<string>(CAPABILITIES);

/**
 * What a set of pending briefs needs of the resource that will carry them: the
 * strongest floor any of them declared, and the union of the host capabilities
 * they named.
 *
 * Briefs arrive as stored JSON, so both fields are read defensively. A brief
 * that declares no floor gets none rather than a guessed one, which is the
 * schema's own rule, and a task enqueued with no brief at all contributes
 * nothing instead of contributing `any`.
 *
 * A brief's `capabilities` list is tool capabilities, which the dispatcher
 * resolves against available tools. Only the entries that name a host
 * capability are a requirement of the resource itself, so only those are read
 * here. Anything else stays the dispatcher's business and is left alone.
 */
export function needFor(briefs: readonly unknown[]): WorkNeed {
  let floor: ModelTier = 'any';
  const capabilities = new Set<string>();

  for (const brief of briefs) {
    const record = brief as { modelFloor?: unknown; capabilities?: unknown } | null;
    if (!record || typeof record !== 'object') continue;

    const declared = record.modelFloor;
    if (isModelTier(declared) && tierRank(declared) > tierRank(floor)) floor = declared;

    if (Array.isArray(record.capabilities)) {
      for (const capability of record.capabilities) {
        if (typeof capability === 'string' && HOST_CAPABILITIES.has(capability)) {
          capabilities.add(capability);
        }
      }
    }
  }

  const needed = [...capabilities].sort();
  return {
    floor,
    capabilities: needed,
    // Acting outside this process is the one declared capability whose result
    // cannot be discarded and produced again, so it is what makes a run
    // one-shot rather than re-runnable.
    rerunnable: !needed.includes('outward-write'),
  };
}

/** Cheapest first, ties broken by the order the census declared. Sort stability carries the tiebreak. */
function cheapest(resources: readonly Resource[]): Resource {
  return [...resources].sort((a, b) => costRank(a.costClass) - costRank(b.costClass))[0];
}

function tierPhrase(resource: Resource): string {
  return resource.tier ? `runs at tier "${resource.tier}"` : 'would not say what tier it runs';
}

function passedOver(resource: Resource, chosen: Resource): string {
  if (costRank(resource.costClass) > costRank(chosen.costClass)) {
    return `costs more than ${chosen.host}: ${resource.costClass} against ${chosen.costClass}`;
  }
  return `same cost class as ${chosen.host}, ${resource.costClass}, and the census declares ${chosen.host} first`;
}

function refusal(reason: string, rejected: readonly RejectedResource[]): Selection {
  return { rung: 'refused', host: null, costClass: null, tier: null, reason, degradation: null, rejected };
}

/**
 * Choose the cheapest present resource that carries what the work needs.
 *
 * Order of business, and each step's rejections are kept: a resource with no
 * adapter or no binary is out, a resource missing a needed capability is out,
 * and of what remains the cheapest that clears the declared floor wins. When
 * none clears the floor, re-runnable work takes the cheapest survivor with a
 * degradation note and one-shot work refuses instead. When nothing survives at
 * all, the refusal names what was needed against what was found.
 */
export function chooseResource(census: readonly Resource[], need: WorkNeed): Selection {
  const rejected: RejectedResource[] = [];
  const usable: Resource[] = [];

  for (const resource of census) {
    if (!resource.dispatchable) {
      rejected.push({
        host: resource.host,
        why: resource.found ? 'present, but no adapter can dispatch through it' : 'not found on this machine',
      });
      continue;
    }
    const missing = need.capabilities.filter((c) => !resource.capabilities.includes(c));
    if (missing.length > 0) {
      rejected.push({ host: resource.host, why: `does not carry ${missing.join(', ')}` });
      continue;
    }
    usable.push(resource);
  }

  if (usable.length === 0) {
    const needed =
      need.capabilities.length > 0
        ? `a resource carrying ${need.capabilities.join(', ')}`
        : 'any resource this machine can dispatch through';
    return refusal(`nothing present can carry this work: it needs ${needed}, and none was found`, rejected);
  }

  const clearing = usable.filter((r) => meetsFloor(r.tier, need.floor));

  if (clearing.length > 0) {
    const chosen = cheapest(clearing);
    for (const resource of usable) {
      if (resource !== chosen) rejected.push({ host: resource.host, why: passedOver(resource, chosen) });
    }
    return {
      rung: 'clears',
      host: chosen.host,
      costClass: chosen.costClass,
      tier: chosen.tier,
      reason:
        `${chosen.host} is the cheapest present resource that clears the "${need.floor}" floor ` +
        `and carries what this work needs: ${chosen.costReason}`,
      degradation: null,
      rejected,
    };
  }

  if (!need.rerunnable) {
    for (const resource of usable) {
      rejected.push({ host: resource.host, why: `${tierPhrase(resource)}, below the "${need.floor}" floor` });
    }
    return refusal(
      `nothing present clears the "${need.floor}" floor, and this work writes outside this process, ` +
        'so it cannot be run below the floor and run again',
      rejected,
    );
  }

  const chosen = cheapest(usable);
  for (const resource of usable) {
    if (resource !== chosen) rejected.push({ host: resource.host, why: passedOver(resource, chosen) });
  }
  return {
    rung: 'degraded',
    host: chosen.host,
    costClass: chosen.costClass,
    tier: chosen.tier,
    reason: `${chosen.host} is the cheapest present resource that carries what this work needs: ${chosen.costReason}`,
    degradation:
      `nothing present clears the "${need.floor}" floor this run's briefs declare, and ${chosen.host} ` +
      `${tierPhrase(chosen)}. The work runs and every deliverable it produces is qualified by that`,
    rejected,
  };
}

/** The work-log detail for one selection. The kernel owns the shape; the caller owns the clock and the write. */
export function selectionDetail(selection: Selection, need: WorkNeed): Record<string, unknown> {
  return {
    rung: selection.rung,
    host: selection.host,
    costClass: selection.costClass,
    tier: selection.tier,
    reason: selection.reason,
    floor: need.floor,
    needed: need.capabilities,
    rerunnable: need.rerunnable,
    ...(selection.degradation === null ? {} : { degradation: selection.degradation }),
    rejected: selection.rejected.map((r) => ({ host: r.host, why: r.why })),
  };
}

/**
 * One selection, in the lines a reader gets. Kept here beside the decision so
 * a surface cannot describe a rung the chooser did not reach, the same reason
 * the unsatisfied-brief explainer lives beside its resolver.
 */
export function explainSelection(selection: Selection, need: WorkNeed): string[] {
  const lines: string[] = [];

  if (selection.rung === 'refused') {
    lines.push(selection.reason + '.');
    lines.push(`  needed: model floor "${need.floor}"${need.capabilities.length > 0 ? `; capability ${need.capabilities.join(', ')}` : ''}`);
    for (const r of selection.rejected) lines.push(`  found: ${r.host} (${r.why})`);
    return lines;
  }

  lines.push(`resource: ${selection.host ?? 'none'} (${selection.costClass ?? 'unknown'} cost). ${selection.reason}.`);
  if (selection.degradation !== null) lines.push(`  ⚑ ${selection.degradation}.`);
  for (const r of selection.rejected) lines.push(`  not chosen: ${r.host} (${r.why})`);
  return lines;
}
