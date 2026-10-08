/**
 * kernel/workflow/classify.ts — which of the four interaction classes a
 * request in ordinary language asks for.
 *
 * answer: a question; nothing is recorded. remember: record one thing.
 * manage: do a piece of work and hand it back finished. maintain: keep
 * something reviewed on a schedule or an event. A request about working
 * alongside other agents is marked with the work-ledger action that serves it,
 * because no workflow does. The rules are deterministic
 * and stated; when the choice between classes would change cost,
 * persistence, permissions, or side effects and the wording is not clear,
 * the answer says so instead of guessing upward.
 */

import type { InteractionClass } from '../registry/models.ts';
import { COORDINATION_NEXT } from './intake.ts';

export interface Classification {
  readonly class: InteractionClass;
  readonly confidence: number;
  readonly why: string;
  /** True when a higher class was plausible and the person should confirm before work, cost, or writes begin. */
  readonly confirmBeforeProceeding: boolean;
  /** For remember: the kind of statement the wording suggests. */
  readonly rememberKind: 'decision' | 'constraint' | 'principle' | 'note' | 'outcome' | null;
  /**
   * When the request is about working alongside other agents (handing work
   * on, taking it up, seeing who else is here, reserving files), which work
   * ledger action serves it. That is never a workflow.
   */
  readonly coordination: Coordination | null;
}

export interface Coordination {
  readonly action: 'handoff' | 'accept' | 'awareness' | 'takeover' | 'claim';
  readonly next: string;
}

const AGENT = String.raw`(?:agent|session|subagent|claude|cursor|codex|gemini|model|worker)s?`;
const HANDOFF_TO_AGENT = new RegExp(String.raw`\b(?:hand|pass)\b[^.?!]*\bto\s+(?:the\s+)?(?:other|another|next|a\s+different)\s+${AGENT}\b`, 'i');
const HANDOFF_BARE = /\bhand\s+(?:this|it|that|my\s+work|the\s+work|your\s+work)\s+(?:off|over)\s*(?:[.!?]|$)/i;
const ACCEPT_HANDOFF = /\b(?:accept|pick\s+up|take)\s+(?:the\s+|a\s+|that\s+|this\s+|any\s+)?hand\s?-?offs?\b|\bhanded\s+(?:off|over)\s+to\s+(?:me|us)\b/i;
const AWARENESS = new RegExp(String.raw`\b(?:who\s+else|what\s+(?:is|are)\s+(?:the\s+)?other\s+${AGENT}|(?:any|which)\s+other\s+${AGENT}|anyone\s+else)\b[^?]*\b(?:working|doing|editing|holding|here|on)\b`, 'i');
const TAKEOVER = new RegExp(String.raw`\btake\s+over\b[^.?!]*\b(?:from|${AGENT}|claim|their|its)\b`, 'i');
const RESERVE = /\b(?:claim|reserve)\s+(?:the\s+|these\s+|this\s+|those\s+)?(?:files?|paths?|director(?:y|ies)|folders?)\b|\block\s+(?:the|these|those)\s+(?:files|paths|directories|folders)\b/i;

const COORDINATION: readonly (readonly [RegExp, Coordination])[] = [
  [ACCEPT_HANDOFF, { action: 'accept', next: COORDINATION_NEXT.accept }],
  [HANDOFF_TO_AGENT, { action: 'handoff', next: COORDINATION_NEXT.handoff }],
  [HANDOFF_BARE, { action: 'handoff', next: COORDINATION_NEXT.handoff }],
  [TAKEOVER, { action: 'takeover', next: COORDINATION_NEXT.takeover }],
  [AWARENESS, { action: 'awareness', next: COORDINATION_NEXT.awareness }],
  [RESERVE, { action: 'claim', next: COORDINATION_NEXT.claim }],
];

