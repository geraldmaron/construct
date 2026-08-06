/**
 * kernel/plan/lenses.ts — role lenses: the awareness depth each role pack
 * carries over the shared playbook.
 *
 * A role is a framing and risk posture over the shared playbook plus a domain
 * corpus; this module is where that depth lives as data. Each lens names the
 * catalog domains it deepens, the posture sentence a dispatch opens with, the
 * question set the role works through, the extra deliverable slots its output
 * must fill, and the escalation ladder that says when to stop and route
 * upward. The domain catalog (implication/domains.ts) stays the one list of
 * who exists — a lens with an empty `domains` list is depth waiting for the
 * catalog to grow a matching domain, and until then it reaches runs only
 * through surfaces that consume lenses directly (evaluation prompts, the
 * whole-roster views).
 *
 * The question sets are written from role practice, not from any corpus they
 * are evaluated on: each question is one a practitioner of the role asks about
 * any organization. Whether the depth is real is measured, not asserted —
 * fixture-organization runs score each lens against ground truth recorded
 * before the run.
 */

import type { Slot } from './schema.ts';

const slot = (name: string, expects: string, required = true): Slot => ({ name, expects, required });

export interface RoleLens {
  /** The lens name, stable across surfaces. */
  readonly lens: string;
  /** Catalog domains this lens deepens. Empty means no catalog domain carries it yet. */
  readonly domains: readonly string[];
  /** The framing and risk posture, one sentence a dispatch opens with. */
  readonly posture: string;
  /** The questions the role works through, each answerable from sources. */
  readonly questions: readonly string[];
  /** Extra deliverable slots this lens adds to its domains' templates. */
  readonly slots: readonly Slot[];
  /** When to stop and route upward, in order. */
  readonly escalation: readonly string[];
  /**
   * A standing label every deliverable under this lens must carry, present
   * where review status has weight (legal and compliance output is drafted
   * for review, never issued as advice).
   */
  readonly labeling?: string;
  /**
   * Jurisdictions this lens's doctrine covers. An empty `covered` list is the
   * honest state until a licensed reviewer has accepted the corpus: everything
   * is flagged for licensed review and nothing is asserted as covered.
   */
  readonly jurisdictions?: {
    readonly covered: readonly string[];
    readonly outside: string;
  };
  /**
   * The stated depth limit. A lens with a ceiling contributes exactly what the
   * ceiling names and nothing deeper — the limit is the invariant, not a gap.
   */
  readonly ceiling?: string;
}

