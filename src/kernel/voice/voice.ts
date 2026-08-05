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
 * The rules are stated positively and kept few. A long list of prohibitions
 * reads as a style guide nobody finishes; these are the ones that decide
 * whether a reader believes the deliverable.
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
    id: 'plain-words',
    rule: 'Use plain words. No hype vocabulary — seamless, robust, revolutionary, best-in-class, game-changing, effortless, unlock, empower — and no word chosen because it sounds more serious than the plain one.',
  },
  {
    id: 'complete-sentences',
    rule: 'Write complete sentences. Fragments, arrow chains, and abbreviations save you time and cost the reader more than they save.',
  },
  {
    id: 'name-the-gap',
    rule: 'Say what you could not determine, in the same voice as what you could. "I cannot tell from the outcome alone" is a real answer; vague phrasing that hides the gap is not.',
  },
  {
    id: 'no-borrowed-certainty',
    rule: 'Claim only what you can support, and say what supports it. Confidence you did not earn reads as confidence about everything else you wrote.',
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
