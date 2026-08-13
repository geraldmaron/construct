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

const NOT_AN_OWNER =
  /^(?:\[?(?:unowned|unassigned|unknown|none|nobody|no one|tbd|tba|n\/a)\]?|not (?:yet )?(?:named|assigned|determined|identified|decided)|unclear|the team|the org|the group|engineering|the business|whoever|someone|to be (?:decided|determined|named|assigned))\.?$/i;

/**
 * Whether the deliverable names somebody a reader could actually go to.
 *
 * One implementation for the three rubric lines that require an owner, rather
 * than three matchers that would drift apart. The lines differ in what the
 * owner owns — a decision, a failure, an instrument — and a structural check
 * cannot see that difference; what it can see is whether a name was given at
 * all, which is the part all three fail on together in practice.
 */
export function namesAnOwner(deliverable: string): ChallengeCheck {
  const placeholders: string[] = [];
  let named = 0;
  for (const match of deliverable.matchAll(OWNER_ATTRIBUTION)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? '').trim().replace(/[.*_`]+$/, '');
    if (!value) continue;
    if (NOT_AN_OWNER.test(value)) placeholders.push(value);
    else named += 1;
  }
  if (named > 0) {
    return {
      passed: true,
      detail: `${String(named)} owner attribution(s) name somebody — whether that person can actually decide is a substantive question this check cannot answer`,
    };
  }
  if (placeholders.length > 0) {
    return {
      passed: false,
      detail:
        `every owner attribution is a placeholder (${placeholders.slice(0, 3).join(', ')}) — ` +
        'a reader who is told the owner is unassigned has been told nothing they can act on',
    };
  }
  return {
    passed: false,
    detail:
      'no owner is named for what this deliverable recommends — the reader cannot act on a ' +
      'recommendation with nobody against it, and finding the owner is work this role could do',
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
    enforcement: { kind: 'structural', check: namesAnOwner },
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
    enforcement: { kind: 'structural', check: namesAnOwner },
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
    enforcement: { kind: 'structural', check: namesAnOwner },
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
