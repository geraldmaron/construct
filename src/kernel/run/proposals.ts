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
 *
 * A change to a document is the same kind of proposal, composed rather than
 * read: its words are stated, not found in a deliverable, because no sentence
 * of a report is a redline. The four rules above hold unchanged — nothing is
 * written outward, the citation is carried, the tier follows the action, and
 * the smallest true statement of the change is the one recorded. What it adds
 * is the target: which document, and the words on each side of the change,
 * assembled into the change text a person approves so that approving needs no
 * second document open beside the queue.
 */

import { createHash } from 'node:crypto';
import type { DocEditKind } from '../store/sources.ts';

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
 * Whether this citation claims a line of a deliverable, and therefore has to
 * resolve to one before anything is filed on it. A citation of any other shape
 * — a note line, a source, a person — is grounding a reader checks themselves,
 * and refusing it here would only push people into writing the one shape this
 * module can check whether or not it is true.
 */
export function claimsDeliverable(citation: string): boolean {
  return CITATION_PATTERN.test(citation.trim());
}

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

/**
 * What a change to a document does to the source holding it: putting words
 * into a document that already exists is an update to what it says, and
 * writing a new one is a create.
 *
 * Both are high, and that is the answer rather than an oversight. A redline
 * cannot be undone by anyone reading the result — the words it struck are not
 * on the page to be put back. A new document destroys nothing, but a documents
 * source is exactly what this system reads back as organizational context, so
 * a workspace's standing yes to the low-risk class would let a run publish
 * prose into a documents system and a later run cite it as ground. Neither is
 * the annotation class, so neither rides standing consent.
 */
export function actionOfDocEdit(kind: DocEditKind): WriteAction {
  return kind === 'authored' ? 'create' : 'update';
}

export interface DocEditRequest {
  readonly kind: DocEditKind;
  /** The declared source the document lives in. */
  readonly source: string;
  /** How that source reads to the person deciding — its locator. */
  readonly locator: string;
  /** Which document, precisely: its path or identifier inside the source. */
  readonly document: string;
  /**
   * Redline: the exact words being replaced. Insertion: where the new words
   * go. Authored: empty.
   */
  readonly anchor: string;
  /** The words that would stand there, or the new document's body. */
  readonly proposed: string;
  /** What grounds the change: a finding citation, a note line, a source. */
  readonly citation: string;
}

export interface ProposedDocEdit {
  readonly id: string;
  readonly source: string;
  readonly change: string;
  readonly justification: string;
  readonly risk: 'low' | 'high';
  readonly action: WriteAction;
  readonly kind: DocEditKind;
  readonly document: string;
  readonly anchor: string;
  readonly proposed: string;
}

export type DocEditOutcome =
  | { readonly proposal: ProposedDocEdit; readonly refused?: undefined }
  | { readonly proposal?: undefined; readonly refused: string };

/**
 * The document part of an id, kept readable so the queue names what a row is
 * about before anyone opens it.
 */
function documentSlug(document: string): string {
  const slug = document
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'document' : slug;
}

/**
 * A proposed document change's id, derived from what it would change rather
 * than from when it was filed. Proposing the same change to the same document
 * twice therefore reaches the row already waiting instead of putting a second
 * copy of it in somebody's queue — the same property extraction gets from
 * deriving ids off the deliverable and the line.
 */
export function docEditId(request: DocEditRequest): string {
  const document = request.document.trim();
  // Separated by a character no document path, anchor or body can hold, so two
  // different changes cannot join into one string and come out sharing an id.
  const digest = createHash('sha256')
    .update(
      [request.source, request.kind, document, request.anchor, request.proposed].join('\u0000'),
    )
    .digest('hex')
    .slice(0, 12);
  return `wp-doc-${documentSlug(document)}-${digest}`;
}

/** The marker that separates the halves of a change from the words around them. */
const SIDE = '---';

/**
 * How the change reads in the queue: what it does, which document, and the
 * words on each side of it, one under the other. Long enough to approve from
 * and assembled rather than paraphrased, for the reason every other change
 * text here is — the person deciding must be reading the words that will be
 * written, not a second account of them that nobody checked.
 */
function docChangeText(request: DocEditRequest): string {
  switch (request.kind) {
    case 'redline':
      return [
        `redline ${request.document} in ${request.locator}`,
        `${SIDE} was`,
        request.anchor,
        `${SIDE} now`,
        request.proposed.trim() === ''
          ? '(struck: these words go, and nothing stands in their place)'
          : request.proposed,
      ].join('\n');
    case 'insertion':
      return [
        `insert into ${request.document} in ${request.locator}`,
        `${SIDE} at`,
        request.anchor,
        `${SIDE} add`,
        request.proposed,
      ].join('\n');
    case 'authored':
    default:
      return [
        `author ${request.document} into ${request.locator}`,
        `${SIDE} new document`,
        request.proposed,
      ].join('\n');
  }
}

/**
 * One stated change to a document as a proposal, or the reason it is not one.
 *
 * Refused rather than trimmed into something fileable: a change missing the
 * words it replaces, or the place it goes, or what grounds it, is a change
 * somebody would have to guess at, and a guess carried out in a documents
 * system is exactly the write nobody could take back.
 */
export function docEditProposal(request: DocEditRequest): DocEditOutcome {
  if (request.document.trim() === '') {
    return { refused: 'it names no document, so there is nothing precise to change' };
  }
  if (request.citation.trim() === '') {
    return { refused: "it cites nothing; a change to someone else's document says what grounds it" };
  }
  if (request.kind === 'redline' && request.anchor.trim() === '') {
    return {
      refused:
        'a redline says which words it replaces; without them nobody can see what the document ' +
        'stops saying',
    };
  }
  if (request.kind === 'insertion' && request.anchor.trim() === '') {
    return { refused: 'an insertion says where it goes, or the placement is left to whoever applies it' };
  }
  if (request.kind === 'authored' && request.anchor.trim() !== '') {
    return {
      refused: 'a new document replaces no words; a change that quotes what it replaces is a redline',
    };
  }
  if (request.kind !== 'redline' && request.proposed.trim() === '') {
    return {
      refused:
        request.kind === 'authored'
          ? 'it authors a document with no body'
          : 'an insertion that adds no words changes nothing',
    };
  }
  const action = actionOfDocEdit(request.kind);
  return {
    proposal: {
      id: docEditId(request),
      source: request.source,
      change: docChangeText(request),
      justification: request.citation.trim(),
      risk: riskOfAction(action),
      action,
      kind: request.kind,
      document: request.document.trim(),
      anchor: request.anchor,
      proposed: request.proposed,
    },
  };
}
