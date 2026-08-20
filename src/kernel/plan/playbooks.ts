/**
 * kernel/plan/playbooks.ts — role playbooks: the staged process a role
 * follows and the deliverable template, with required slots, its work must fill.
 *
 * This is not a second role registry. The domain catalog
 * (implication/domains.ts) stays the one list of who exists; a playbook is
 * what the plan layer adds on top: the shape that domain's deliverable
 * takes, expressed as named slots so sufficiency is a check, not
 * a feeling. Domains without a bespoke template share the default review
 * memo — a template that fits everything is still better than prose that
 * fits nothing, because its empty slots are visible.
 *
 * The file also carries the elicitation family at the bottom: templates for
 * the documents a run hands back when the missing information lives in
 * somebody's head rather than in a source. They are keyed by their own name
 * rather than by a domain, because no concern owns them — any role's work can
 * end in "go and ask".
 */

import { DOMAINS } from '../implication/domains.ts';
import { COMPOSITION_SHAPES } from '../run/shapes.ts';
import { lensForDomain } from './lenses.ts';
import { PLAYBOOK_STAGES } from './schema.ts';
import type { DeliverableTemplate, PlaybookStage, Slot } from './schema.ts';

export interface Playbook {
  readonly domain: string;
  readonly stages: readonly PlaybookStage[];
  readonly template: DeliverableTemplate;
}

const slot = (name: string, expects: string, required = true): Slot => ({ name, expects, required });

/**
 * Every deliverable answers these regardless of domain; a domain template adds
 * to them rather than replacing them. Finding-first because the reader's first
 * question is "what did you conclude", not "what did you look at".
 */
const CORE_SLOTS: readonly Slot[] = [
  slot('finding', 'the conclusion, stated first, in plain language'),
  slot('evidence', 'what supports the finding, each item citing a source read or the domain catalog'),
  slot('risks', 'what could make the finding wrong, or "none identified" said explicitly'),
  slot('open-questions', 'what remains unknown, each with the assumed default the draft proceeds on', false),
];

