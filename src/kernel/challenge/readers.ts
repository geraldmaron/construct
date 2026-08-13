/**
 * kernel/challenge/readers.ts — the reader's standard, carried into the run.
 *
 * The acceptance rubric under docs/ says what a professional in each reading role
 * requires before they would call a Construct deliverable adequate. It was
 * committed before any deliverable was judged, deliberately, so it could not be
 * tuned to pass what it grades. Until this module it graded fixture-organization
 * fixture-organization runs and nothing else, which meant a real run could violate lines that
 * were already written down and agreed and still promote — and one did: a
 * strategy document that marked every recommendation `[unowned]`, which fails
 * three separate must-lines in a rubric the project had held for weeks.
 *
 * That is the failure this closes, and it is worth naming precisely because it
 * is not a mechanism failure. The document was well-built. Every claim was
 * cited, every refusal recorded, every gap named. It was well-built and
 * unusable, because the reader it was for cannot act on a recommendation with
 * nobody's name against it. Mechanism without the reader's standard produces
 * exactly that: a better-built document the reader still rejects.
 *
 * WHAT BINDS AND WHAT DOES NOT. Only the rubrics the document itself keys to a
 * concern — the sections written as `## Reader (concern)` — become challenges
 * on that concern's brief. The earlier reader-only sections (engineer,
 * product manager, legal, compliance, R&D leadership, and an operations block
 * predating the operations concern) name no concern, and mapping them to one
 * would be this module inventing a binding the rubric does not state. They stay
 * judgment material, recorded as such below rather than dropped, so the gap
 * between what is enforced and what is required is visible instead of implied.
 *
 * WHAT A STRUCTURAL FORM CAN CARRY. The same line catalog.ts draws: presence,
 * never quality. A checker can see that an owner is named; it cannot see whether
 * that person can actually decide. So only the must-lines with a distinctive
 * surface form are structural, and the rest are marked judgment — a matcher
 * built for a line that has no distinctive form would teach every role to
 * sprinkle the words it looks for, which destroys the line rather than enforcing
 * it. Should-lines are never gates: the rubric grades a failing should-line as
 * accept-with-corrections, and a check that held a deliverable at draft for one
 * would be enforcing a standard stricter than the document it comes from.
 */

import { slotSection } from '../plan/ladder.ts';
import type { ChallengeCheck } from './catalog.ts';

/** How a rubric line is enforced, or why it is not. */
export type Enforcement =
  | { readonly kind: 'structural'; readonly check: (deliverable: string) => ChallengeCheck }
  | { readonly kind: 'judgment'; readonly why: string };

export interface RubricLine {
  /** The concern whose brief this line binds to, as the rubric writes it. */
  readonly concern: string;
  /** The line id, exactly as the rubric numbers it. */
  readonly id: string;
  /** must-lines gate promotion; should-lines are corrections, never gates. */
  readonly weight: 'must' | 'should';
  /** What the reader requires, in one sentence. */
  readonly requires: string;
  readonly enforcement: Enforcement;
}

function found(passed: boolean, detail: string, missing: string): ChallengeCheck {
  return { passed, detail: passed ? detail : missing };
}

/**
 * Any of these labels, however decorated, counts as present.
 *
 * Shared with catalog.ts's rule rather than reasoned about again: models write
 * "## Rollback", "**Rollback:**" and "Rollback -" for one instruction, and a
 * checker that demanded one spelling would fail honest work while teaching
 * everyone to format for the checker.
 */
