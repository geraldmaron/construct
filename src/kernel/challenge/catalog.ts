/**
 * kernel/challenge/catalog.ts — the challenges a brief may name, and the ones
 * a machine can check for free.
 *
 * Commitment 13: adversarial challenge is an obligation, not a courtesy. A brief
 * names the challenges its deliverable must satisfy before promoting past
 * draft, deterministic structural checks run always and free, and a
 * second-role substantive pass runs only where the brief's heat warrants it.
 *
 * The half that existed before this module: briefs could declare challenges,
 * and promotion derived its state from recorded verdicts. Nothing ran. A brief
 * could require `pre-mortem` and the requirement was satisfied by nobody
 * noticing, which is worse than not declaring it, because the declaration
 * reads as a control.
 *
 * WHAT A STRUCTURAL CHECK IS, AND IS NOT. It answers "was this work done and
 * shown", never "is the argument any good". A checker can see that a
 * deliverable states its strongest objection under a label; it cannot tell
 * whether the objection is the strongest one, or even a real one. That
 * judgement is the substantive pass, it costs a model call, and pretending a
 * free check delivers it would be the fabricated assurance this project exists
 * not to make. So a structural pass is reported for exactly what it is, and a
 * challenge with no structural checker is never recorded as passed — it stays
 * unanswered until something that can judge it answers.
 *
 * WHERE THE INDEPENDENCE OF A SUBSTANTIVE PASS COMES FROM. Not from the second
 * role. A different role over the same model produces correlated output — that
 * is measured here and in the external record, and it is why per-role depth was
 * retired. What a second role buys is attribution (a name on the verdict) and
 * the structural guarantee that the author does not grade itself, which is real
 * and is why the rule below stands. What it does NOT buy is an independent
 * opinion. Independence is bought with a second model FAMILY, dispatched
 * through the host adapter seam, and that is where any challenge or judge pass
 * that is load-bearing should spend.
 *
 * Stated as a limit rather than left implied: only one family is tuned today
 * (`hosts/tuning.ts`), so a cross-family substantive pass cannot be run yet.
 * Until a second family passes its eval gate, a substantive verdict carries the
 * independence its author's family can give it and no more, and no surface
 * describes it as independent review.
 *
 * The checks are deliberately generous about form and strict about presence.
 * Models write "## Strongest objection", "**The strongest objection:**", and
 * "Strongest counter-argument -" for the same instruction, and a checker that
 * demanded one spelling would fail honest work while teaching everyone to
 * format for the checker rather than to think.
 */

import {
  findUntaggedClaims,
  findSourceFileCitations,
  findScaffoldingCitations,
  selfAttestsCiting,
} from '../verify/claims.ts';
import { RUBRIC_LINES, rubricChallengeId } from './readers.ts';
import { handbacksEarned } from './answerable.ts';
import type { Brief } from '../brief/schema.ts';

export interface ChallengeCheck {
  /** True when the deliverable shows the work this challenge asks for. */
  readonly passed: boolean;
  /** What was looked for and what was found, for the record and the role. */
  readonly detail: string;
}

/**
 * Facts about the dispatch a check may need beyond the deliverable and brief.
 * Ground roots are the one so far: a grounded run's citations are judged
 * against what the run was actually licensed to read.
 */
export interface ChallengeContext {
  readonly groundRoots?: readonly string[];
}

/**
 * What a challenge can meaningfully be asked of.
 *
 * `sourcing` asks whether the text is grounded — is the claim cited, was the
 * document it names ever opened. That question means the same thing in a memo
 * and in a two-sentence answer, because an assertion nobody sourced is
 * unsourced at any length.
 *
 * `deliverable` asks whether a document has a part it owes: a scope diff, a
 * pre-mortem, a named owner. Asking it of anything shorter grades the form
 * instead of the work. One run discarded four closing answers for having no
 * labelled pre-mortem and then reported the questions as unanswered — the run
 * held the answers and printed the gap.
 *
 * The distinction sits on the challenge because a second copy of it kept by
 * each caller is the drift this project already catches elsewhere: a challenge
 * added here declares its own subject, and nothing has to remember to update a
 * list somewhere else.
 */