/** Bespoke templates where the domain's deliverable has a sharper shape than a memo. */
const TEMPLATES: Readonly<Record<string, DeliverableTemplate>> = {
  privacy: {
    deliverable: 'privacy review',
    slots: [
      ...CORE_SLOTS,
      slot('data-inventory', 'what personal data the outcome touches, or "none" explicitly'),
      slot('licensed-review', 'the recommendation to a licensed professional this draft does not replace'),
    ],
  },
  contracts: {
    deliverable: 'agreement review',
    slots: [
      ...CORE_SLOTS,
      slot('parties-and-terms', 'who is bound and to what, as read from the source'),
      slot('licensed-review', 'the recommendation to a licensed professional this draft does not replace'),
    ],
  },
  security: {
    deliverable: 'security assessment',
    slots: [
      ...CORE_SLOTS,
      slot('attack-surface', 'what the outcome exposes and to whom'),
      slot('mitigations', 'what reduces each exposure, tied to the surface it reduces'),
    ],
  },
  'program-sequencing': {
    deliverable: 'sequencing plan',
    slots: [
      ...CORE_SLOTS,
      slot('order', 'the sequence and why each item precedes the next'),
      slot('blockers', 'what stops progress today and who can unstick it'),
      slot('milestones', 'the checkpoints a reader can verify passing, each dated or explicitly unscheduled', false),
    ],
  },
  // The deliverable a product manager actually hands a team. Every question a
  // PRD review would ask is a named slot here, so the organization's unwritten
  // checklist becomes a check rather than a reviewer's memory — and a fact the
  // material cannot settle is an [assumed] or [unverified] entry in the slot,
  // never a reason to withhold the document.
  'product-scoping': {
    deliverable: 'product requirements document',
    slots: [
      ...CORE_SLOTS,
      slot('users-and-problem', 'who this serves and the problem it solves for them, cited to the material or [unverified]'),
      slot('in-scope', 'what this outcome includes'),
      slot('out-of-scope', 'what it deliberately excludes, so growth is visible as growth'),
      slot('success-measures', 'how the user will know it worked — each one checkable, cited or [unverified]'),
      slot('phasing', 'what ships first and what deliberately waits, with the reason for the split', false),
    ],
  },
  // The document a leader reads before saying yes. The price slot is required
  // because a bet whose cost is unstated reads as free, and nothing is.
  'strategy-alignment': {
    deliverable: 'strategy review',
    slots: [
      ...CORE_SLOTS,
      slot('the-bet', 'what this commits to and what it assumes about the future, in one paragraph'),
      slot('price', 'what saying yes costs — money, time, and the work that stops — or "unstated in the material" explicitly'),
      slot('decision-owner', 'who owns this call, and whether this outcome asks them to decide or tells them afterward'),
    ],
  },
  // What survives the change, and what it costs to change your mind. Ordered
  // so the irreversible parts are read before the pleasant ones.
  'system-design': {
    deliverable: 'design review',
    slots: [
      ...CORE_SLOTS,
      slot('boundaries', 'which boundaries move and who owns each side after the change'),
      slot('reversibility', 'what stays reversible and what does not, each with the cost of unwinding it'),
      slot('migration', 'what has to keep working through the change, and how, or "nothing in flight" explicitly'),
    ],
  },
  // Written for the person who gets paged, not the person who ships.
  operations: {
    deliverable: 'operability review',
    slots: [
      ...CORE_SLOTS,
      slot('failure-paths', 'how this breaks, each with how anyone would find out'),
      slot('ownership', 'who answers when it breaks and what access they need to fix it'),
      slot('rollback', 'how to undo it, including past any irreversible step, or the plain statement that there is none'),
    ],
  },
  'user-experience': {
    deliverable: 'experience review',
    slots: [
      ...CORE_SLOTS,
      slot('the-path', 'the shortest route from where the user starts to what they came to do, step by step'),
      slot('unhandled-states', 'the empty, error, partial, and permission-denied states this creates, and what each one says'),
    ],
  },
  // What an analyst hands back: not the number, but whether the number can
  // exist. A baseline that does not exist yet is the finding, so the slot
  // demands it be said rather than left as silence.
  measurement: {
    deliverable: 'measurement plan',
    slots: [
      ...CORE_SLOTS,
      slot('baseline', 'what the number reads today, or that no baseline exists and what that costs'),
      slot('instrumentation', 'what would have to be recorded, where it would be recorded, and who owns recording it'),
    ],
  },
};

const DEFAULT_TEMPLATE: DeliverableTemplate = {
  deliverable: 'review memo',
  slots: CORE_SLOTS,
};

/**
 * The playbook for a domain. Unknown domains get the default memo rather than
 * an error: the planner may route to a domain the catalog gains later, and a
 * generic template with visible empty slots beats refusing to plan.
 */
export function playbookFor(domain: string): Playbook {
  const base = TEMPLATES[domain] ?? DEFAULT_TEMPLATE;
  // A lens that deepens this domain adds its slots to the template, so lens
  // depth is checkable sufficiency, not prose the deliverable may skip. Slots
  // the base template already names are not doubled.
  const lens = lensForDomain(domain);
  const added = (lens?.slots ?? []).filter(
    (s) => !base.slots.some((existing) => existing.name === s.name),
  );
  const template =
    added.length > 0 ? { ...base, slots: [...base.slots, ...added] } : base;
  return {
    domain,
    stages: PLAYBOOK_STAGES,
    template,
  };
}

/** Every catalog domain's playbook, for surfaces that render the whole roster. */
export function allPlaybooks(): Playbook[] {
  return DOMAINS.map((d) => playbookFor(d.domain));
}

