/**
 * kernel/workflow/consequence.ts — how much rigor a piece of work gets, and
 * whether it must be challenged before it is accepted.
 *
 * Deterministic and model-free. Structure sets the floor: the workflow's own
 * challenge flag, the action tiers of its steps, and open contradictions
 * against governing records. Host stakes and the lexical floor only raise
 * it, and every lexical raise says so in its signal. Nothing lowers it
 * except the person's scale answer: a side project with nothing raised is
 * light, every other scale (and an unanswered one) is standard.
 */

import type { ProjectScale } from '../state/profile.ts';
import type { ActionTier } from '../state/steps.ts';
import { stems } from '../skills/routing.ts';
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

export const SIGNAL_KINDS = ['workflow', 'tier', 'contradiction', 'host_stakes', 'skill', 'lexical_floor', 'scale'] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** One reason the judgment came out the way it did. Word-based signals end in "(lexical)". */
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
  readonly boundSkills: readonly string[];
  readonly chosenSkill: string | null;
  readonly activeContradictions: number;
  readonly stakes: Stakes | null;
  readonly words: string;
}

/** Points a method skill adds to the lexical floor. The challenge method itself adds nothing. */
const SKILL_POINTS: Readonly<Record<string, number>> = {
  'system-architecture': 4,
  'security-privacy': 4,
  'governance-risk': 4,
  'operations-reliability': 2,
  'strategy-research': 2,
  'program-delivery': 2,
};

/** The lexical floor raises when concepts plus gated skill points reach this, at every scale. */
const LEXICAL_THRESHOLD = 5;

/**
 * High-precision surfaces that raise even on a solo project.
 * Kept short on purpose — unusual phrasing is caught by stem clusters below.
 */
const ALWAYS =
  /\b(?:shared (?:database|schema|store)|same (?:database|postgres|mysql|mongo\w*|store)|data ownership|service ownership|security boundary|threat model|multi-tenant|breaking change|schema migration|irreversible|hard to (?:undo|reverse)|(?:no|without) auth(?:entication|orization)?|open to the internet|internet-facing|public (?:api|endpoint|interface)|delete (?:the )?production|drop table|wipe (?:the )?production|vendor(?: lock)?|build vs buy|build-vs-buy)\b/i;

/**
 * Stem clusters. Each cluster contributes its weight at most once; touching
 * both adds two more.
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

/** The words a judgment reads: the request-like fields of a workflow input, plus any declared words. */
export function wordsOf(input: unknown, words?: string): string {
  const parts: string[] = [];
  if (typeof input === 'string') parts.push(input);
  else if (input && typeof input === 'object' && !Array.isArray(input)) {
    const r = input as Record<string, unknown>;
    for (const key of ['request', 'target', 'scope', 'purpose', 'text']) {
      const v = r[key];
      if (typeof v === 'string' && v.trim()) parts.push(v);
    }
  }
  if (typeof words === 'string' && words.trim()) parts.push(words);
  return parts.join(' ');
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

function skillPoints(skills: readonly string[]): number {
  let points = 0;
  for (const id of new Set(skills)) points += SKILL_POINTS[id] ?? 0;
  return Math.min(points, 8);
}

function stakesSignal(stakes: Stakes | null): Signal | null {
  if (!stakes) return null;
  const hard = stakes.reversible === false;
  const areas = [...new Set(stakes.affects.filter((a) => a !== 'none'))].map((a) => a.replace(/_/g, ' '));
  if (!hard && areas.length === 0) return null;
  const touches = areas.length ? `touches ${areas.join(', ')}` : '';
  const detail = hard && touches ? `the host reported it is hard to undo and ${touches}` : hard ? 'the host reported it is hard to undo' : `the host reported it ${touches}`;
  return { kind: 'host_stakes', detail, raises: true };
}

function lexicalSignal(c: ConsequenceInput): Signal | null {
  const always = ALWAYS.exec(c.words);
  if (always) return { kind: 'lexical_floor', detail: `the request says "${always[0]}" (lexical)`, raises: true };
  const concepts = conceptScore(c.words);
  const points = skillPoints([...c.boundSkills, ...(c.chosenSkill ? [c.chosenSkill] : [])]);
  const gated =
    concepts >= 4 || c.scale === 'multi_team' || c.scale === 'organization' ? points
      : concepts >= 2 ? Math.min(points, 2)
        : 0;
  if (concepts + gated < LEXICAL_THRESHOLD) return null;
  return gated > 0
    ? { kind: 'skill', detail: 'the request\'s words and its method point at architectural, security, or hard-to-reverse work (lexical)', raises: true }
    : { kind: 'lexical_floor', detail: 'the request\'s words point at architectural, security, or hard-to-reverse work (lexical)', raises: true };
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
  const lexical = lexicalSignal(c);
  if (lexical) signals.push(lexical);

  if (signals.length > 0) {
    return { depth: 'challenged', challenge: true, why: `challenge before treating the result as strongly validated: ${signals.map((s) => s.detail).join('; ')}`, signals };
  }
  if (c.scale === 'side_project') {
    return { depth: 'light', challenge: false, why: 'The person set this up as a side project and nothing in the work raised the stakes', signals };
  }
  if (c.scale === null) {
    return {
      depth: 'standard',
      challenge: false,
      why: 'ordinary managed work; the project scale is not answered, so it is treated as a team project; verify it, do not run a full architectural challenge',
      signals: [{ kind: 'scale', detail: 'not answered; treated as a team project', raises: false }],
    };
  }
  return { depth: 'standard', challenge: false, why: `ordinary managed work for ${SCALE_WORDS[c.scale]}; verify it, do not run a full architectural challenge`, signals };
}

export function judgmentRequired(workflowChallenge: boolean, judgment: Judgment): boolean {
  return workflowChallenge || judgment.challenge;
}