export const LENSES: readonly RoleLens[] = Object.freeze([
  {
    lens: 'compliance',
    domains: ['compliance'],
    posture:
      'Controls and evidence over intent: a change is what it does to who can act, ' +
      'what gets recorded, and what an auditor can verify afterward.',
    questions: [
      'When a change moves who or what performs an action, which identity acts ' +
        'afterward, what audit trail records that act, and who reviews that access?',
      'For every permission, credential, or trust change: does it widen or narrow ' +
        'access, and do the review and audit processes follow the new identity or ' +
        'still watch the old one?',
      'Which standing obligations or open requests (certifications, customer ' +
        'commitments, access-control asks already on file) does this change ' +
        'satisfy, advance, or contradict? When an open access request and a ' +
        'design change converge on the same access model, state the governance ' +
        'consequence for that pair — which identity acts, who reviews that ' +
        'access, where the audit trail must follow — citing both documents.',
      'What evidence would an auditor ask for after this ships, and does that ' +
        'evidence exist or is it only planned?',
      'Where does a shared or privileged credential get replaced, retired, or ' +
        'quietly kept — and who still holds it?',
    ],
    slots: [
      slot(
        'access-and-audit',
        'for each change in who or what acts: the identity that acts afterward, ' +
          'the audit trail that records it, and who reviews that access',
      ),
    ],
    escalation: [
      'A control gap with no owner: put the ownership question in the decision inbox.',
      'A regulator-facing obligation possibly breached: route to licensed review before anything relies on the finding.',
    ],
    labeling: 'dogfood-only until a licensed reviewer has accepted this lens',
  },
  {
    lens: 'legal',
    domains: ['contracts', 'privacy', 'employment'],
    posture:
      'Issue-spot, draft, escalate — never advise: name the exposure, cite what ' +
      'creates it, and route what needs a licensed human to a licensed human.',
    questions: [
      'Who authored each record the organization relies on, and can that ' +
        'authorship be proven? Where machine-generated writes enter a system of ' +
        'record, what distinguishes them from human acts?',
      'What binds the organization — agreements, published commitments, granted ' +
        'permissions — and does any planned change put it in breach?',
      'When a process is automated, where does responsibility move, and is the ' +
        'new holder named anywhere?',
      'Which findings need a licensed professional, and in which jurisdiction?',
    ],
    slots: [
      slot(
        'provenance-and-authorship',
        'where records the organization relies on come from, and whether their ' +
          'origin can be proven or only assumed',
      ),
      slot(
        'licensed-review',
        'the recommendation to a licensed professional this draft does not replace',
      ),
    ],
    escalation: [
      'Anything that reads as advice rather than an issue spotted: stop and relabel as template-for-review.',
      'A finding outside the declared jurisdictions: flag it as outside coverage; do not analyze past the flag.',
    ],
    labeling: 'template-for-review; dogfood-only until a licensed attorney has accepted this lens',
    jurisdictions: {
      covered: [],
      outside:
        'No jurisdiction is covered until a licensed attorney has reviewed this ' +
        'lens; every finding is flagged for licensed review.',
    },
  },
  {
    lens: 'program',
    domains: ['program-sequencing'],
    posture:
      'The plan is claims about the future; the job is finding where two of ' +
      'those claims cannot both hold.',
    questions: [
      'Which workstreams, scheduled together, collide — where does a rule or ' +
        'restriction adopted in one place forbid what another plans to do?',
      'Which decision made in one team blocks work planned elsewhere, and does ' +
        'the blocked team know?',
      'Who owns each cross-team dependency — named, or assumed?',
      'Which interim restrictions from incidents or reviews constrain planned ' +
        'work, and is the plan aware of them or scheduled as if they were ' +
        'lifted? For each restriction, name every OTHER planned or requested ' +
        'workstream — beyond the one it was written against — that cannot ' +
        'proceed while it stands, citing the restriction and each plan it ' +
        'collides with. An open request is planned work for this purpose: a ' +
        'restriction that forbids the combination a request asks for collides ' +
        'with that request, and the claim cites the request itself, not only ' +
        'the work the restriction was written against.',
      'Is the date real: what has to be true for it that is not true yet?',
    ],
    slots: [
      slot(
        'collisions',
        'workstreams that cannot proceed together as scheduled, each with both ' +
          'sides cited and the owner who can resolve it',
      ),
    ],
    escalation: [
      'A collision with no named owner: put the ownership question in the decision inbox.',
      'A date that cannot hold: surface the tradeoff with both sides cited rather than picking a side.',
    ],
  },
  {
    lens: 'product',
    domains: ['product-scoping'],
    posture:
      'Scope is a set of promises; the job is finding the promise the ' +
      'organization has made twice, incompatibly.',
    questions: [
      'Do any two commitments contradict — strategy against specification, ' +
        'specification against public statement? Cite both sides.',
      'Where does field evidence — tickets, user reports, incident notes — ' +
        'contradict an assumption the plan is built on?',
      'What is explicitly out of scope, and is anything relying on it anyway?',
      'How will anyone know it worked — is the success measure stated, and does ' +
        'the data for it exist?',
    ],
    slots: [
      slot(
        'commitment-conflicts',
        'commitments that cannot both hold, each side cited, with who owns the call',
      ),
    ],
    escalation: [
      'Two commitments that cannot both hold: frame the tradeoff with both cited and put it in the decision inbox.',
    ],
  },
  {
    lens: 'analyst',
    domains: [],
    posture:
      'A behavior nobody can measure is a claim, not a fact; the job is naming ' +
      'what is observable, what is not, and what closing the gap costs.',
    questions: [
      'For every claimed behavior or failure mode: is it observable in ' +
        'production today? What measurement exists, is requested somewhere, or ' +
        'is missing entirely?',
      'If this failed right now, what number would move — and is anyone ' +
        'recording that number?',
      'What baseline would a before/after comparison need, and does it exist ' +
        'before the change ships?',
      'Which requested metrics or reports are still open, and which planned ' +
        'work depends on them without saying so?',
    ],
    slots: [
      slot(
        'measurement-gaps',
        'each finding marked observable or unobservable in production, with the ' +
          'measurement that exists, is requested, or is missing',
      ),
    ],
    escalation: [
      'An unobservable failure mode in shipping work: surface the measurement gap as its own finding, not a footnote.',
    ],
  },
  {
    lens: 'engineering',
    domains: [],
    posture:
      'Cross-reference only: tie each reported symptom to the design decision ' +
      'that explains it, and stop there.',
    questions: [
      'Which reported symptoms and which design documents describe the same ' +
        'underlying change? Tie each symptom to the decision that explains it.',
      'Which design decisions have symptoms already filed against them that ' +
        'the design does not acknowledge?',
    ],
    slots: [
      slot(
        'symptom-to-design',
        'each symptom tied to the design decision that explains it, both cited',
      ),
    ],
    escalation: [
      'Anything deeper than a cross-reference — a fix, a review, an implementation opinion: out of scope, hand it to the host.',
    ],
    ceiling:
      'Engineering stays thin by design: the hosts are the engineers. This lens ' +
      'contributes cross-references tying symptoms to design documents and ' +
      'nothing deeper — no code review, no implementation judgment. The limit ' +
      'is the invariant, not a gap to fill.',
  },
]);

/** The lens that deepens a domain, if any does. */
export function lensForDomain(domain: string): RoleLens | undefined {
  return LENSES.find((l) => l.domains.includes(domain));
}

/** A lens by its own name, for surfaces that consume lenses directly. */
export function lensByName(lens: string): RoleLens | undefined {
  return LENSES.find((l) => l.lens === lens);
}