/**
 * The elicitation family: what a run hands the user when the answer is in
 * somebody else's head.
 *
 * These are documents, not a conversation. Nothing here asks anyone anything —
 * the user takes the guide into the room, runs the plan, or goes and breaks the
 * hypothesis, and what comes back enters the run as a source like any other.
 * Reading them as a live loop is the one misreading that matters, because a
 * template that quietly implied it could interview somebody would be claiming
 * a reach it does not have.
 *
 * They deliberately do not carry the core slots. Every domain template above is
 * finding-first because a reader's first question is what you concluded; these
 * are written before there is anything to conclude, and a finding slot on an
 * interview guide invites the writer to answer the question they were about to
 * go and ask.
 */

/**
 * The falsifier question, borrowed from the decision shape rather than
 * restated. A decision nobody can falsify is a preference, and the composition
 * shape already asks a commitment what a reader could observe that would make
 * it wrong; a hypothesis owes its reader exactly the same observation. Reading
 * the wording out of that section keeps one question in one place — a second
 * hand-written copy drifts, and then two documents ask different things under
 * one name.
 */
function falsifierQuestion(): string {
  const decision = COMPOSITION_SHAPES.find((shape) => shape.name === 'decision');
  const asked = decision?.sections.find((section) => section.name === 'what-would-change-it');
  if (!asked) {
    throw new Error(
      'the decision shape no longer asks what would change it: the falsifier slot has nothing to borrow',
    );
  }
  return asked.expects;
}

const ELICITATION_TEMPLATES: Readonly<Record<string, DeliverableTemplate>> = {
  // A guide is only as good as its worst question, so every question has to
  // earn its place twice: once by naming what an answer settles, and once by
  // naming what a different answer would move.
  'interview-guide': {
    deliverable: 'interview guide',
    slots: [
      slot(
        'audience',
        'who is being interviewed and what they are placed to know that nobody else is — a person or a named role, never "stakeholders"',
      ),
      slot(
        'what-each-question-establishes',
        'each question with the one thing an answer to it settles, so a question that establishes nothing is visible before it is asked',
      ),
      slot(
        'what-answer-would-change-what',
        'for each question, which answers would change the outcome, the scope, or the next step — and what each one would change',
      ),
    ],
  },
  // Research with no stated end runs until somebody loses patience, and then
  // the stopping point is a mood rather than a finding. The stop rule is fixed
  // in the document that starts the work, not decided by whoever is tired.
  'research-plan': {
    deliverable: 'research plan',
    slots: [
      slot(
        'questions',
        'the questions this research answers, each one a finding could settle — a question no finding could settle is a topic',
      ),
      slot(
        'method',
        'how each question gets answered: what is read, run, measured, or asked, and who does it',
      ),
      slot(
        'stop-rule',
        'what ends this research — the finding that would be enough, the budget, or the date — fixed before it starts rather than once it stalls',
      ),
    ],
  },
  // Three slots that only mean anything together: a claim, the observation that
  // would kill it, and the cheapest way to go and look. A statement with no
  // falsifier is a belief; a falsifier nobody can afford to test is a shrug.
  hypotheses: {
    deliverable: 'hypotheses',
    slots: [
      slot(
        'statement',
        'each hypothesis as one claim that could turn out wrong, stated about how things are rather than about what to do',
      ),
      slot(
        'falsifier',
        `${falsifierQuestion()}, written as one observation somebody could actually go and make`,
      ),
      slot(
        'cheapest-test',
        'the least expensive thing that would produce that observation, with what running it costs and who can run it',
      ),
    ],
  },
};

/**
 * An elicitation template by name. Unknown names are refused rather than
 * defaulted: the family is a closed set a run picks from, not a routing
 * inference, so a name that is not in it is a mistake and should read as one.
 */
export function elicitationTemplate(name: string): DeliverableTemplate | undefined {
  return ELICITATION_TEMPLATES[name.trim().toLowerCase()];
}

/** Every elicitation template, for surfaces that render the whole family. */
export function allElicitationTemplates(): DeliverableTemplate[] {
  return Object.values(ELICITATION_TEMPLATES);
}

/** The names a caller may ask for, for usage lines and whole-family views. */
export function elicitationNames(): string[] {
  return Object.keys(ELICITATION_TEMPLATES);
}
