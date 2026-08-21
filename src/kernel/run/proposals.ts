/**
 * kernel/run/proposals.ts — a finished deliverable's findings, read as changes
 * somebody might want made outside this system.
 *
 * A role hands in a document with numbered issues in it and a section saying
 * what follows from them. Until something reads that document, acting on it
 * means a person retyping every item into whatever tracker the work actually
 * lives in — and retyping is where the citation goes missing, because the
 * sentence arrives in the tracker with nobody able to say which finding it
 * came from.
 *
 * So the findings become write proposals, and the proposal machinery already
 * in the store decides their fate. Four rules make that safe:
 *
 *   1. NOTHING IS WRITTEN OUTWARD HERE, AND NOTHING CAN BE. This module
 *      produces rows to be decided on. A proposal applies only through a
 *      recorded decision, which is a different surface entirely; extraction
 *      grants no authority and reaches nothing.
 *   2. EVERY PROPOSAL CITES THE FINDING IT CAME FROM. The citation is
 *      `deliverable:<task>#L<n>`, the same shape a note citation has, and it
 *      must resolve to a line of that exact deliverable containing that exact
 *      finding. A proposal whose citation does not resolve is refused rather
 *      than filed — a change to somebody's tracker that cannot point at the
 *      words behind it is the fabricated provenance the gates exist for.
 *   3. THE TIER FOLLOWS THE ACTION, NOT THE CONFIDENCE. Commenting and
 *      labelling are reversible by anyone who reads them, so they are low.
 *      Creating and updating are not, so they are high, and high never applies
 *      on standing consent. The action is read from the finding's own verb by
 *      deterministic matching — the same instrument the shape chooser uses,
 *      with the same limits.
 *   4. THE DEFAULT IS THE SMALLEST ACTION. A finding whose words do not ask
 *      for a change becomes a comment recording it, never a change guessed at
 *      from a report. Guessing the other way would let a paragraph of analysis
 *      turn into an edit nobody asked for, which is the failure worth being
 *      unable to have.
 *
 * The reading is mechanical: no model runs here, so an extraction costs
 * nothing and can be re-run. Ids are derived from the deliverable and the line,
 * so a second extraction of the same document proposes the same ids and the
 * store's own uniqueness is what keeps the queue from doubling.
 */

/** What a proposal would do to the source it names. */
export const WRITE_ACTIONS = ['comment', 'label', 'create', 'update'] as const;

export type WriteAction = (typeof WRITE_ACTIONS)[number];

/**
 * The tier for an action. Commenting and labelling annotate; a reader of the
 * target sees them as annotation and can undo them. Creating and updating
 * change what the target says, which is the class no standing consent covers.
 */
export function riskOfAction(action: WriteAction): 'low' | 'high' {
  return action === 'comment' || action === 'label' ? 'low' : 'high';
}

/** Where in the deliverable a finding was written. */
export type FindingKind = 'numbered-issue' | 'what-follows';

export interface Finding {
  readonly kind: FindingKind;
  /** The finding's own words, exactly as the deliverable states them. */
  readonly text: string;
  /** 1-based line of the deliverable this was read from. */
  readonly line: number;
  /** `deliverable:<task>#L<n>` — resolvable against the deliverable it came from. */
  readonly citation: string;
}

export interface Deliverable {
  /** The task whose deliverable this is; the citation names it. */
  readonly task: string;
  readonly role: string;
  readonly text: string;
}

const CITATION_PATTERN = /^deliverable:(.+)#L(\d+)$/;

/**
 * The line a citation names, or null when it names none. Kept beside the
 * finder rather than in a caller so that whatever files a proposal can check
 * the citation the same way a reader would: open the deliverable, go to the
 * line, read it.
 */
export function resolveFindingCitation(deliverable: Deliverable, citation: string): string | null {
  const match = CITATION_PATTERN.exec(citation.trim());
  if (!match) return null;
  if (match[1] !== deliverable.task) return null;
  const line = deliverable.text.split('\n')[Number(match[2]) - 1];
  return line === undefined ? null : line;
}

