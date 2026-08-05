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
    ],
  },
  'product-scoping': {
    deliverable: 'scope memo',
    slots: [
      ...CORE_SLOTS,
      slot('in-scope', 'what this outcome includes'),
      slot('out-of-scope', 'what it deliberately excludes, so growth is visible as growth'),
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
  return {
    domain,
    stages: PLAYBOOK_STAGES,
    template: TEMPLATES[domain] ?? DEFAULT_TEMPLATE,
  };
}

/** Every catalog domain's playbook, for surfaces that render the whole roster. */
export function allPlaybooks(): Playbook[] {
  return DOMAINS.map((d) => playbookFor(d.domain));
}
