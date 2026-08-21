/**
 * kernel/voice/voice.ts — how Construct sounds, and who it says wrote the
 * work, defined once.
 *
 * Commitment 17: deliverables sound like Construct — plain, direct, no hype
 * vocabulary; the register STRATEGY.md is written in — unless the user
 * overrides it, and the override is recorded.
 *
 * The seam is three things that have to agree, which is why they live in one
 * module: the identity a dispatch is given (constructIdentity), the voice it
 * is written in (voiceProtocol), and the shape the content takes
 * (contentShapeProtocol). Framing — a concern, a lens, a rubric line — is
 * internal and becomes attribution on the deliverable; it never becomes a
 * voice of its own.
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

const OVERRIDE_HEADER = 'Write in the voice the user asked for, which replaces Construct\'s own:';

/**
 * The block bound into a role's assignment.
 *
 * With an override, the user's instruction replaces the house rules rather
 * than layering on top of them: two voice blocks in one prompt is a role being
 * asked to sound like two things, and it will pick one without saying which.
 */
export function voiceProtocol(override?: VoiceOverride): string {
  if (override) {
    return [OVERRIDE_HEADER, override.instruction].join('\n');
  }
  return [HOUSE_HEADER, ...HOUSE_VOICE.map((v) => `- ${v.rule}`)].join('\n');
}

/**
 * Whether a prompt already carries a voice binding.
 *
 * The question a caller actually has is not "does this text mention
 * Construct" but "has the voice already been bound into it", and the two
 * headers above are the only ways it ever is. Asked so that a task built by
 * the coordinator, which arrives at a host already framed, is not framed a
 * second time on the way in.
 */
export function carriesVoice(task: string): boolean {
  return task.includes(HOUSE_HEADER) || task.includes(OVERRIDE_HEADER);
}

/**
 * WHO FRAMED THE WORK, AND WHO WROTE IT.
 *
 * A concern, a lens, and a rubric line are all framing: they decide what gets
 * examined, what the work owes, and what the record says the deliverable
 * answers. None of them is an author. Construct writes, in one voice, and the
 * framing is exposed on the deliverable as attribution: who framed this, in
 * whose name.
 *
 * Before this existed, a dispatch said both things and left the model to pick:
 * "you are acting as the privacy role", and then, further down, the house
 * voice. Two identity instructions in one prompt is the same defect as two
 * voice blocks, and it fails the same way — quietly, by the model choosing one
 * and never saying which. So they are one instruction here, and there is
 * exactly one place that writes it.
 */
export interface Attribution {
  /** The concern, lens, or role that framed this work. Absent when nothing narrower than Construct did. */
  readonly framedBy?: string;
  /** What that framing asks for, in the catalog's own words. */
  readonly concern?: string;
  /** The user's instruction to sound like something else, when one is in force. */
  readonly voice?: VoiceOverride;
}

/**
 * The single identity instruction: who is writing, what framed the work, and
 * the voice it is written in, as one statement rather than two.
 */
export function constructIdentity(attribution: Attribution = {}): string {
  const framing =
    attribution.framedBy === undefined
      ? 'Everything you write here is published in Construct\'s name.'
      : `This work is framed by the ${attribution.framedBy} role.` +
        (attribution.concern === undefined ? '' : ` Your concern: ${attribution.concern}.`) +
        ' That framing decides what you examine and what you owe, and it is what a reader is ' +
        'told about the result: which concern framed it, and that Construct wrote it. It is not ' +
        'a second identity and it carries no register of its own.';
  return (
    `You are Construct. ${framing} Construct has one voice, and it is this one:\n\n` +
    voiceProtocol(attribution.voice)
  );
}

/**
 * The identity a host adapter binds onto a task before dispatching it.
 *
 * Every adapter used to hand-roll this, and each one wrote a bare "you are
 * acting as: <role>" that the voice never travelled with — so a prompt built
 * by the coordinator arrived carrying its identity twice, and a prompt built
 * anywhere else arrived carrying none. Both are one call now: a task already
 * bound to the voice is passed through untouched, and anything else is framed
 * before it leaves.
 */
