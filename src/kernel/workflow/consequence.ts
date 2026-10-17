/**
 * kernel/workflow/consequence.ts — how much rigor a piece of work gets, and
 * whether it must be challenged before it is accepted.
 *
 * Deterministic and model-free, and it never reads the person's words.
 * Structure sets the floor: the workflow's own challenge flag, the action
 * tiers of its steps, and open contradictions against governing records. The
 * stakes the host reports (whether the work can be undone, what it touches)
 * only raise it; when the host reports none, the judgment says so rather than
 * guessing from vocabulary. Nothing lowers it except the person's scale
 * answer: a side project with nothing raised is light, every other scale (and
 * an unanswered one) is standard.
 */

import type { ProjectScale } from '../state/profile.ts';
import type { ActionTier } from '../state/steps.ts';
import { tierAtLeast, tierRank } from '../policy/lattice.ts';

export const DEPTHS = ['light', 'standard', 'challenged'] as const;
export type Depth = (typeof DEPTHS)[number];

/** What the host may say the work touches. 'none' says it touches nothing listed. */
export const STAKE_AREAS = ['none', 'production', 'shared_data', 'personal_data', 'security', 'money', 'legal', 'customers', 'other_teams', 'public'] as const;
export type StakeArea = (typeof STAKE_AREAS)[number];

/** The host's own account of the stakes: whether the work can be undone, and what it touches. */
export interface Stakes {
  readonly reversible: boolean | null;
  readonly affects: readonly StakeArea[];
}

export const SIGNAL_KINDS = ['workflow', 'tier', 'contradiction', 'host_stakes', 'scale'] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** One reason the judgment came out the way it did. */
export interface Signal {
  readonly kind: SignalKind;
  readonly detail: string;
  readonly raises: boolean;
}

export interface Judgment {
  readonly depth: Depth;
  readonly challenge: boolean;
  readonly why: string;
  readonly signals: readonly Signal[];
}

/** Everything one judgment reads. Callers build it from the workflow's structure and what was declared. */
export interface ConsequenceInput {
  readonly scale: ProjectScale | null;
  readonly workflowChallenge: boolean;
  readonly stepTiers: readonly ActionTier[];
  readonly activeContradictions: number;
  readonly stakes: Stakes | null;
}

/** What a tier at or above external_write means, in plain words. */
const TIER_WORDS: Readonly<Partial<Record<ActionTier, string>>> = {
  external_write: 'changes systems outside the project',
  destructive: 'can delete or overwrite what cannot be restored',
  licensed_judgment: 'needs sign-off a qualified person owns',
};

const SCALE_WORDS: Readonly<Record<ProjectScale, string>> = {
  solo: 'a solo project',
  side_project: 'a side project',
  team: 'a team',
  multi_team: 'a multi-team project',
  organization: 'an organization',
};

function stakesSignal(stakes: Stakes | null): Signal | null {
  if (!stakes) return { kind: 'host_stakes', detail: 'the host did not report whether this can be undone or what it touches', raises: false };
  const hard = stakes.reversible === false;
  const areas = [...new Set(stakes.affects.filter((a) => a !== 'none'))].map((a) => a.replace(/_/g, ' '));
  if (!hard && areas.length === 0) return null;
  const touches = areas.length ? `touches ${areas.join(', ')}` : '';
  const detail = hard && touches ? `the host reported it is hard to undo and ${touches}` : hard ? 'the host reported it is hard to undo' : `the host reported it ${touches}`;
  return { kind: 'host_stakes', detail, raises: true };
}

/** Judge one piece of work. Every row that applies adds a raising signal; any raising signal means challenged. */
export function assessConsequence(c: ConsequenceInput): Judgment {
  const signals: Signal[] = [];
  if (c.workflowChallenge) signals.push({ kind: 'workflow', detail: 'the workflow declares that its deliverable must be challenged', raises: true });
  const outward = c.stepTiers.filter((t) => tierAtLeast(t, 'external_write'));
  if (outward.length) {
    const top = outward.reduce((a, b) => (tierRank(b) > tierRank(a) ? b : a));
    signals.push({ kind: 'tier', detail: `a bound step acts at ${top} (it ${TIER_WORDS[top] ?? 'acts outside the project'})`, raises: true });
  }
  if (c.activeContradictions > 0) {
    signals.push({ kind: 'contradiction', detail: `${String(c.activeContradictions)} active contradiction(s) stand against a governing decision or requirement`, raises: true });
  }
  const stakes = stakesSignal(c.stakes);
  if (stakes) signals.push(stakes);

  if (signals.some((s) => s.raises)) {
    return { depth: 'challenged', challenge: true, why: `challenge before treating the result as strongly validated: ${signals.filter((s) => s.raises).map((s) => s.detail).join('; ')}`, signals };
  }
  if (c.scale === 'side_project') {
    return { depth: 'light', challenge: false, why: 'The person set this up as a side project and nothing in the work raised the stakes', signals };
  }
  if (c.scale === null) {
    return {
      depth: 'standard',
      challenge: false,
      why: 'ordinary managed work; the project scale is not answered, so it is treated as a team project; verify it, do not run a full architectural challenge',
      signals: [...signals, { kind: 'scale', detail: 'not answered; treated as a team project', raises: false }],
    };
  }
  return { depth: 'standard', challenge: false, why: `ordinary managed work for ${SCALE_WORDS[c.scale]}; verify it, do not run a full architectural challenge`, signals };
}

export function judgmentRequired(workflowChallenge: boolean, judgment: Judgment): boolean {
  return workflowChallenge || judgment.challenge;
}
