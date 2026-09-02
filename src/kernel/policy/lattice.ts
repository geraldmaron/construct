/**
 * kernel/policy/lattice.ts — the six action tiers and what each needs by default.
 *
 * observe < draft < project_write < external_write < destructive, and
 * licensed_judgment beside them: not a rung Construct can climb to, because
 * a qualified person owns that call. Nothing here reads state.
 */

import { ACTION_TIERS, type ActionTier } from '../state/steps.ts';

export { ACTION_TIERS, type ActionTier };

const RANK: Readonly<Record<ActionTier, number>> = {
  observe: 0,
  draft: 1,
  project_write: 2,
  external_write: 3,
  destructive: 4,
  licensed_judgment: 5,
};

export function tierRank(tier: ActionTier): number {
  return RANK[tier];
}

/** True when `tier` is at least as consequential as `floor`. */
export function tierAtLeast(tier: ActionTier, floor: ActionTier): boolean {
  return RANK[tier] >= RANK[floor];
}

export const TIER_REQUIREMENTS = [
  'automatic',
  'explicit_request',
  'managed_outcome',
  'action_time_approval',
  'never_by_construct',
] as const;
export type TierRequirement = (typeof TIER_REQUIREMENTS)[number];

export interface TierPolicy {
  readonly tier: ActionTier;
  readonly requirement: TierRequirement;
  readonly description: string;
  /** Whether a standing grant can satisfy the requirement without action-time approval. */
  readonly standingGrantSuffices: boolean;
}

export const TIER_POLICIES: Readonly<Record<ActionTier, TierPolicy>> = {
  observe: {
    tier: 'observe',
    requirement: 'automatic',
    description: 'Read project and context data that is already granted, and compute status.',
    standingGrantSuffices: true,
  },
  draft: {
    tier: 'draft',
    requirement: 'automatic',
    description: 'Produce a proposed change or an artifact without applying it.',
    standingGrantSuffices: true,
  },
  project_write: {
    tier: 'project_write',
    requirement: 'managed_outcome',
    description: 'Reversible writes to Construct state or project working files inside an explicit outcome; remembering something happens only when asked.',
    standingGrantSuffices: true,
  },
  external_write: {
    tier: 'external_write',
    requirement: 'action_time_approval',
    description: 'Consequential changes to Jira, GitHub, messaging, deployment, access, or other systems.',
    standingGrantSuffices: true,
  },
  destructive: {
    tier: 'destructive',
    requirement: 'action_time_approval',
    description: 'Irreversible deletion, overwrite of authoritative data, access revocation, or material spend.',
    standingGrantSuffices: false,
  },
  licensed_judgment: {
    tier: 'licensed_judgment',
    requirement: 'never_by_construct',
    description: 'Legal, medical, regulated, fiduciary, or other sign-off a qualified person owns. Construct issue-spots and prepares; it never decides.',
    standingGrantSuffices: false,
  },
};
