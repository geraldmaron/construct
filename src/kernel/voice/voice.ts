/**
 * kernel/voice/voice.ts — how Construct sounds, defined once.
 *
 * Commitment 17: deliverables sound like Construct — plain, direct, no hype
 * vocabulary; the register STRATEGY.md is written in — unless the user
 * overrides it, and the override is recorded.
 *
 * Two decisions are load-bearing here, and both are reactions to how the
 * predecessor did it:
 *
 *   1. The voice is BOUND, not policed. It travels into the assignment before
 *      the work happens, so a role writes in it. The predecessor scanned
 *      finished text for banned words and failed the deliverable afterwards,
 *      which caught the vocabulary and none of the register, punished prose
 *      that quoted the thing it was warning about, and told the author nothing
 *      until the work was already done. That regex stays dead.
 *   2. The voice is one thing, not a per-role option. A deliverable that
 *      sounds like six different products came from six roles each picking
 *      their own register. Identity is not a per-role choice, for the same
 *      reason completion state is not.
 *
 * The rules are stated positively, and each one is here because it changes
 * whether a reader believes the deliverable or can act on it. Two of them do
 * work no other part of the system does: `inclusive-language`, because a
 * deliverable a reader cannot see themselves in is a deliverable they discount;
 * and `cite-or-mark`, which teaches the citation notation that verify/claims.ts
 * checks deterministically afterwards. That check has always existed and the
 * role was never told the notation it would be held to, which is a rule
 * enforced against someone who was never shown it.
 */

export interface VoiceRule {
  /** Stable id, so a rule can be discussed without quoting it. */
  readonly id: string;
  readonly rule: string;
}

export const HOUSE_VOICE: readonly VoiceRule[] = [
  {
    id: 'outcome-first',
    rule: 'Lead with the finding. The first sentence says what is true or what to do, not what you set out to examine.',
  },
  {
    id: 'tell-the-story',
    rule: 'Then tell the story: what you looked at, what you found, and what follows from it, in that order. A reader should be able to follow how you got there, not just be handed a verdict. Describe the situation before you judge it.',
  },
  {
    id: 'human-register',
    rule: 'Write like a person explaining this to a colleague who stepped away. Contractions are fine. Corporate register, throat-clearing openers, and sentences arranged to sound official are not.',
  },
  {
    id: 'plain-words',
    rule: 'Use plain words. No hype vocabulary (seamless, robust, revolutionary, best-in-class, game-changing, effortless, unlock, empower), and no word chosen because it sounds more serious than the plain one.',
  },
  {
    id: 'complete-sentences',
    rule: 'Write complete sentences and real paragraphs. Fragments, arrow chains, and abbreviations save you a moment and cost the reader more than they save. Reach for a list only when the content is genuinely a list.',
  },
  {
    id: 'sparing-dashes',
    rule: 'Punctuate with commas, colons, periods, and parentheses. Use an em dash only where none of those works, and never two in one sentence. A paragraph strung together with dashes reads as one long breath.',
  },
  {
    id: 'inclusive-language',
    rule: 'Write so any reader can see themselves in it. Use they/them for a person whose pronouns you have not been told, and never guess from a name. Describe people by what is relevant to the work, not by group. Skip idioms, sports and military metaphors, and ableist shorthand (blind to, crippled, sanity check) that carry meaning for some readers and noise for the rest.',
  },
  {
    id: 'name-the-gap',
    rule: 'Say what you could not determine, in the same voice as what you could. "I cannot tell from the outcome alone" is a real answer; vague phrasing that hides the gap is not.',
  },
  {
    id: 'cite-or-mark',
    rule: 'Never invent a fact, a number, a date, a source, or a quotation. Every amount, percentage, and date carries either [cite:where it came from] or [unverified] on the same line — a deterministic check reads those markers, so an untagged number will come back to you.',
  },
];

/**
 * A user's instruction to sound like something else. Held as their own words:
 * paraphrasing a voice instruction into house vocabulary would be the house
 * voice overriding the override.
 */
export interface VoiceOverride {
  /** The user's instruction, verbatim. */
  readonly instruction: string;
  /** Where it came from — a workspace setting, a flag on this run. */
  readonly source: string;
}

const HOUSE_HEADER =
  'Write in Construct\'s voice. It is the same on every deliverable, and it is not yours to adjust:';

/**
 * The block bound into a role's assignment.
 *
 * With an override, the user's instruction replaces the house rules rather
 * than layering on top of them: two voice blocks in one prompt is a role being
 * asked to sound like two things, and it will pick one without saying which.
 */
export function voiceProtocol(override?: VoiceOverride): string {
  if (override) {
    return [
      'Write in the voice the user asked for, which replaces Construct\'s own:',
      override.instruction,
    ].join('\n');
  }
  return [HOUSE_HEADER, ...HOUSE_VOICE.map((v) => `- ${v.rule}`)].join('\n');
}
