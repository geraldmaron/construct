/**
 * kernel/plan/lenses.ts — role lenses: what a domain's deliverable owes, and
 * who it is answered in the name of.
 *
 * A lens is an obligation set, not a claim to sight. It names the catalog
 * domains it equips, the posture sentence a dispatch opens with, the question
 * set that must be worked through, the extra deliverable slots the output must
 * fill, and the escalation ladder that says when to stop and route upward. The
 * domain catalog (implication/domains.ts) stays the one list of who exists.
 *
 * What a lens explicitly does NOT assert is that it reaches findings other
 * lenses cannot. That claim was tested over two independently authored fixture
 * organizations and is retired: differing question sets over one model produce
 * the same findings naming the same mechanisms, and the external record says
 * the same (RESEARCH-DECISIONS.md sections 14 and 15). What survives, and what
 * this module is for, is narrower and checkable — the questions get asked at
 * all, the slots get filled before anything is called finished, and the work
 * log can say in whose name each finding was written. Where genuine
 * independence is needed, it is bought with cross-family dispatch, not with a
 * second question set.
 *
 * A lens with an empty `domains` list reaches runs only through surfaces that
 * consume lenses directly (evaluation prompts, the whole-roster views), and
 * there are two reasons a list is empty, which must not be confused: an
 * obligation set waiting for the catalog to grow a matching domain, or a lens
 * deliberately kept off the dispatch path. A lens in the second case states so
 * in its `ceiling`, so an empty list is never silently unexplained.
 *
 * The question sets are written from role practice, not from any corpus they
 * are evaluated on: each question is one a practitioner of the role asks about
 * any organization.
 */

import type { Slot } from './schema.ts';

const slot = (name: string, expects: string, required = true): Slot => ({ name, expects, required });