function coordinationIn(text: string): Coordination | null {
  return COORDINATION.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

const REMEMBER = /^\s*(?:please\s+)?(?:remember|record|note|log|write down|keep in mind|jot down)\b/i;
const REMEMBER_MID = /\b(?:remember|record|note)\s+(?:that|this|the following|:)/i;
const STANDING = /\b(?:every|each)\s+(?:day|week|month|quarter|year|morning|monday|tuesday|wednesday|thursday|friday|january|february|march|april|may|june|july|august|september|october|november|december|sprint|release)\b|\b(?:weekly|monthly|quarterly|annually|yearly|daily|nightly)\b|\bon a schedule\b|\bwhenever\s+(?:a|an|the|someone|we)\b|\bkeep\s+\w+\s+(?:reviewed|checked|in sync|up to date)\b|\bset up a (?:recurring|standing|scheduled)\b/i;
const WORK = /^\s*(?:please\s+|can you\s+|could you\s+|let'?s\s+)?(?:review|write|rewrite|draft|build|implement|fix|check|compare|produce|analy[sz]e|assess|audit|prepare|create|generate|plan|design|refactor|migrate|update|summari[sz]e|reconcile|investigate|verify|validate|evaluate|estimate|map|structure|spec|specify|document|propose|triage|rank|prioriti[sz]e|research|look into|find out|dig into)\b/i;
const WORK_MID = /\b(?:review|audit|compare|assess|analy[sz]e)\s+(?:this|the|our|my|these)\b/i;
const WORK_ANY = /\b(?:review|write|rewrite|draft|build|implement|fix|check|compare|produce|analy[sz]e|assess|audit|prepare|create|generate|plan|design|refactor|migrate|update|summari[sz]e|reconcile|investigate|verify|validate|evaluate|estimate|map|structure|document|propose|triage|rank|prioriti[sz]e|report|flag|notify|remind)\b/i;
const WANT = /^\s*(?:please\s+)?(?:i (?:want|need)(?: you to)?|i(?:'d| would) like(?: you to)?)\b/i;
const QUESTION = /^\s*(?:what|why|how|where|when|who|which|does|do|is|are|can|could|should|would|will|did|has|have|explain|tell me)\b|\?\s*$/i;
/** A deliverable named as a bare noun phrase ("PRD for webhooks", "an RFC on retries") asks for that deliverable. */
const ARTIFACT = /^\s*(?:a|an|the|new|quick|draft|first)?\s*(?:prd|rfc|adr|spec|one[- ]pager|proposal|business case|design doc|tech(?:nical)? spec|requirements doc(?:ument)?|decision (?:memo|record)|memo|runbook|postmortem|post-mortem)s?\b(?!\s*(?:\?|is\b|was\b|says\b|mean))/i;
/** Work asked for with no object a person could check: what to write is still the question. */
const VAGUE_OBJECT = /\b(?:write|draft|prepare|create|make|put together|send)\s+(?:up\s+)?(?:something|anything|some(?:thing)? (?:for|about|on)|a thing|stuff|a note)\b/i;
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
  if (t === '') return { class: 'answer', confidence: 0.5, why: 'nothing was asked', confirmBeforeProceeding: false, rememberKind: null, coordination: null };
  if (REMEMBER.test(t) || REMEMBER_MID.test(t)) {
    return { class: 'remember', confidence: 0.9, why: 'the wording asks to remember or record something', confirmBeforeProceeding: false, rememberKind: rememberKind(t), coordination: null };
  }
  const coordination = coordinationIn(t);
  if (coordination) {
    return {
      class: coordination.action === 'awareness' ? 'answer' : 'manage',
      confidence: 0.85,
      why: 'the wording is about working alongside other agents; the work ledger serves it, not a workflow',
      confirmBeforeProceeding: false,
      rememberKind: null,
      coordination,
    };
  }
  if (STANDING.test(t)) {
    const explicit = WORK.test(t) || WORK_MID.test(t) || WORK_ANY.test(t) || /\b(?:set up|schedule|automate|keep)\b/i.test(t);
    return {
      class: 'maintain',
      confidence: explicit ? 0.85 : 0.6,
      why: 'the wording describes something recurring or event-driven',
      confirmBeforeProceeding: !explicit,
      rememberKind: null,
      coordination: null,
    };
  }
  if (WORK.test(t) || WORK_MID.test(t) || (WANT.test(t) && WORK_ANY.test(t))) {
    if (VAGUE_OBJECT.test(t)) {
      return { class: 'manage', confidence: 0.6, why: 'the wording asks for work but does not say what to produce; ask what form it should take before starting', confirmBeforeProceeding: true, rememberKind: null, coordination: null };
    }
    const alsoQuestion = QUESTION.test(t) && !WORK.test(t) && !WANT.test(t);
    return { class: 'manage', confidence: alsoQuestion ? 0.6 : 0.85, why: 'the wording asks for work to be done and handed back', confirmBeforeProceeding: alsoQuestion, rememberKind: null, coordination: null };
  }
  if (ARTIFACT.test(t) && !QUESTION.test(t)) {
    return { class: 'manage', confidence: 0.75, why: 'the wording names a deliverable to produce', confirmBeforeProceeding: false, rememberKind: null, coordination: null };
  }
  if (TRIVIAL_QUESTION.test(t)) return { class: 'answer', confidence: 0.95, why: 'a plain question about how something works', confirmBeforeProceeding: false, rememberKind: null, coordination: null };
  if (QUESTION.test(t)) return { class: 'answer', confidence: 0.8, why: 'a question; answering records nothing', confirmBeforeProceeding: false, rememberKind: null, coordination: null };
  return { class: 'answer', confidence: 0.5, why: 'no request for work, memory, or a standing review was recognized; answer, and offer more if the person wanted it', confirmBeforeProceeding: false, rememberKind: null, coordination: null };
}