/**
 * A heading normalized for matching: punctuation and case are the author's,
 * the words are what identify the section. Both forms of the composed document
 * land here as "what follows" — the reader's heading and the stored slug.
 */
function normalizeHeading(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const NUMBERED = /^\s{0,3}(\d{1,3})[.)]\s+(.*\S)\s*$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*\S)\s*$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*\S)\s*$/;
const FENCE = /^\s{0,3}(```|~~~)/;

/**
 * Trailing attribution and citation furniture the composed document adds to a
 * bullet. The finding is the sentence; `[analyst]` at the end of it is who
 * said so, which the proposal records separately and should not repeat inside
 * the change itself.
 */
function stripFurniture(text: string): string {
  return text.replace(/\s*\[[^\]]*\]\s*$/, '').replace(/\s*—\s*\*[^*]*\*\s*$/, '').trim();
}

/**
 * The shortest a finding can be and still name something a person could act
 * on. "1. Introduction" and "2. Scope" are a document's furniture, not its
 * findings, and filing them as proposed changes would bury the real ones.
 */
const SHORTEST_FINDING = 20;

/**
 * Every numbered issue and what-follows item in one deliverable, in document
 * order.
 *
 * A numbered line inside a what-follows section is a what-follows item and is
 * read once, not twice: the section it sits in says what it is, and counting
 * it both ways would put the same sentence in the queue under two ids.
 * Fenced blocks are skipped whole — a numbered line inside a code sample is
 * sample text, and proposing a change out of it would propose the sample.
 */
export function findingsIn(deliverable: Deliverable): Finding[] {
  const findings: Finding[] = [];
  const lines = deliverable.text.split('\n');
  let inWhatFollows = false;
  let fenced = false;

  lines.forEach((raw, index) => {
    if (FENCE.test(raw)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;

    const heading = HEADING.exec(raw);
    if (heading) {
      inWhatFollows = normalizeHeading(heading[1]).includes('what follows');
      return;
    }

    const numbered = NUMBERED.exec(raw);
    const bullet = BULLET.exec(raw);
    const body = numbered ? numbered[2] : bullet ? bullet[1] : null;
    if (body === null) return;
    // A bullet outside a what-follows section is ordinary prose furniture —
    // evidence, a list of documents read, a caveat — and reading every bullet
    // in a document as a proposed change would file the document.
    if (bullet && !inWhatFollows) return;

    const text = stripFurniture(body);
    if (text.length < SHORTEST_FINDING) return;
    const line = index + 1;
    findings.push({
      kind: inWhatFollows ? 'what-follows' : 'numbered-issue',
      text,
      line,
      citation: `deliverable:${deliverable.task}#L${String(line)}`,
    });
  });

  return findings;
}

/**
 * The verbs that name each outward action, checked in this order.
 *
 * Narrow on purpose, and narrowest where the tier is highest: a phrase that
 * only might mean "change the ticket" is better read as a comment saying so,
 * because a comment costs a reader ten seconds and a wrong edit costs them
 * their record of what the ticket used to say. Matched against the finding's
 * opening words rather than anywhere in it — "we should not update the
 * schema" is a finding about updating, not an instruction to update.
 */
const ACTION_VERBS: ReadonlyArray<{ readonly action: WriteAction; readonly verbs: readonly string[] }> = [
  { action: 'label', verbs: ['label', 'tag', 'flag', 'mark', 'classify', 'categorise', 'categorize', 'triage'] },
  { action: 'create', verbs: ['create', 'add', 'file', 'open', 'raise', 'draft', 'write', 'introduce', 'schedule'] },
  {
    action: 'update',
    verbs: [
      'update', 'change', 'amend', 'revise', 'edit', 'correct', 'fix', 'rename',
      'move', 'remove', 'delete', 'close', 'reword', 'replace', 'split', 'merge',
      'reprioritise', 'reprioritize', 'reassign',
    ],
  },
];

/**
 * The first word of a finding, stripped of the openings a role writes in front
 * of an instruction. "We should file a ticket" and "file a ticket" ask for the
 * same thing.
 */