function labelled(text: string, labels: readonly string[]): boolean {
  const flattened = text.toLowerCase().replace(/[*_`#>-]/g, ' ').replace(/\s+/g, ' ');
  return labels.some((label) => flattened.includes(label));
}

/**
 * What an owner attribution looks like, and what is not one.
 *
 * The negative list is the substance of the check. Every entry is a real thing
 * a deliverable writes in the owner's place, and each reads as an answer while
 * leaving the reader exactly where they started: nobody to go to. The rubric
 * says so outright for one of them — "the team" is not an owner — and the rest
 * are the same move in different words.
 */
const OWNER_ATTRIBUTION =
  /\b(?:decision\s+)?owner\s*[:\-—]\s*([^\n]+)|\bowned by\s+([^\n.,;]+)|\bowner is\s+([^\n.,;]+)/gi;

/**
 * Placeholders that are the whole of what stands in the owner's place.
 */
const NOT_AN_OWNER_EXACT =
  /^(?:\[?(?:none|nobody|no one|tbd|tba|n\/a)\]?|unclear|engineering|whoever|someone)\.?$/i;

/**
 * The collective standing in for a person — the placeholder the rubric names by
 * name, since "'the team' is not an owner" is the line's own words.
 *
 * Matched as an opening rather than exactly, because in a slot whose heading
 * already asked the question the answer is written as a sentence: "The team
 * owns this call" is the same non-answer as "the team". The lookahead is what
 * keeps a narrowed collective — "the team lead", "the group architect" — a
 * name, since those point at one person the reader can go to.
 */
const COLLECTIVE_NOT_AN_OWNER =
  /^the (?:team|org|organisation|organization|group|business|company)\b(?!\s+(?:lead|leads|owner|manager|head|director|architect|chair|captain|liaison|principal|contact|representative|rep|engineer|sre)\b)/i;

/**
 * Openings that are a placeholder however the sentence continues.
 *
 * The distinction is the correction this catalog needed twice. A whole-value
 * test lets a placeholder escape by explaining itself, and the explanations are
 * honest, which is exactly why they are convincing: a real deliverable wrote
 * "Not named in the material as a single role or person for what capability to
 * fund next" in its decision-owner slot and the gate passed it. The sentence
 * says what kind of person would own this and leaves the reader with a search.
 * Whatever follows the placeholder explains it; it does not replace it.
 *
 * "named" opens the list because the slot's label already asked the owner
 * question — an attribution answering it gives a name, and one that starts by
 * restating the verb is prose about naming rather than a name.
 */
const NOT_AN_OWNER_OPENING =
  /^(?:\[?(?:unowned|unassigned|unknown|unnamed)\]?|not (?:yet )?(?:named|assigned|determined|identified|decided)|never (?:named|assigned)|no single|not stated|named|to be (?:decided|determined|named|assigned))\b/i;

/**
 * A denial of ownership, wherever it sits in the head.
 *
 * The openings above catch a slot that begins by refusing the question. The
 * first real deliverable graded after they were written began by describing the
 * material instead: "The material names no product owner distinct from the
 * engineering function". That is the same non-answer with a subject in front of
 * it, and an anchored test cannot see it.
 *
 * Kept narrow on purpose. This asks whether the head says there is no owner, not
 * whether it contains a negative word — "Owner: D. Okafor, who is not on call
 * this week" names somebody and must keep passing.
 */
const OWNERSHIP_DENIED =
  /\b(?:names?|is|are|was|were|have|has)\s+no\b|\bno\s+(?:\w+\s+){0,3}owner\b|\bnot\s+(?:yet\s+)?(?:named|assigned|identified|determined)\b|\bnobody\b|\bno\s+one\b/i;

/**
 * A head long enough to be prose is prose.
 *
 * The backstop under the rules above, for a slot that explains an absence in
 * words none of them list. An owner attribution is a name or a role — "D.
 * Okafor", "the platform security lead" — and the ceiling sits far enough above
 * the longest honest one that reaching it means the slot is describing a
 * situation rather than answering the question.
 */
const LONGEST_PLAUSIBLE_NAME_WORDS = 14;

function notAnOwner(head: string): boolean {
  return (
    NOT_AN_OWNER_EXACT.test(head) ||
    NOT_AN_OWNER_OPENING.test(head) ||
    COLLECTIVE_NOT_AN_OWNER.test(head) ||
    OWNERSHIP_DENIED.test(head) ||
    head.split(/\s+/).filter(Boolean).length > LONGEST_PLAUSIBLE_NAME_WORDS
  );
}

/**
 * The head of an owner attribution — what stands where the name goes, before
 * any explanation of it.
 *
 * Reading only the head is the correction to a check that passed the document
 * it was built to fail. A real deliverable wrote `Owner: [unowned] — security/
 * platform admin owns assertRecentReauth enforcement`, and a whole-value test
 * saw a long string that was not the word "unowned" and let it through. The
 * sentence is honest and useful and it is still not an owner: it says what kind
 * of person would own this, which leaves the reader with a search rather than a
 * name. Whatever follows the placeholder explains the placeholder; it does not
 * replace it.
 */
function ownerHead(value: string): string {
  return value.split(/\s*[;—(]|\s+-\s+|,\s/)[0].trim().replace(/[.*_`]+$/, '');
}

