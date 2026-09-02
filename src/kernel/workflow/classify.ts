/**
 * kernel/workflow/classify.ts — which of the four interaction classes a
 * request in ordinary language asks for.
 *
 * answer: a question; nothing is recorded. remember: record one thing.
 * manage: do a piece of work and hand it back finished. maintain: keep
 * something reviewed on a schedule or an event. The rules are deterministic
 * and stated; when the choice between classes would change cost,
 * persistence, permissions, or side effects and the wording is not clear,
 * the answer says so instead of guessing upward.
 */

import type { InteractionClass } from '../registry/models.ts';

export interface Classification {
  readonly class: InteractionClass;
  readonly confidence: number;
  readonly why: string;
  /** True when a higher class was plausible and the person should confirm before work, cost, or writes begin. */
  readonly confirmBeforeProceeding: boolean;
  /** For remember: the kind of statement the wording suggests. */
  readonly rememberKind: 'decision' | 'constraint' | 'principle' | 'note' | 'outcome' | null;
}

const REMEMBER = /^\s*(?:please\s+)?(?:remember|record|note|log|write down|keep in mind|jot down)\b/i;
const REMEMBER_MID = /\b(?:remember|record|note)\s+(?:that|this|the following|:)/i;
const STANDING = /\b(?:every|each)\s+(?:day|week|month|quarter|year|morning|monday|tuesday|wednesday|thursday|friday|january|february|march|april|may|june|july|august|september|october|november|december|sprint|release)\b|\b(?:weekly|monthly|quarterly|annually|yearly|daily|nightly)\b|\bon a schedule\b|\bwhenever\s+(?:a|an|the|someone|we)\b|\bkeep\s+\w+\s+(?:reviewed|checked|in sync|up to date)\b|\bset up a (?:recurring|standing|scheduled)\b/i;
const WORK = /^\s*(?:please\s+|can you\s+|could you\s+|let'?s\s+)?(?:review|write|draft|build|implement|fix|check|compare|produce|analy[sz]e|assess|audit|prepare|create|generate|plan|design|refactor|migrate|update|summari[sz]e|reconcile|investigate|verify|validate|evaluate|estimate|map|structure|spec|specify|document|propose|triage|rank|prioriti[sz]e)\b/i;
const WORK_MID = /\b(?:review|audit|compare|assess|analy[sz]e)\s+(?:this|the|our|my|these)\b/i;
const WORK_ANY = /\b(?:review|write|draft|build|implement|fix|check|compare|produce|analy[sz]e|assess|audit|prepare|create|generate|plan|design|refactor|migrate|update|summari[sz]e|reconcile|investigate|verify|validate|evaluate|estimate|map|structure|document|propose|triage|rank|prioriti[sz]e|report|flag|notify|remind)\b/i;
const QUESTION = /^\s*(?:what|why|how|where|when|who|which|does|do|is|are|can|could|should|would|will|did|has|have|explain|tell me)\b|\?\s*$/i;
const TRIVIAL_QUESTION = /^\s*(?:what does|what is|what's|where is|where's|how does|why does|explain)\b/i;

function rememberKind(text: string): Classification['rememberKind'] {
  if (/\b(?:decided|decision|we will not|we won't|we will|going with)\b/i.test(text)) return 'decision';
  if (/\b(?:never|must not|must|always|do not|don't|constraint|only)\b/i.test(text)) return 'constraint';
  if (/\b(?:principle|we prefer|we value|by default)\b/i.test(text)) return 'principle';
  if (/\b(?:goal|outcome|by\s+(?:q[1-4]|end of|next)|target)\b/i.test(text)) return 'outcome';
  return 'note';
}

export function classifyInteraction(text: string): Classification {
  const t = text.trim();
  if (t === '') return { class: 'answer', confidence: 0.5, why: 'nothing was asked', confirmBeforeProceeding: false, rememberKind: null };
  if (REMEMBER.test(t) || REMEMBER_MID.test(t)) {
    return { class: 'remember', confidence: 0.9, why: 'the wording asks to remember or record something', confirmBeforeProceeding: false, rememberKind: rememberKind(t) };
  }
  if (STANDING.test(t)) {
    const explicit = WORK.test(t) || WORK_MID.test(t) || WORK_ANY.test(t) || /\b(?:set up|schedule|automate|keep)\b/i.test(t);
    return {
      class: 'maintain',
      confidence: explicit ? 0.85 : 0.6,
      why: 'the wording describes something recurring or event-driven',
      confirmBeforeProceeding: !explicit,
      rememberKind: null,
    };
  }
  if (WORK.test(t) || WORK_MID.test(t)) {
    const alsoQuestion = QUESTION.test(t) && !WORK.test(t);
    return { class: 'manage', confidence: alsoQuestion ? 0.6 : 0.85, why: 'the wording asks for work to be done and handed back', confirmBeforeProceeding: alsoQuestion, rememberKind: null };
  }
  if (TRIVIAL_QUESTION.test(t)) return { class: 'answer', confidence: 0.95, why: 'a plain question about how something works', confirmBeforeProceeding: false, rememberKind: null };
  if (QUESTION.test(t)) return { class: 'answer', confidence: 0.8, why: 'a question; answering records nothing', confirmBeforeProceeding: false, rememberKind: null };
  return { class: 'answer', confidence: 0.5, why: 'no request for work, memory, or a standing review was recognized; answer, and offer more if the person wanted it', confirmBeforeProceeding: false, rememberKind: null };
}
