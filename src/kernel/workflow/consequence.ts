/**
 * kernel/workflow/consequence.ts — whether a request deserves professional
 * challenge, and how deep the work should go.
 *
 * Deterministic: the wording and the project's scale, nothing semantic.
 * Architecture and irreversible change are always challenged. A private
 * helper rename is never an architecture ceremony. Scale raises the bar for
 * mid-weight work; it does not invent process for a solo side project and
 * it does not excuse negligence on a shared database.
 */

import type { ProjectScale } from '../state/profile.ts';

export const DEPTHS = ['light', 'standard', 'challenged'] as const;
export type Depth = (typeof DEPTHS)[number];

export interface Judgment {
  readonly depth: Depth;
  readonly challenge: boolean;
  readonly why: string;
}

const CHALLENGED =
  /\b(?:shared database|service ownership|data ownership|architecture|data model|security boundary|threat model|vendor(?: lock)?|build vs buy|build-vs-buy|irreversible|hard to undo|hard-to-reverse|multi-tenant|public (?:api|claim|interface)|breaking change|schema migration|migrate (?:the |our |all )?(?:database|auth|billing)|own(?:s|ing|ership of) (?:the |a )?(?:service|system|data))\b/i;
const TRIVIAL =
  /\b(?:rename (?:a |the )?(?:private |local |internal )?(?:helper|function|variable|test)|typo|comment[- ]only|formatting|import order|dead code|lint(?:er)?(?: fix)?|whitespace)\b/i;
const CROSS_CUTTING =
  /\b(?:ownership|schema|shared |cross-?team|public api|authentication|authorization|billing|migrate|platform)\b/i;

function requestText(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const r = input as Record<string, unknown>;
    const parts = [r.request, r.target, r.scope, r.purpose].filter((x) => typeof x === 'string') as string[];
    if (parts.length) return parts.join(' ');
    return JSON.stringify(input);
  }
  return '';
}

/**
 * Judge a request. `scale` null means onboarding has not answered; treat as
 * standard so a missing answer is not an excuse to skip challenge on
 * consequential work.
 */
export function assessConsequence(input: unknown, scale: ProjectScale | null): Judgment {
  const text = requestText(input);
  if (TRIVIAL.test(text) && !CHALLENGED.test(text)) {
    return { depth: 'light', challenge: false, why: 'low-stakes reversible change; architecture ceremony would cost more than being wrong' };
  }
  if (CHALLENGED.test(text)) {
    return { depth: 'challenged', challenge: true, why: 'architectural, ownership, security, or hard-to-reverse consequences; challenge before treating the result as strongly validated' };
  }
  if (scale === 'organization' || scale === 'multi_team') {
    if (CROSS_CUTTING.test(text)) {
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
