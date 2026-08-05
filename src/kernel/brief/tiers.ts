/**
 * kernel/brief/tiers.ts — the model capability floor a brief may declare
 *.
 *
 * Commitment 10 says briefs declare and a dispatcher satisfies. Until now a
 * brief could declare its inputs, its tool capabilities and its postconditions
 * but nothing about the model doing the work, so a brief whose task is genuine
 * judgment dispatched identically to a 4b local model and to a frontier one, and
 * nothing in the record distinguished the two runs afterwards.
 *
 * That gap is measured, not assumed. A recorded run put conflict-shaped outcomes
 * through the Phase 2 dogfood on a 4b model and the decision inbox never fired;
 * whether that was honest silence or a model too weak to stake opposing
 * positions is undecidable, precisely because no floor was declared and no model
 * identity was recorded. The OpenCode usage-blindness precedent is the same
 * shape: a host reporting cost 0 and steps 0 is unmeasured, not free.
 *
 * The scale is ordinal, small, and family-agnostic. It never names a vendor or a
 * model string, because the kernel comparing "is this at least capable?" must
 * stay true across hosts that share no model names — the tier-to-model mapping
 * is host-adapter data, declared next to each adapter's pin. The kernel compares
 * ordinals; the adapter says which of its models sit at which tier.
 *
 * Being below the floor is a DEGRADATION, not an unsatisfied requirement. It is
 * recorded loudly and dispatch continues, because refusing would quietly make
 * the free local-model path unusable for exactly the work it was chosen for, and
 * "free means free" is a standing decision here. Loud degradation preserves both
 * the user's model choice and the honesty of any later claim about the run.
 */

/**
 * Ordered weakest to strongest. The order IS the semantics — `MODEL_TIERS`
 * index is the ordinal every comparison below uses, so entries may be appended
 * but never reordered.
 */
export const MODEL_TIERS = ['any', 'capable', 'frontier'] as const;

export type ModelTier = (typeof MODEL_TIERS)[number];

/** What each tier claims, in the terms a brief author reasons in. */
export const TIER_MEANING: Readonly<Record<ModelTier, string>> = {
  any: 'no floor — mechanical work whose correctness does not depend on model strength',
  capable: 'work needing reliable instruction-following and structured output',
  frontier: 'work needing genuine judgment: staking a position, weighing a conflict, advising',
};

export function isModelTier(value: unknown): value is ModelTier {
  return typeof value === 'string' && (MODEL_TIERS as readonly string[]).includes(value);
}

/** Where a tier sits on the scale. Higher is stronger. */
export function tierRank(tier: ModelTier): number {
  return MODEL_TIERS.indexOf(tier);
}

/**
 * Whether a model at `actual` satisfies a brief declaring `floor`.
 *
 * An UNKNOWN actual tier does not satisfy a floor above `any`. That is the
 * deliberate direction to fail: a host that cannot say what tier its model sits
 * at has not told us the floor is met, and treating silence as compliance is the
 * same unmeasured-equals-fine mistake the cost-0 precedent already cost us once.
 */
export function meetsFloor(actual: ModelTier | null | undefined, floor: ModelTier): boolean {
  if (floor === 'any') return true;
  if (!actual) return false;
  return tierRank(actual) >= tierRank(floor);
}