const HEDGES = new Set(['we', 'you', 'they', 'someone', 'somebody', 'please', 'should', 'must', 'need', 'needs', 'to', 'the', 'team']);

function leadingVerb(text: string): string {
  for (const word of text.toLowerCase().split(/[^a-z]+/)) {
    if (word === '') continue;
    if (HEDGES.has(word)) continue;
    return word;
  }
  return '';
}

/**
 * What this finding asks to be done. Falls to a comment by design: a finding
 * that reports something rather than asking for a change is recorded where the
 * work lives, and recording is the smallest true action.
 */
export function actionFor(text: string): WriteAction {
  const verb = leadingVerb(text);
  for (const { action, verbs } of ACTION_VERBS) {
    if (verbs.some((candidate) => verb === candidate || verb === `${candidate}d` || verb === `${candidate}s`)) {
      return action;
    }
  }
  return 'comment';
}

export interface ExtractedProposal {
  readonly id: string;
  readonly source: string;
  readonly change: string;
  /** The citation of the finding, with the finding's own words beside it. */
  readonly justification: string;
  readonly risk: 'low' | 'high';
  readonly action: WriteAction;
  readonly finding: Finding;
  readonly role: string;
}

export interface RefusedFinding {
  readonly text: string;
  readonly reason: string;
}

export interface ExtractionInput {
  readonly deliverable: Deliverable;
  /** The declared source a change would be made against. */
  readonly source: string;
  /**
   * How that source reads to a person — its locator. The row names the source
   * by id because that is what a decision resolves against; the change names
   * it the way the person deciding knows it.
   */
  readonly locator: string;
}

export interface Extraction {
  readonly proposals: readonly ExtractedProposal[];
  readonly refused: readonly RefusedFinding[];
}

/**
 * How the change reads in the queue: the action, the target, and the finding's
 * own sentence. Assembled rather than paraphrased — a person deciding on this
 * row must be reading what the role wrote, not a second reading of it that
 * nobody checked.
 */
function changeText(action: WriteAction, locator: string, finding: Finding): string {
  switch (action) {
    case 'comment':
      return `comment on ${locator}: ${finding.text}`;
    case 'label':
      return `label in ${locator}: ${finding.text}`;
    case 'create':
      return `create in ${locator}: ${finding.text}`;
    case 'update':
    default:
      return `update in ${locator}: ${finding.text}`;
  }
}

/**
 * One deliverable's findings as proposals against one source.
 *
 * Refusal, not omission, for anything that cannot be filed: a finding dropped
 * silently reads to the person holding the queue as a finding that was never
 * written, and the difference between "no proposal" and "one refused" is the
 * whole point of showing them the list.
 */
export function proposalsFrom(input: ExtractionInput): Extraction {
  const proposals: ExtractedProposal[] = [];
  const refused: RefusedFinding[] = [];
  const seen = new Set<string>();

  for (const finding of findingsIn(input.deliverable)) {
    const line = resolveFindingCitation(input.deliverable, finding.citation);
    if (line === null || !line.includes(finding.text)) {
      // Unreachable while this module writes its own citations, and checked
      // anyway: the rule is that a proposal's justification resolves, and a
      // rule enforced only where somebody remembered it is not a rule.
      refused.push({
        text: finding.text,
        reason: `its citation ${finding.citation} resolves to no line of that deliverable holding those words`,
      });
      continue;
    }
    const key = finding.text.toLowerCase();
    if (seen.has(key)) {
      refused.push({
        text: finding.text,
        reason: 'the same finding was already proposed from an earlier line of this deliverable',
      });
      continue;
    }
    seen.add(key);
    const action = actionFor(finding.text);
    proposals.push({
      id: `wp-${input.deliverable.task}-L${String(finding.line)}`,
      source: input.source,
      change: changeText(action, input.locator, finding),
      justification: `${finding.citation} (${input.deliverable.role}, ${finding.kind}): "${finding.text}"`,
      risk: riskOfAction(action),
      action,
      finding,
      role: input.deliverable.role,
    });
  }

  return { proposals, refused };
}