export type ChallengeSubject = 'sourcing' | 'deliverable';

export interface Challenge {
  readonly id: string;
  /** What the challenge asks of the deliverable, in one sentence. */
  readonly question: string;
  /** What this can be asked of. See ChallengeSubject. */
  readonly subject: ChallengeSubject;
  /**
   * A free, deterministic check for the presence of the work, or null when
   * only a substantive pass can answer this challenge.
   */
  readonly structural:
    | ((deliverable: string, brief: Brief, context?: ChallengeContext) => ChallengeCheck)
    | null;
}

/**
 * Any of these labels, however the model decorated them, counts as present.
 * Hyphens flatten to spaces because the templates themselves dictate
 * hyphenated headings ("out-of-scope"): a checker that failed the exact
 * heading the assignment asked for would be grading its own instructions.
 * Labels are written in the flattened form.
 */
function labelled(text: string, labels: readonly string[]): boolean {
  const flattened = text.toLowerCase().replace(/[*_`#>-]/g, ' ').replace(/\s+/g, ' ');
  return labels.some((label) => flattened.includes(label));
}

function found(passed: boolean, looked: string, detail: string): ChallengeCheck {
  return { passed, detail: passed ? `${looked}: ${detail}` : `${looked}: not found` };
}

const ASKED_FOR =
  /\bbrief\s+(?:asked|called)\s+for\s+([^.\n]{3,120})|\bwas\s+asked\s+(?:for|to\s+(?:produce|deliver|provide))\s+([^.\n]{3,120})/gi;

const SCOPE_STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'for', 'of', 'to', 'in', 'on', 'with', 'this', 'that',
  'full', 'complete', 'comprehensive', 'detailed', 'plan', 'review', 'memo',
]);

/**
 * Assertions about what the brief asked for whose content words appear
 * nowhere in the recorded outcome. Conservative on purpose: a claim is
 * flagged only when NONE of its significant words occur in the outcome, so a
 * paraphrase survives and only a premise with no anchor in the record fails.
 */
function inventedBriefClaims(deliverable: string, outcome: string): string[] {
  const record = new Set(
    outcome
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
  const invented: string[] = [];
  for (const match of deliverable.matchAll(ASKED_FOR)) {
    const claimed = (match[1] ?? match[2] ?? '').trim();
    const words = claimed
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !SCOPE_STOPWORDS.has(t));
    if (words.length > 0 && !words.some((w) => record.has(w))) invented.push(claimed);
  }
  return invented;
}

/**
 * A repository-relative path as a role writes one in prose: at least one
 * directory separator and a file extension. Deliberately not an absolute-path
 * matcher — roles cite the ground the way the survey lists it, relative, and a
 * matcher demanding the root prefix would see none of the real ones.
 */
const NAMED_PATH = /\b((?:[\w.@-]+\/)+[\w.@-]+\.[a-z]{1,5})\b/gi;

/** Whether a path appears inside a citation marker anywhere in the text. */
function citedAnywhere(text: string, path: string): boolean {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\[(?:cite|research):[^\\]]*${escaped}`, 'i').test(text);
}

/**
 * Whether the line saying a path went unread also says why it could not be
 * read. The disclosure is what makes an unread path acceptable, so the check
 * is for the disclosure — the same shape research.ts's aggregator rule takes,
 * and for the same reason: a reader cannot tell "I could not open it" from "I
 * did not bother" from the text alone.
 */
const COULD_NOT_READ =
  /could not (?:be )?(?:read|open|access|retrieve)|unable to (?:read|open|access)|not reachable|no access|outside (?:the |my )?(?:declared |licensed )?(?:root|ground)|access denied|permission denied|binary|no such file/i;

/** Whether the deliverable cites anything at all, by any marker. */
function citesAnything(deliverable: string): boolean {
  return /\[(?:cite|research):/i.test(deliverable);
}

/**
 * Paths a deliverable names but never cites, with no stated reason it could
 * not be read.
 *
 * Conservative in both directions. A path cited once anywhere counts as read
 * everywhere, because a role that opened a file and then discussed it in
 * uncited prose has done the work this checks for. And a path whose line says
 * it was unreachable passes, because the rule is that the reader is told, not
 * that every file yields.
 */
function namedButUnread(deliverable: string): string[] {
  const unread = new Set<string>();
  for (const line of deliverable.split('\n')) {
    for (const match of line.matchAll(NAMED_PATH)) {
      const path = match[1];
      if (citedAnywhere(deliverable, path)) continue;
      if (COULD_NOT_READ.test(line)) continue;
      unread.add(path);
    }
  }
  return [...unread];
}

export const CHALLENGES: readonly Challenge[] = [
  {
    id: 'strongest-objection',
    subject: 'deliverable',
    question: 'What is the strongest argument against this, stated in its own words?',
    structural: (deliverable) =>
      found(
        labelled(deliverable, [
          'strongest objection',
          'strongest argument against',
          'strongest counter',
          'best argument against',
          'the case against',
        ]),
        'a labelled strongest objection',
        'present — whether it is genuinely the strongest is a substantive question this check cannot answer',
      ),
  },
  {
    id: 'pre-mortem',
    subject: 'deliverable',
    question: 'Assume this failed. What is the most likely story of how?',
    structural: (deliverable) =>
      found(
        labelled(deliverable, ['pre mortem', 'premortem', 'assume this failed', 'how this fails']),
        'a labelled pre-mortem',
        'present — the plausibility of the failure story is a substantive question',
      ),
  },
  {
    id: 'claims-cited',
    subject: 'sourcing',
    question: 'Does every load-bearing claim carry a citation or an [unverified] tag?',
    // The one challenge a machine can answer completely, and it already had an
    // implementation before this catalog existed. Reused rather than rewritten:
    // a second matcher for the same job is the drift commitment 16 exists to
    // catch, and two of them would disagree eventually.
    structural: (deliverable, _brief, context) => {
      // A citation that points at code fails here rather than in a challenge of
      // its own, because from the reader's side it is the same failure: the
      // claim is not sourced. Checked first — a deliverable that cites the
      // tool's insides has a worse problem than one that cites nothing. A
      // grounded dispatch is the exception: code under a declared root is the
      // user's own ground, and citing it is the discipline, not the defect.
      const misplaced = findSourceFileCitations(deliverable, context?.groundRoots ?? []);
      if (misplaced.length > 0) {
        const shown = misplaced.slice(0, 3).map((c) => `line ${String(c.line)}`).join(', ');
        return {
          passed: false,
          detail:
            `${String(misplaced.length)} citation(s) point at a source file rather than a source: ` +
            `${shown}. Code in the working directory is not evidence about this domain.`,
        };
      }
      // Same failure family, third observed shape: a citation naming the
      // tool's own scaffolding ("[domain catalog]") as the authority for
      // facts it does not contain. Invented provenance is worse than none.
      const internal = findScaffoldingCitations(deliverable);
      if (internal.length > 0) {
        const shown = internal.slice(0, 3).map((c) => `line ${String(c.line)}`).join(', ');
        return {
          passed: false,
          detail:
            `${String(internal.length)} citation(s) name Construct's own scaffolding as their source: ` +
            `${shown}. The catalog, lenses, and playbook are not evidence about the world — ` +
            'mark the claim [unverified] instead.',
        };
      }
      const untagged = findUntaggedClaims(deliverable);
      if (untagged.length === 0) {
        // A sentence about citing is not citing. A body that attests the
        // discipline while using no marker anywhere fails on the attestation:
        // the checker holds the practice, not the prose about the practice.
        if (selfAttestsCiting(deliverable)) {
          return {
            passed: false,
            detail:
              'the deliverable asserts its claims are cited, but no [cite:...] or ' +
              '[unverified] marker appears anywhere in the body — compliance prose is not compliance',
          };
        }
        return { passed: true, detail: 'every amount, percentage, date, duration, and statute reference carries a citation or an [unverified] tag' };
      }
      const shown = untagged.slice(0, 3).map((c) => `line ${String(c.line)}`).join(', ');
      const more = untagged.length > 3 ? ` (and ${String(untagged.length - 3)} more)` : '';
      return {
        passed: false,
        detail: `${String(untagged.length)} claim(s) carry neither a citation nor an [unverified] tag: ${shown}${more}`,
      };
    },
  },
  {
    id: 'scope-diff',
    subject: 'deliverable',
    question: 'What did the brief ask for that this deliverable does not cover?',
    structural: (deliverable, brief) => {
      // The fidelity section is held to the record it claims fidelity to: a
      // sentence asserting what "the brief asked for" whose content words
      // appear nowhere in the recorded outcome is a fabricated premise, and a
      // scope diff against an invented brief covers nothing.
      const invented = inventedBriefClaims(deliverable, brief.outcome);
      if (invented.length > 0) {
        return {
          passed: false,
          detail:
            `the scope diff asserts the brief asked for something the recorded outcome ` +
            `does not contain: "${invented[0]}"` +
            (invented.length > 1 ? ` (and ${String(invented.length - 1)} more)` : ''),
        };
      }
      return found(
        labelled(deliverable, [
          'out of scope',
          'not covered',
          'scope diff',
          'did not cover',
          'could not determine',
          'cannot determine',
        ]),
        'a stated gap between the brief and the deliverable',
        'present — a deliverable that names nothing it left uncovered is claiming complete coverage',
      );
    },
  },
  {
    id: 'ground-exhausted',
    subject: 'sourcing',
    question: 'Was every document you could name and reach actually read before anything was called unknown?',
    structural: (deliverable, _brief, context) => {
      // Only askable of a dispatch that was licensed to read past its survey.
      // Without roots the role had the listed documents and nothing else, and
      // a path it names is a path it was never able to open.
      if (!context?.groundRoots || context.groundRoots.length === 0) {
        return {
          passed: true,
          detail: 'no declared roots on this dispatch — there was nothing further this role was licensed to read',
        };
      }
      const unread = namedButUnread(deliverable);
      if (unread.length === 0) {
        return {
          passed: true,
          detail:
            'every document named is cited or carries the reason it could not be read — whether the ' +
            'reading was thorough is a substantive question this check cannot answer',
        };
      }
      const shown = unread.slice(0, 3).join(', ');
      const more = unread.length > 3 ? ` (and ${String(unread.length - 3)} more)` : '';
      // Two different failures wear the same shape, and only one of them
      // justifies the strong sentence. A deliverable that cites elsewhere and
      // not here has a reading gap: it shows what it does when it opens a file,
      // and it did not do that for these. A deliverable that cites nothing at
      // all shows nothing either way — one role wrote that it had opened every
      // document a question needed and was told, in the same breath, that it
      // had left fourteen pieces of work undone. The check still fails, because
      // the reader cannot tell in either case; what changes is that it stops
      // asserting the thing it cannot know.
      if (!citesAnything(deliverable)) {
        return {
          passed: false,
          detail:
            `${String(unread.length)} document(s) are named and the deliverable carries no ` +
            `citation marker anywhere: ${shown}${more}. Which of them you actually opened cannot ` +
            'be told from the text, including by a reader who wants to check one — cite each ' +
            'document you read, at the claim it supports.',
        };
      }
      return {
        passed: false,
        detail:
          `${String(unread.length)} document(s) are named but never cited and carry no reason they ` +
          `could not be read, in a deliverable that cites elsewhere: ${shown}${more}. A path this ` +
          'role could name inside a root it was licensed to read is work it could have done.',
      };
    },
  },
  {
    id: 'handback-earned',
    subject: 'sourcing',
    question:
      'Is every question handed back one this role could not have answered from the ground it holds?',
    // The question-shaped half of ground exhaustion. Its sibling above fires on
    // a file path named and never opened; this one fires on a question that
    // names a symbol, a table, or the code itself as where the answer lives.
    // Both say the same thing: work the role located and did not do is not an
    // open question, because the reader it goes to holds the same license and
    // less context.
    structural: (deliverable, _brief, context) =>
      handbacksEarned(deliverable, context?.groundRoots),
  },
  {
    id: 'legal-issue-spot',
    subject: 'deliverable',
    question: 'Has a legal issue-spotting pass read this deliverable?',
    // No structural form exists. Whether a legal issue was spotted is exactly
    // the judgement a check cannot make, and a presence test here would let a
    // deliverable promote because it contained the word "legal".
    structural: null,
  },
];

/**
 * The challenges every spine-produced brief declares.
 *
 * Commitment 13 scopes most of its challenges to a condition — a strongest
 * objection "on load-bearing decisions", a pre-mortem "on plans", a legal
 * issue-spot "on heat-flagged deliverables" — and leaves unconditional the ones
 * every deliverable owes whatever it is: a citation or `[unverified]` tag on
 * *every* claim, a scope diff against the brief, and no document named as the
 * answer to a question nobody went and read. All three are answerable for free,
 * so declaring them on every run spends nothing and holds a deliverable at
 * draft when it asserts facts it did not source or leaves work it could have
 * done. The third is self-limiting rather than conditional: a dispatch with no
 * declared roots had nothing further to read, and it passes saying so.
 *
 * The conditional three are deliberately absent rather than forgotten. Nothing
 * in the spine yet decides whether an outcome is a decision, a plan, or hot
 * enough to be worth a second role's model call, and declaring them on
 * everything would either burn a call per deliverable or leave a permanently
 * unanswered challenge that never promotes. When a heat signal exists, it
 * chooses; until then the honest state is that these are not required.
 */
export const SPINE_CHALLENGES: readonly string[] = [
  'claims-cited',
  'scope-diff',
  'ground-exhausted',
  'handback-earned',
];

/**
 * The reader's own acceptance lines, as challenges.
 *
 * Derived rather than hand-listed so the rubric stays the source: a line that
 * gains a structural form in readers.ts becomes a challenge here without
 * anyone remembering to add it, and a line that loses one stops being a gate
 * the same way. Only must-lines with a structural form appear — a should-line
 * grades as accept-with-corrections in the rubric, and gating on one would
 * enforce a standard stricter than the document it comes from.
 */
const RUBRIC_CHALLENGES: readonly Challenge[] = RUBRIC_LINES.filter(
  (line) => line.weight === 'must' && line.enforcement.kind === 'structural',
).map((line) => ({
  id: rubricChallengeId(line),
  question: line.requires,
  // Every reader line asks a document for a part of itself — a named owner, a
  // stated measure, a rollback. There is no reader whose acceptance turns on a
  // supplementary paragraph carrying one.
  subject: 'deliverable' as const,
  structural: (deliverable: string) =>
    (line.enforcement as { check: (text: string) => ChallengeCheck }).check(deliverable),
}));

const BY_ID = new Map(
  [...CHALLENGES, ...RUBRIC_CHALLENGES].map((challenge) => [challenge.id, challenge]),
);

export function challengeById(id: string): Challenge | undefined {
  return BY_ID.get(id);
}

export interface StructuralResult {
  readonly challenge: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface UnansweredChallenge {
  readonly challenge: string;
  /** Why nothing was recorded: no structural form, or no such challenge. */
  readonly reason: string;
}

export interface StructuralRun {
  readonly results: readonly StructuralResult[];
  /** Declared challenges nothing here could answer. Never treated as passed. */
  readonly unanswered: readonly UnansweredChallenge[];
}

/**
 * Run every structural check the brief declared, over one deliverable.
 *
 * A challenge the brief did not declare is not run: commitment 10 puts the
 * declaration on the brief, and a dispatcher that ran checks nobody asked for
 * would be deciding the obligation itself.
 */
export function runStructuralChallenges(
  brief: Brief,
  deliverable: string,
  context?: ChallengeContext,
): StructuralRun {
  const results: StructuralResult[] = [];
  const unanswered: UnansweredChallenge[] = [];

  for (const id of brief.challenges ?? []) {
    const challenge = challengeById(id);
    if (!challenge) {
      unanswered.push({
        challenge: id,
        reason: `no challenge named "${id}" — it stays unanswered rather than passing by default`,
      });
      continue;
    }
    if (!challenge.structural) {
      unanswered.push({
        challenge: id,
        reason: 'no free structural form: this one needs a substantive pass to answer',
      });
      continue;
    }
    const check = challenge.structural(deliverable, brief, context);
    results.push({ challenge: id, passed: check.passed, detail: check.detail });
  }

  return { results, unanswered };
}
