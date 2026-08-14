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
 */

import { DOMAINS } from '../implication/domains.ts';
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

const issues = (deliverable: string, extra: readonly Slot[]): DeliverableTemplate => ({
  deliverable,
  form: 'issues',
  slots: [...CORE_SLOTS, ...extra],
});

const document = (deliverable: string, extra: readonly Slot[]): DeliverableTemplate => ({
  deliverable,
  form: 'document',
  slots: [...CORE_SLOTS, ...extra],
});

/** Bespoke templates where the domain's deliverable has a sharper shape than a memo. */
const TEMPLATES: Readonly<Record<string, DeliverableTemplate>> = {
  privacy: issues('privacy review', [
    slot('data-inventory', 'what personal data the outcome touches, or "none" explicitly'),
    slot('licensed-review', 'the recommendation to a licensed professional this draft does not replace'),
  ]),
  contracts: issues('agreement review', [
    slot('parties-and-terms', 'who is bound and to what, as read from the source'),
    slot('licensed-review', 'the recommendation to a licensed professional this draft does not replace'),
  ]),
  security: issues('security assessment', [
    slot('attack-surface', 'what the outcome exposes and to whom'),
    slot('mitigations', 'what reduces each exposure, tied to the surface it reduces'),
  ]),
  compliance: issues('compliance review', []),
  'program-sequencing': document('sequencing plan', [
    slot('order', 'the sequence and why each item precedes the next'),
    slot('blockers', 'what stops progress today and who can unstick it'),
    slot('milestones', 'the checkpoints a reader can verify passing, each dated or explicitly unscheduled', false),
  ]),
  // The deliverable a product manager actually hands a team. Every question a
  // PRD review would ask is a named slot here, so the organization's unwritten
  // checklist becomes a check rather than a reviewer's memory — and a fact the
  // material cannot settle is an [assumed] or [unverified] entry in the slot,
  // never a reason to withhold the document.
  'product-scoping': document('product requirements document', [
    slot('users-and-problem', 'who this serves and the problem it solves for them, cited to the material or [unverified]'),
    slot('in-scope', 'what this outcome includes'),
    slot('out-of-scope', 'what it deliberately excludes, so growth is visible as growth'),
    slot('success-measures', 'how the user will know it worked — each one checkable, cited or [unverified]'),
    slot('phasing', 'what ships first and what deliberately waits, with the reason for the split', false),
  ]),
  // The document a leader reads before saying yes. The price slot is required
  // because a bet whose cost is unstated reads as free, and nothing is.
  'strategy-alignment': document('strategy review', [
    slot('the-bet', 'what this commits to and what it assumes about the future, in one paragraph'),
    slot('price', 'what saying yes costs — money, time, and the work that stops — or "unstated in the material" explicitly'),
    slot('decision-owner', 'who owns this call, and whether this outcome asks them to decide or tells them afterward'),
  ]),
  // What survives the change, and what it costs to change your mind. Ordered
  // so the irreversible parts are read before the pleasant ones.
  'system-design': document('design review', [
    slot('boundaries', 'which boundaries move and who owns each side after the change'),
    slot('reversibility', 'what stays reversible and what does not, each with the cost of unwinding it'),
    slot('migration', 'what has to keep working through the change, and how, or "nothing in flight" explicitly'),
  ]),
  // Written for the person who gets paged, not the person who ships.
  operations: document('operability review', [
    slot('failure-paths', 'how this breaks, each with how anyone would find out'),
    slot('ownership', 'who answers when it breaks and what access they need to fix it'),
    slot('rollback', 'how to undo it, including past any irreversible step, or the plain statement that there is none'),
  ]),
  'user-experience': document('experience review', [
    slot('the-path', 'the shortest route from where the user starts to what they came to do, step by step'),
    slot('unhandled-states', 'the empty, error, partial, and permission-denied states this creates, and what each one says'),
  ]),
  // What an analyst hands back: not the number, but whether the number can
  // exist. A baseline that does not exist yet is the finding, so the slot
  // demands it be said rather than left as silence.
  measurement: document('measurement plan', [
    slot('baseline', 'what the number reads today, or that no baseline exists and what that costs'),
    slot('instrumentation', 'what would have to be recorded, where it would be recorded, and who owns recording it'),
  ]),
};

const DEFAULT_TEMPLATE: DeliverableTemplate = {
  deliverable: 'review memo',
  form: 'document',
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