export interface RoleLens {
  /** The lens name, stable across surfaces. */
  readonly lens: string;
  /** Catalog domains this lens equips. Empty means no catalog domain carries it yet. */
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
   * The stated scope limit. A lens with a ceiling contributes exactly what the
   * ceiling names and nothing beyond it — the limit is the invariant, not a gap.
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
      slot(
        'performance-obligation',
        'the performance obligation this work must meet: the gate the declared ' +
          'repository runs, named by the script that runs it, or the standard ' +
          'this method descends from where it declares none — with how a reader ' +
          'would check the work against it',
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
      slot(
        'accessibility-obligation',
        'the accessibility obligation this work must meet: the gate the declared ' +
          'repository runs, named by the script that runs it, or the standard ' +
          'this method descends from where it declares none — with how a reader ' +
          'would check the work against it',
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
      slot(
        'security-obligation',
        'the security obligation this work must meet: the gate the declared ' +
          'repository runs, named by the script that runs it, or the standard ' +
          'this method descends from where it declares none — with how a reader ' +
          'would check the work against it',
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
    lens: 'research',
    domains: ['evidence-provenance'],
    posture:
      'A claim is only as good as what it rests on and how plainly that is said: ' +
      'the job is naming the source, the kind of thing it is, and what it can ' +
      'and cannot support — never whether the claim feels right.',
    questions: [
      'For every claim the work relies on: what is the source, and is it the ' +
        'record itself, a derived record, an aggregator, or an inference? A ' +
        'summary of a record is not the record.',
      'Where a date, a status, or a name is asserted: what kind of date or ' +
        'status is it in the source (when the thing happened, when it was ' +
        'registered, when it was last checked), and does the claim assert the ' +
        'same kind? A date read as the wrong kind is a fabrication that passes ' +
        'every spelling check.',
      'Which claims rest on a single source, and which are corroborated by a ' +
        'source that could have disagreed? Two sources that copy one another ' +
        'are one source.',
      'What would a reader have to do to check this claim, and can they do it ' +
        'from what the work states?',
      'Which claims are inferences the work made rather than statements a ' +
        'source makes, and are they marked as inferences where they appear?',
      'What does the source not say that a reader would assume it does — ' +
        'silence read as confirmation is the most common way a record is ' +
        'misreported.',
    ],
    slots: [
      slot(
        'claim-provenance',
        'each load-bearing claim with its source, the class of that source ' +
          '(record, derived record, aggregator, inference), and what the source ' +
          'actually asserts as distinct from what the claim asserts',
      ),
      slot(
        'single-source-claims',
        'the claims resting on one source, each with whether an independent ' +
          'source could exist and where it would be looked for',
      ),
    ],
    escalation: [
      'A claim whose source cannot be reached or named: report it as unsupported rather than softening the wording until it passes.',
      'A source whose terms of use or licence are unclear for the intended use: route to the contracts concern before the claim is built on.',
    ],
    ceiling:
      'this lens judges whether a claim is traceable and correctly typed, never ' +
      'whether it is true — a claim citing the right record and misreading it ' +
      'passes here and is still wrong',
  },
  {
    lens: 'coverage',
    domains: ['coverage-gaps'],
    posture:
      'What a collection leaves out is a claim it makes without saying so: the ' +
      'job is naming the frame, the absences inside it, and which absences are ' +
      'the record being silent rather than the world being empty.',
    questions: [
      'What is the intended frame — the population, geography, or period this ' +
        'is meant to cover — and is it written down anywhere a reader can see?',
      'Where is the collection empty, and for each empty region: is that ' +
        'because nothing happened there, because nothing was recorded, or ' +
        'because nothing has been collected yet? Those three are ' +
        'indistinguishable to a reader and must not be to the work.',
      'Whose record is systematically thinner here, and does the collection ' +
        'method explain why? A method that reaches institutions reaches what ' +
        'institutions kept.',
      'What coverage does the surface imply to someone who reads it without ' +
        'reading the method, and is that implication true?',
      'What would have to be measured to state coverage as a number rather ' +
        'than as an impression, and does that measurement exist?',
    ],
    slots: [
      slot(
        'coverage-frame',
        'the intended frame in one sentence, and what falls outside it on purpose',
      ),
      slot(
        'absences',
        'each known absence, marked as not-recorded, not-yet-collected, or ' +
          'did-not-happen, with what distinguishes it',
      ),
    ],
    escalation: [
      'An absence that cannot be classified from the material: put it in the decision inbox as an open question, never as a coverage claim.',
      'A surface that implies completeness the collection does not have: raise it as a public-claim finding, not a documentation task.',
    ],
    ceiling:
      'this lens reports the shape of what is missing; it does not fill gaps, ' +
      'and an absence it cannot classify stays classified as unknown',
  },
  {
    lens: 'commerce',
    domains: ['commerce-tax'],
    posture:
      'Money that moves creates obligations at the moment it moves; the job is ' +
      'naming each obligation where it attaches, not after it has accrued.',
    questions: [
      'At every point money changes hands: which jurisdiction\'s tax obligation ' +
        'attaches, who computes it, and who remits it — the platform, the ' +
        'processor, or you?',
      'What does a pricing change do to money already committed: existing ' +
        'subscriptions, mid-cycle upgrades, proration, and anything a published ' +
        'price page promised that billing now contradicts?',
      'For refunds and chargebacks: what is promised where customers can read ' +
        'it, what does the billing system actually enforce, and who absorbs ' +
        'the fees when the two disagree?',
      'When is revenue earned versus collected here, and does anything report ' +
        'collected money as earned before the obligation behind it is met?',
      'What happens on payment failure — retries, access, dunning — and is that ' +
        'path a decision someone made or a processor default nobody read?',
    ],
    slots: [
      slot(
        'money-flow',
        'each point money moves: the obligation that attaches there, who ' +
          'computes it, who remits it, and what evidences it afterward',
      ),
    ],
    escalation: [
      'A tax obligation in a jurisdiction with no registration or filing owner: route to a licensed tax professional before anything relies on the finding.',
      'A promised refund term the billing system cannot enforce: put the ownership question in the decision inbox with both citations.',
    ],
    labeling: 'drafted for review by a licensed tax professional — never tax advice',
  },
  {
    lens: 'brand',
    domains: ['marketing-claims'],
    posture:
      'Every public sentence is a commitment; the question is never whether a ' +
      'claim sounds right but whether its evidence exists on the day it publishes.',
    questions: [
      'For each public claim this touches: what substantiation exists today — ' +
        'not planned, not in progress — and where is it recorded?',
      'For every superlative or comparative ("fastest", "only", "leading"): ' +
        'measured against whom, when, and would re-running the measurement ' +
        'today still support it?',
      'Which testimonials or endorsements are in play, are they typical rather ' +
        'than exceptional results, and is every material relationship disclosed?',
      'Which already-published claims does this change quietly falsify — a ' +
        'feature removed, a limit lowered, a roadmap item a landing page ' +
        'already sells?',
      'Which claims cross into regulated territory — security ("encrypted", ' +
        '"compliant"), health, financial outcomes — where the claim itself ' +
        'carries legal weight beyond marketing?',
    ],
    slots: [
      slot(
        'claims-inventory',
        'each public claim implicated: the substantiation that exists with its ' +
          'date, or [unsubstantiated] with who could either substantiate or ' +
          'pull the claim',
      ),
    ],
    escalation: [
      'An unsubstantiated claim already published: put it in the decision inbox naming who can substantiate it or pull it — silence leaves it running.',
      'A claim in regulated territory: route to licensed review; substantiation discipline is not a legal opinion.',
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

/** The lens that equips a domain, if any does. */
export function lensForDomain(domain: string): RoleLens | undefined {
  return LENSES.find((l) => l.domains.includes(domain));
}

/** A lens by its own name, for surfaces that consume lenses directly. */
export function lensByName(lens: string): RoleLens | undefined {
  return LENSES.find((l) => l.lens === lens);
}