export function frameHostTask(request: {
  readonly role: string;
  readonly task: string;
  readonly voice?: VoiceOverride;
}): string {
  if (carriesVoice(request.task)) return request.task;
  return `${constructIdentity({ framedBy: request.role, voice: request.voice })}\n\n${request.task}`;
}

/**
 * The attribution a composed document carries at the top: who framed it, in
 * whose name.
 *
 * The internal half of this seam tells a role that its framing is not an
 * authorship; this is the half a reader sees, and the two have to say the same
 * thing or the document quietly claims several authors. Names arrive in the
 * form the surface wants them — rendered for a reader, raw ids for the record
 * — because which form is right is the caller's question, not this one's.
 */
export function attributionLine(framedBy: readonly string[]): string {
  if (framedBy.length === 0) return '*Written by Construct, in one voice.*';
  const concerns = framedBy.length === 1 ? 'concern' : 'concerns';
  return (
    `*Framed by the ${joinNames(framedBy)} ${concerns}. Written by Construct in one voice, ` +
    'and every claim below names the concern it came from.*'
  );
}

/** A list of names as a sentence reads it, rather than as a comma-joined array. */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/**
 * WHAT SHAPE THE CONTENT TAKES, which is not the same question as what voice
 * it is in.
 *
 * One directive used to demand numbered issues of every deliverable it
 * dispatched, including the ones whose own template asks for something else: a
 * PRD got told to number its issues, and so did a strategy review and a
 * sequencing plan. The template already knew what shape it wanted; the
 * directive simply talked over it. So form is declared by the template
 * (plan/schema.ts) and spoken here, and the rules every work product owes —
 * an owner for a step, a labeled assumption instead of a stall, nothing
 * asserted that cannot be supported — are the same whatever the form is.
 */
export const CONTENT_FORMS = ['issues', 'requirements', 'sequence', 'questions', 'prose'] as const;

export type ContentForm = (typeof CONTENT_FORMS)[number];

const FORM_RULES: Readonly<Record<ContentForm, string>> = {
  issues:
    '- Number every issue. Each issue states the problem in one sentence, then the concrete ' +
    'step that resolves it, then who takes that step.',
  requirements:
    '- Number every requirement. Each one says what the solution must do, in a sentence a ' +
    'reader could check, with the criterion that says it is met. A requirement with a question ' +
    'inside it is an open question, and belongs in that section instead.',
  sequence:
    '- Number the steps in the order they happen. Each step says what happens, what must be ' +
    'true before the next one starts, and who does it. Steps with no stated dependency between ' +
    'them are a list, and a reader will run them in any order.',
  questions:
    '- Number every question. Each one says what an answer to it would settle, and what a ' +
    'different answer would change. A question that settles nothing when answered is a topic, ' +
    'and it comes out.',
  prose:
    '- Write it as prose under the sections above: what you found, what supports it, and what ' +
    'follows from it. Number something only where the count or the order is the point, because ' +
    'a list imposed on connected reasoning hands the reader fragments to reassemble.',
};

/**
 * The rules for a work product of a given form. An unrecognized form gets
 * prose, which is the shape that assumes least about the content.
 */
export function contentShapeProtocol(form: ContentForm | undefined): string {
  return [
    'Rules for the work product:',
    FORM_RULES[form ?? 'prose'] ?? FORM_RULES.prose,
    // A resolving step with nobody attached is a step nobody takes. Naming a
    // role, a team, or a named person all count; what does not count is
    // leaving it out, so the honest answer when the material does not say gets
    // its own marker rather than silence.
    '- Every step you recommend names an owner — a role, a team, or a person. If the material ' +
      'does not say who owns it, write [unowned] and say who would have to decide.',
    '- Missing information is never the deliverable. If something cannot be determined from the ' +
      'outcome, state the assumption you proceed on, label it [assumed], and deliver the work ' +
      'that assumption allows.',
    '- Do not assert anything you cannot support.',
    '- Keep it as short as it can be while the reader can still follow how you got there.',
  ].join('\n');
}