/**
 * Whether the deliverable names somebody a reader could actually go to,
 * anywhere in it.
 *
 * This is the reading of last resort, for a deliverable that never headed the
 * slot the owner question was asked in. It cannot tell which decision an
 * attribution is about, so it answers the weaker question — was a name given at
 * all — and `namesAnOwnerIn` below is what the rubric lines actually gate on.
 */
export function namesAnOwner(deliverable: string): ChallengeCheck {
  return verdictOn(readOwners(deliverable), 'for what this deliverable recommends');
}

/** The owner attributions in a stretch of prose, sorted into names and placeholders. */
function readOwners(text: string): { named: number; placeholders: string[] } {
  const placeholders: string[] = [];
  let named = 0;
  for (const match of text.matchAll(OWNER_ATTRIBUTION)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? '').trim().replace(/[.*_`]+$/, '');
    if (!value) continue;
    const head = ownerHead(value);
    if (!head) continue;
    if (notAnOwner(head)) placeholders.push(head);
    else named += 1;
  }
  return { named, placeholders };
}

/** A placeholder as the message quotes it: enough to recognize, not the whole paragraph. */
function quoted(head: string): string {
  return head.length > 60 ? `${head.slice(0, 60).trimEnd()}…` : head;
}

function verdictOn(
  read: { named: number; placeholders: string[] },
  where: string,
): ChallengeCheck {
  if (read.named > 0) {
    return {
      passed: true,
      detail: `${String(read.named)} owner attribution(s) name somebody — whether that person can actually decide is a substantive question this check cannot answer`,
    };
  }
  if (read.placeholders.length > 0) {
    return {
      passed: false,
      detail:
        `every owner attribution is a placeholder (${read.placeholders.slice(0, 3).map(quoted).join(', ')}) — ` +
        'a reader who is told the owner is unassigned has been told nothing they can act on',
    };
  }
  return {
    passed: false,
    detail:
      `no owner is named ${where} — the reader cannot act on a ` +
      'recommendation with nobody against it, and finding the owner is work this role could do',
  };
}

/**
 * Whether the slot that asks the owner question was answered with somebody.
 *
 * The whole-deliverable read above cannot ask which decision an owner owns, and
 * that limit has now let a document through twice. The playbook template already
 * carries the answer: it asks each of these roles the owner question in a named
 * slot — decision-owner, ownership, instrumentation — so the slot's own content
 * says which decision the attribution is about, and reading it is not a
 * judgement the checker is unequipped to make.
 *
 * The recorded failure is what this is for. A strategy review wrote "Not named
 * in the material as a single role or person for what capability to fund next"
 * under its decision-owner heading, raised an ASK for exactly that, and passed,
 * because two sentences elsewhere in the document — one of them the sentence
 * reporting that no owner was named — matched an owner attribution.
 *
 * A deliverable that never heads the slot falls back to the whole-document read
 * rather than failing here: the missing slot is already a gap the ladder raises,
 * and this check should be stricter than it was, never differently scoped.
 */
export function namesAnOwnerIn(slotName: string): (deliverable: string) => ChallengeCheck {
  return (deliverable) => {
    const section = slotSection(deliverable, slotName);
    if (section === null) return namesAnOwner(deliverable);
    // Within the slot the heading is the label, so the section itself is the
    // attribution — unless it writes its own, which the operations and
    // measurement slots do when several items each carry an owner.
    const written = readOwners(section);
    if (written.named > 0 || written.placeholders.length > 0) {
      return verdictOn(written, `in the ${slotName} slot`);
    }
    const head = ownerHead(section.split('\n').find((line) => line.trim())?.trim() ?? '');
    if (!head) return verdictOn({ named: 0, placeholders: [] }, `in the ${slotName} slot`);
    return verdictOn(
      notAnOwner(head) ? { named: 0, placeholders: [head] } : { named: 1, placeholders: [] },
      `in the ${slotName} slot`,
    );
  };
}

/**
 * The rubric, as the run enforces it.
 *
 * The document is the source and this table is the enforcement; a lint holds
 * them to each other so a line added there cannot go unnoticed here, and a line
 * enforced here cannot claim a requirement the reader never stated.
 */
export const RUBRIC_LINES: readonly RubricLine[] = [
  {
    concern: 'strategy-alignment',
    id: 'S1',
    weight: 'must',
    requires: 'The price of saying yes is named specifically — the work that stops, slips, or goes unstaffed.',
    enforcement: {
      kind: 'judgment',
      why: 'whether a stated price is specific enough is exactly the judgement a presence test cannot make, and the rubric names a passing-looking failure ("we will find capacity") that any matcher would admit',
    },
  },
  {
    concern: 'strategy-alignment',
    id: 'S2',
    weight: 'must',
    requires: 'Any conflict with a recorded commitment, roadmap line, or stated priority is quoted from the material, not characterized.',
    enforcement: {
      kind: 'judgment',
      why: 'quoting and characterizing have the same surface form; only a reader with the material can tell which happened',
    },
  },
  {
    concern: 'strategy-alignment',
    id: 'S3',
    weight: 'must',
    requires: 'The decision owner is named, and the deliverable says whether it is asking that person to decide or informing them.',
    enforcement: { kind: 'structural', check: namesAnOwnerIn('decision-owner') },
  },
  {
    concern: 'system-design',
    id: 'D1',
    weight: 'must',
    requires: 'Reversible choices are separated from one-way doors, and each one-way door carries what unwinding it would cost.',
    enforcement: {
      kind: 'structural',
      check: (deliverable) =>
        found(
          labelled(deliverable, ['one way door', 'one-way door', 'irreversible', 'reversible', 'cannot be undone', 'hard to undo']),
          'the deliverable distinguishes what can be undone from what cannot — whether it drew the line in the right place is a substantive question',
          'nothing separates reversible choices from one-way doors: an architecture deliverable that does not say which decisions are permanent has left out the part that governs the rest',
        ),
    },
  },
  {
    concern: 'system-design',
    id: 'D2',
    weight: 'must',
    requires: 'The deliverable stays inside the declared ceiling: shape, boundaries, coupling, migration — not a code review or an implementation opinion.',
    enforcement: {
      kind: 'judgment',
      why: 'whether a paragraph crossed from shape into implementation is a reading of its content, and a keyword test would fail correct deliverables that merely mention code',
    },
  },
  {
    concern: 'system-design',
    id: 'D3',
    weight: 'must',
    requires: 'Any claim about how the current system is shaped is tied to material actually read, or tagged.',
    enforcement: {
      kind: 'judgment',
      why: 'the citation discipline is already enforced by claims-cited; a second matcher for the same job is the drift a single checker exists to prevent',
    },
  },
  {
    concern: 'operations',
    id: 'O1',
    weight: 'must',
    requires: 'Every failure path names how anyone finds out about it; a failure with no detection path is stated as such.',
    enforcement: {
      kind: 'judgment',
      why: 'the check would have to pair each failure with a detection path, which means understanding which sentences are failures — a reading, not a presence test',
    },
  },
  {
    concern: 'operations',
    id: 'O2',
    weight: 'must',
    requires: "An owner is named for answering the failure, with what access that person needs; 'the team' is not an owner.",
    enforcement: { kind: 'structural', check: namesAnOwnerIn('ownership') },
  },
  {
    concern: 'operations',
    id: 'O3',
    weight: 'must',
    requires: 'The rollback is stated, including past any irreversible step, or the deliverable says plainly that there is none.',
    enforcement: {
      kind: 'structural',
      check: (deliverable) =>
        found(
          labelled(deliverable, ['rollback', 'roll back', 'revert', 'back out', 'no way back']),
          'a rollback position is stated — whether it would actually work is a substantive question',
          'the rollback is not addressed: an operations deliverable that never says how to get back is missing the answer to the question asked at 3am',
        ),
    },
  },
  {
    concern: 'user-experience',
    id: 'U1',
    weight: 'must',
    requires: 'The path from where the user starts to what they came to do is written out step by step, and the steps this change adds are identified.',
    enforcement: {
      kind: 'judgment',
      why: 'a step-by-step path and a list of features look alike to a matcher; only a reader can tell whether the path is walkable',
    },
  },
  {
    concern: 'user-experience',
    id: 'U2',
    weight: 'must',
    requires: 'The unhandled states this change creates — empty, error, partial, permission-denied — are enumerated, with what the interface says in each.',
    enforcement: {
      kind: 'structural',
      check: (deliverable) => {
        // Named states rather than a label: the rubric lists the four it means,
        // so the check is whether they were considered, and one of them in
        // isolation is a mention rather than an enumeration.
        const states = ['empty', 'error', 'partial', 'permission', 'denied', 'loading', 'offline'];
        const flattened = deliverable.toLowerCase();
        const present = states.filter((state) => flattened.includes(state));
        return found(
          present.length >= 3,
          `unhandled states are enumerated (${present.slice(0, 4).join(', ')}) — whether the interface's words in each are right is a substantive question`,
          `only ${String(present.length)} of the states the rubric names appear: an interface whose empty, error, partial and permission-denied cases are unwritten is designed for the path where everything works`,
        );
      },
    },
  },
  {
    concern: 'user-experience',
    id: 'U3',
    weight: 'must',
    requires: 'Any claim about existing product behavior is tied to material or tagged; no invented screens.',
    enforcement: {
      kind: 'judgment',
      why: 'already carried by claims-cited, and a second matcher for one discipline is how two checkers come to disagree',
    },
  },
  {
    concern: 'measurement',
    id: 'M1',
    weight: 'must',
    requires: 'Each claimed behavior is marked observable or unobservable in production today, with the measurement that exists, is requested, or is missing.',
    enforcement: {
      kind: 'judgment',
      why: 'pairing every claimed behavior with an observability verdict requires knowing which sentences claim behavior',
    },
  },
  {
    concern: 'measurement',
    id: 'M2',
    weight: 'must',
    requires: 'The baseline is stated, including the case where none exists and what that costs a before/after comparison.',
    enforcement: {
      kind: 'structural',
      check: (deliverable) =>
        found(
          labelled(deliverable, ['baseline', 'before and after', 'before/after', 'no prior measurement', 'starting point']),
          'a baseline position is stated — whether the number is the right one is a substantive question',
          'no baseline is stated: a measurement deliverable with no starting point cannot support the comparison it exists to enable',
        ),
    },
  },
  {
    concern: 'measurement',
    id: 'M3',
    weight: 'must',
    requires: 'Instrumentation names where a number would be recorded and who owns recording it.',
    enforcement: { kind: 'structural', check: namesAnOwnerIn('instrumentation') },
  },
  {
    concern: 'security',
    id: 'Y1',
    weight: 'must',
    requires: 'Each threat path runs from who can reach the surface to what they gain, with the check that stops it or the explicit gap where none does.',
    enforcement: {
      kind: 'judgment',
      why: 'whether a path runs end to end is the content of the path, not a word in it',
    },
  },
  {
    concern: 'security',
    id: 'Y2',
    weight: 'must',
    requires: 'Blast radius is stated concretely — one record, one tenant, every tenant, or persistent access — not as a severity word.',
    enforcement: {
      kind: 'structural',
      check: (deliverable) =>
        found(
          labelled(deliverable, [
            'one record', 'a single record', 'one tenant', 'a single tenant', 'every tenant',
            'all tenants', 'persistent access', 'every user', 'all users', 'blast radius',
          ]),
          'the reach of the exposure is stated in concrete terms — whether the estimate is right is a substantive question',
          'the reach of the exposure is not stated concretely: "critical" and "high" tell a reader how worried to be and not what is actually exposed',
        ),
    },
  },
  {
    concern: 'security',
    id: 'Y3',
    weight: 'must',
    requires: 'The deliverable stays defensive: exposures, paths, and checks. Any working exploit, attack tooling, or evasion guidance fails this line.',
    enforcement: {
      kind: 'judgment',
      why: 'the difference between describing an exposure and handing over the exploit is a reading of intent and specificity, and a keyword gate here would be both porous and prone to failing legitimate defensive writing',
    },
  },
];

/** The rubric lines bound to one concern. */
export function rubricFor(concern: string): RubricLine[] {
  return RUBRIC_LINES.filter((line) => line.concern === concern);
}

/**
 * The challenge id a rubric line carries.
 *
 * Namespaced by concern because the rubric document reuses line numbers across
 * sections written at different times — an `O2` exists under both an early
 * reader-only block and the operations concern, meaning different things. A
 * bare id would be ambiguous in exactly the record that has to be unambiguous.
 */
export function rubricChallengeId(line: RubricLine): string {
  return `rubric-${line.concern}-${line.id}`;
}

/** The concern-keyed lines this run can gate on for free. */
export function structuralRubricFor(concern: string): RubricLine[] {
  return rubricFor(concern).filter(
    (line) => line.weight === 'must' && line.enforcement.kind === 'structural',
  );
}
