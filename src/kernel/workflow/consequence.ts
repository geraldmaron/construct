/**
 * kernel/workflow/consequence.ts — whether a request deserves professional
 * challenge, and how deep the work should go.
 *
 * Deterministic and model-free: a small high-precision phrase check, stem
 * overlap against concept clusters, project scale, and optional structured
 * signals already on the path (likely skills, workflow challenge flag, step
 * action tiers, open contradictions). Architecture and irreversible change
 * are always challenged. A private helper rename is never an architecture
 * ceremony. Scale raises the bar for mid-weight work; it does not invent
 * process for a solo side project and it does not excuse negligence on a
 * shared store or an open boundary.
 */

import type { ProjectScale } from '../state/profile.ts';
import type { ActionTier } from '../state/steps.ts';
import { stems } from '../skills/routing.ts';
import { tierAtLeast } from '../policy/lattice.ts';

export const DEPTHS = ['light', 'standard', 'challenged'] as const;
export type Depth = (typeof DEPTHS)[number];

export interface Judgment {
  readonly depth: Depth;
  readonly challenge: boolean;
  readonly why: string;
}

/** Optional signals already computed on the classify or resolve path. */
export interface ConsequenceSignals {
  readonly likelySkills?: readonly string[];
  readonly workflowChallenge?: boolean;
  readonly stepTiers?: readonly ActionTier[];
  /** Active contradicts relations against governing obligations, when known. */
  readonly activeContradictions?: number;
}

/** Skills whose likely ranking is itself a consequence signal. */
const CHALLENGE_SKILLS = new Set([
  'system-architecture',
  'security-privacy',
  'governance-risk',
  'adversarial-review',
]);
const ELEVATED_SKILLS = new Set([
  'operations-reliability',
  'strategy-research',
  'program-delivery',
]);

/**
 * High-precision surfaces that must challenge even on a solo project.
 * Kept short on purpose — unusual phrasing is caught by stem clusters below.
 */
const ALWAYS =
  /\b(?:shared (?:database|schema|store)|same (?:database|postgres|mysql|mongo\w*|store)|data ownership|service ownership|security boundary|threat model|multi-tenant|breaking change|schema migration|irreversible|hard to (?:undo|reverse)|(?:no|without) auth(?:entication|orization)?|open to the internet|internet-facing|public (?:api|endpoint|interface)|delete (?:the )?production|drop table|wipe (?:the )?production|vendor(?: lock)?|build vs buy|build-vs-buy)\b/i;

/**
 * Stem clusters. Each cluster contributes its weight at most once. Mid-weight
 * clusters alone stay light on a side project; together with scale or another
 * cluster they raise challenge.
 */
const CLUSTERS: readonly { readonly weight: number; readonly terms: readonly string[] }[] = [
  {
    weight: 4,
    terms: [
      'database', 'postgres', 'mysql', 'mongodb', 'schema', 'migration',
      'authentication', 'authorization', 'sso', 'oauth', 'tenant',
      'stripe', 'pci', 'secret', 'credential', 'api key',
      'audit log', 'production data', 'cutover', 'failover', 'threat',
    ],
  },
  {
    weight: 2,
    terms: [
      'ownership', 'billing', 'payment', 'platform', 'shared', 'migrate',
      'identity', 'architecture', 'boundary', 'coupling', 'privacy', 'pii',
      'compliance', 'permission', 'access control', 'deploy', 'rollback',
      'cross team', 'multi team', 'customers table', 'same table',
    ],
  },
];

const TRIVIAL =
  /\b(?:rename (?:a |the )?(?:private |local |internal )?(?:helper|function|variable|test)|typo|comment[- ]only|formatting|import order|dead code|lint(?:er)?(?: fix)?|whitespace|sort the imports|add a comment)\b/i;

function requestText(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const r = input as Record<string, unknown>;
    const parts = [r.request, r.target, r.scope, r.purpose, r.text].filter((x) => typeof x === 'string') as string[];
    if (parts.length) return parts.join(' ');
    return JSON.stringify(input);
  }
  return '';
}

function phraseHits(query: ReadonlySet<string>, phrase: string): boolean {
  const ps = stems(phrase);
  return ps.length > 0 && ps.every((w) => query.has(w));
}

