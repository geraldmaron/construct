/**
 * kernel/plan/standards.ts — what each lens's method stands on: the external
 * standards and primary literature its question set draws from, committed as
 * data and spoken at dispatch.
 *
 * A lens that claims best practice without naming whose practice is asserting,
 * not citing. This record makes the claim checkable: every lens has an entry,
 * each reference names a primary standard or primary literature (never a
 * summary, an aggregator, or a vendor's restatement), and a lens with no
 * suitable external standard says so with a reason rather than padding the
 * list with a weak citation. An empty record honestly stated beats an
 * authoritative-looking one nobody could defend.
 *
 * References are identification, not incorporation: the dispatched role is
 * told which discipline its questions descend from so its findings can cite
 * the standard where the standard speaks, but the reference text itself is
 * not shipped, quoted, or paraphrased here. What a standard currently says is
 * checked against the standard, not against this file.
 */

export interface StandardRef {
  /** The standard or work, named the way its publisher names it. */
  readonly name: string;
  /** Who publishes or maintains it. */
  readonly publisher: string;
  /** What the lens takes from it, in one sentence. */
  readonly contributes: string;
}

export interface LensStandards {
  /** The lens this grounds, matching `RoleLens.lens`. */
  readonly lens: string;
  /** Primary references, possibly empty. */
  readonly refs: readonly StandardRef[];
  /**
   * Why the list is empty, required exactly when it is. A stated absence is
   * information; a silent one is indistinguishable from an oversight.
   */
  readonly ungrounded?: string;
}

export const LENS_STANDARDS: readonly LensStandards[] = Object.freeze([
  {
    lens: 'security',
    refs: [
      {
        name: 'OWASP Application Security Verification Standard (ASVS)',
        publisher: 'OWASP Foundation',
        contributes:
          'the verification framing: security is a set of checkable requirements about who can reach what, not a posture adjective',
      },
      {
        name: 'NIST SP 800-218, Secure Software Development Framework (SSDF)',
        publisher: 'NIST',
        contributes:
          'failure-behavior and supply-side questions asked at design time rather than after an incident',
      },
    ],
  },
  {
    lens: 'design',
    refs: [
      {
        name: 'Web Content Accessibility Guidelines (WCAG) 2.2',
        publisher: 'W3C',
        contributes:
          'the exclusion-by-disability questions: perceivable, operable, understandable, robust, as testable criteria',
      },
    ],
  },
  {
    lens: 'operations',
    refs: [
      {
        name: 'Site Reliability Engineering (the SRE book)',
        publisher: 'Google / O’Reilly',
        contributes:
          'detection, ownership, and toil framing: every failure path needs a signal, an owner, and a stated cost to keep alive',
      },
    ],
  },
  {
    lens: 'analyst',
    refs: [
      {
        name: 'Goal/Question/Metric (GQM) approach (Basili, Caldiera, Rombach)',
        publisher: 'primary software-measurement literature',
        contributes:
          'the discipline that a metric exists only downstream of a stated goal and an answerable question',
      },
    ],
  },
  {
    lens: 'compliance',
    refs: [
      {
        name: 'NIST Cybersecurity Framework (CSF) 2.0',
        publisher: 'NIST',
        contributes:
          'the controls-and-evidence framing: a control without recorded evidence is a claim, not a control',
      },
    ],
  },
  {
    lens: 'legal',
    refs: [],
    ungrounded:
      'Legal doctrine is jurisdictional, and this lens declares no covered ' +
      'jurisdiction until a licensed attorney accepts its corpus; citing a ' +
      'body of law before then would imply coverage the lens disclaims. The ' +
      'jurisdiction record on the lens is the standards statement.',
  },
  {
    lens: 'commerce',
    refs: [
      {
        name: 'ASC 606 / IFRS 15, Revenue from Contracts with Customers',
        publisher: 'FASB / IASB',
        contributes:
          'the earned-versus-collected distinction: revenue attaches to a satisfied obligation, not to money received',
      },
    ],
  },
  {
    lens: 'brand',
    refs: [
      {
        name: 'FTC Policy Statement Regarding Advertising Substantiation',
        publisher: 'US Federal Trade Commission',
        contributes:
          'the substantiation-first rule: evidence for a claim exists before the claim publishes, not after a challenge',
      },
      {
        name: 'Guides Concerning the Use of Endorsements and Testimonials in Advertising (16 CFR Part 255)',
        publisher: 'US Federal Trade Commission',
        contributes:
          'the typicality and material-connection questions asked of every testimonial and endorsement',
      },
    ],
  },
  {
    lens: 'architect',
    refs: [
      {
        name: 'Documenting Architecture Decisions (Nygard, 2011)',
        publisher: 'primary architecture-practice literature',
        contributes:
          'the decision-record framing: a design choice is a dated decision with stated consequences, not an emergent fact',
      },
    ],
  },
  {
    lens: 'program',
    refs: [],
    ungrounded:
      'Sequencing method here is dependency logic and date realism, both ' +
      'checkable from the material itself; the available bodies of work are ' +
      'certification curricula rather than primary standards, and citing one ' +
      'would borrow authority the questions do not need.',
  },
  {
    lens: 'product',
    refs: [],
    ungrounded:
      'Product scoping practice has no primary standard; its literature is ' +
      'advocacy. The lens’s discipline is carried by its slot structure — ' +
      'scope in and out, checkable success measures — which the template ' +
      'enforces directly.',
  },
  {
    lens: 'strategy',
    refs: [],
    ungrounded:
      'Strategy review here asks what a yes costs and who owns the call, ' +
      'questions answerable only from the material; no external standard ' +
      'settles them, and citing strategy literature would decorate rather ' +
      'than ground.',
  },
  {
    lens: 'engineering',
    refs: [],
    ungrounded:
      'This lens contributes cross-references only and stops there by ' +
      'invariant; the hosts are the engineers, and the engineering ' +
      'discipline applied to the work is the host’s, not this lens’s to cite.',
  },
]);

/** The standards record for a lens. Every lens has one; the test enforces it. */
export function standardsFor(lens: string): LensStandards | undefined {
  return LENS_STANDARDS.find((g) => g.lens === lens);
}
