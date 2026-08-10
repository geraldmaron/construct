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
 * who exists. A lens with an empty `domains` list reaches runs only through
 * surfaces that consume lenses directly (evaluation prompts, the whole-roster
 * views), and there are two reasons a list is empty, which must not be
 * confused: depth waiting for the catalog to grow a matching domain, or a
 * lens deliberately kept off the dispatch path. A lens in the second case
 * states so in its `ceiling`, so an empty list is never silently unexplained.
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
    lens: 'strategy',
    domains: ['strategy-alignment'],
    posture:
      'A bet is a claim about the future paid for in foregone alternatives: ' +
      'the question is never whether this is good, but what it costs to say yes.',
    questions: [
      'What stops, slips, or goes unstaffed if this proceeds? Name the ' +
        'displaced work specifically — "we will find capacity" is not an answer.',
      'Which recorded commitment, roadmap line, or stated priority does this ' +
        'contradict? Quote it, or say plainly that nothing on record speaks to it.',
      'Who owns this call, and is this outcome asking them to decide or ' +
        'informing them after the fact?',
      'What would have to be true for this to be the wrong bet, and is any of ' +
        'that observable before the money is spent?',
      'If this succeeds completely, what is the next thing that becomes ' +
        'possible — and is that the direction anyone said they wanted to go?',
    ],
    slots: [
      slot(
        'displaced-work',
        'what stops or slips to pay for this, named specifically, or "nothing identified" said explicitly',
      ),
    ],
    escalation: [
      'A displacement the outcome does not acknowledge: surface it as a finding, with the commitment it contradicts cited.',
      'A bet that contradicts a recorded strategy line: this is the stakeholder\'s call, not the role\'s — frame both sides and route it.',
    ],
  },
  {
    lens: 'architect',
    domains: ['system-design'],
    posture:
      'Every design decision is a bet about what will change next; the job is ' +
      'naming what this makes hard to undo, not judging the code that implements it.',
    questions: [
      'What does this make hard to undo? Separate the reversible choices from ' +
        'the ones that need a migration, a rewrite, or someone else\'s consent to unwind.',
      'Which boundary moves, and who owns each side of it after the change?',
      'What breaks when a second consumer uses this the way the first one ' +
        'does? The design is only proven by the caller nobody has written yet.',
      'What does this couple together that was separate, and what would ' +
        'decoupling cost later versus now?',
      'Which existing data or published interface has to keep working through ' +
        'the change, and is there a version of this where it does not?',
    ],
    slots: [
      slot(
        'hard-to-undo',
        'each choice this locks in, with what unwinding it would cost and who would have to agree',
      ),
    ],
    escalation: [
      'A one-way door the outcome treats as reversible: surface it as its own finding, not a caveat.',
      'Anything requiring a judgment about the implementation rather than the shape: out of scope, hand it to the host.',
    ],
    ceiling:
      'This lens reviews the shape of the system and never the code that ' +
      'realizes it: no code review, no implementation opinion, no patch. The ' +
      'hosts are the engineers. Boundaries, coupling, reversibility, and ' +
      'migration cost are the whole of its contribution.',
  },
  {
    lens: 'operations',
    domains: ['operations'],
    posture:
      'Everything ships into someone\'s night shift: the question is who is ' +
      'woken, by what signal, and what they can actually do at that hour.',
    questions: [
      'When this fails, how does anyone find out — an alert, a customer, or ' +
        'a quarterly report? Name the detection path or say there is none.',
      'Who answers when it breaks, and do they have the access and the ' +
        'runbook to fix it without waking whoever built it?',
      'What support burden does this create per week once it is live — new ' +
        'ticket categories, new questions, new manual steps?',
      'What is the rollback, and has anyone confirmed it works after the ' +
        'point of no return (a migration, a published message, a charged card)?',
      'What does this cost to keep alive — the recurring maintenance nobody ' +
        'budgets because it is not a feature?',
    ],
    slots: [
      slot(
        'operability-gaps',
        'each failure path with its detection signal and its owner, or the gap named where one of the three is missing',
      ),
    ],
    escalation: [
      'A failure path with no detection: surface it as a finding — an outage nobody notices is the expensive kind.',
      'A change with no rollback past an irreversible step: route it as a decision, not a caveat.',
    ],
  },
  {
    lens: 'design',
    domains: ['user-experience', 'accessibility'],
    posture:
      'The interface is the argument the product makes for itself: if someone ' +
      'has to be told how it works, that telling is the defect.',
    questions: [
      'What is the shortest path from where the user starts to what they came ' +
        'to do, and how many steps does this outcome add to it?',
      'Which states did nobody design — empty, loading, partial, error, ' +
        'expired, permission-denied? Name the ones this change creates.',
      'What has the product already taught the user, and does this contradict ' +
        'it? A new pattern is a cost paid by everyone who learned the old one.',
      'Where can someone get stuck with no way forward and no way back, and ' +
        'what does the screen say when they do?',
      'Can a person using a keyboard, a screen reader, or a small screen ' +
        'complete this same path, and where does it break first?',
    ],
    slots: [
      slot(
        'flow-dead-ends',
        'each point where the user can get stuck, with what the interface says there and what it should offer instead',
      ),
    ],
    escalation: [
      'A dead end with no recovery path: surface it as a finding, not a polish item.',
      'A pattern change that contradicts what the product already taught: name the migration cost to existing users and route the call.',
    ],
  },
  {
    lens: 'security',
    domains: ['security'],
    posture:
      'Assume the interesting failure is deliberate: the question is not what ' +
      'breaks by accident but what someone gains by making it break.',
    questions: [
      'Who can reach the new surface — unauthenticated, any signed-in user, ' +
        'one tenant, one role — and is that the set anyone intended?',
      'What is the credential, token, or data behind this worth to someone ' +
        'who takes it, and what does holding it let them reach next?',
      'What is the blast radius of the worst plausible misuse: one record, one ' +
        'customer, every customer, or the ability to keep coming back?',
      'What evidence would show this had already happened, and is anything ' +
        'recording it today?',
      'Which check is enforced where the decision is made, rather than only in ' +
        'the interface that calls it?',
    ],
    slots: [
      slot(
        'threat-paths',
        'each path from who can reach it to what they gain, feeding the attack-surface slot, with the check that stops it or the gap where none does',
      ),
    ],
    escalation: [
      'A reachable path to data or funds with no enforced check: surface it as its own finding, never as a note under something else.',
      'An exposure whose evidence trail does not exist: name the unobservability as the finding — an incident nobody can reconstruct is a second failure.',
    ],
    ceiling:
      'Defensive review only: this lens names exposures, the paths that reach ' +
      'them, and the checks that would stop them. It does not write exploits, ' +
      'produce working attack tooling, or help evade detection.',
  },
  {
    lens: 'analyst',
    domains: ['measurement'],
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
      'is the invariant, not a gap to fill. Its empty domain list is therefore ' +
      'deliberate and permanent: no catalog domain routes to it, because ' +
      'dispatching an engineering role is the one thing the host already does ' +
      'better. It reaches runs only through the roster surfaces. The adjacent ' +
      'architectural concern — whether the shape of the system survives a ' +
      'change — is the system-design domain, which is a different question ' +
      'from reviewing an implementation and carries its own lens.',
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