function conceptScore(text: string): number {
  const q = new Set(stems(text));
  if (q.size === 0) return 0;
  let score = 0;
  let hits = 0;
  for (const c of CLUSTERS) {
    if (c.terms.some((t) => phraseHits(q, t))) {
      score += c.weight;
      hits += 1;
    }
  }
  if (hits >= 2) score += 2;
  return score;
}

function skillScore(likely: readonly string[] | undefined): number {
  if (!likely?.length) return 0;
  let s = 0;
  for (const id of likely) {
    if (CHALLENGE_SKILLS.has(id)) s += 4;
    else if (ELEVATED_SKILLS.has(id)) s += 2;
  }
  return Math.min(s, 8);
}

function tierScore(tiers: readonly ActionTier[] | undefined): number {
  if (!tiers?.length) return 0;
  if (tiers.some((t) => tierAtLeast(t, 'licensed_judgment'))) return 6;
  if (tiers.some((t) => tierAtLeast(t, 'destructive'))) return 5;
  if (tiers.some((t) => tierAtLeast(t, 'external_write'))) return 4;
  return 0;
}

function challengeThreshold(scale: ProjectScale | null): number {
  if (scale === 'organization' || scale === 'multi_team') return 4;
  if (scale === 'team') return 5;
  if (scale === null) return 5;
  return 6;
}

/**
 * Judge a request. `scale` null means onboarding has not answered; treat the
 * threshold as team-like so a missing answer is not an excuse to skip
 * challenge on consequential work.
 */
export function assessConsequence(input: unknown, scale: ProjectScale | null, signals: ConsequenceSignals = {}): Judgment {
  if (signals.workflowChallenge) {
    return { depth: 'challenged', challenge: true, why: 'the workflow declares a deliverable challenge; challenge before treating the result as strongly validated' };
  }
  if ((signals.activeContradictions ?? 0) > 0) {
    return { depth: 'challenged', challenge: true, why: 'an active contradiction stands against a governing obligation; challenge before treating new work as strongly validated' };
  }

  const text = requestText(input);
  if (ALWAYS.test(text) && !TRIVIAL.test(text)) {
    return { depth: 'challenged', challenge: true, why: 'architectural, ownership, security, or hard-to-reverse consequences; challenge before treating the result as strongly validated' };
  }

  const concepts = conceptScore(text);
  const rawSkills = skillScore(signals.likelySkills);
  const tiers = tierScore(signals.stepTiers);
  // Likely professional skills tip a strong or scaled signal; they do not turn
  // every mid-weight ownership mention into architecture ceremony on a side project.
  const skills =
    tiers > 0 || concepts >= 4 || scale === 'organization' || scale === 'multi_team'
      ? rawSkills
      : concepts >= 2
        ? Math.min(rawSkills, 2)
        : 0;
  const score = concepts + skills + tiers;
  const trivial = TRIVIAL.test(text);
  const threshold = challengeThreshold(scale);

  if (tiers >= 4 && !trivial) {
    return { depth: 'challenged', challenge: true, why: 'the bound steps include external, destructive, or licensed work; challenge before treating the result as strongly validated' };
  }

  if (trivial && score < threshold) {
    return { depth: 'light', challenge: false, why: 'low-stakes reversible change; architecture ceremony would cost more than being wrong' };
  }
  if (score >= threshold) {
    return {
      depth: 'challenged',
      challenge: true,
      why: skills >= 4
        ? 'professional skill ranking and request signals point at architectural, security, or hard-to-reverse consequences; challenge before treating the result as strongly validated'
        : 'architectural, ownership, security, or hard-to-reverse consequences; challenge before treating the result as strongly validated',
    };
  }
  if (scale === 'organization' || scale === 'multi_team') {
    if (concepts >= 2) {
      return { depth: 'challenged', challenge: true, why: 'cross-cutting work in a multi-team or organization project; challenge before treating the result as strongly validated' };
    }
    return { depth: 'standard', challenge: false, why: 'ordinary managed work at this scale; verify it, do not run a full architectural challenge' };
  }
  if (scale === 'team') {
    return { depth: 'standard', challenge: false, why: 'ordinary managed work for a team; verify it, do not run a full architectural challenge' };
  }
  return { depth: 'light', challenge: false, why: 'ordinary work on a small project; keep it small' };
}

export function judgmentRequired(workflowChallenge: boolean, judgment: Judgment): boolean {
  return workflowChallenge || judgment.challenge;
}
