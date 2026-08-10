/**
 * kernel/implication/domains.ts — the domain catalog: what each concern is,
 * when it is genuinely implicated, and when it only looks that way.
 *
 * This is the table that decides which invisible roles an outcome pulls in. It
 * is data, not logic, on purpose: adding a domain must never mean editing the
 * matcher, and the catalog is caller-replaceable so a workspace can carry its
 * own without forking the kernel.
 *
 * WHAT A DOMAIN IS, AND WHY IT IS NOT A BAG OF WORDS. A concern is a situation
 * in the world, not a vocabulary. "Legal should see this" is true because an
 * agreement is being made with somebody outside the organization, not because
 * the sentence contains that domain's own name — measured, the contracts
 * keyword fires five times and is right zero times (RESEARCH-DECISIONS.md §3).
 * So each domain
 * states the conditions under which it applies (`implicatedWhen`) and the near
 * misses that resemble it and are not it (`notImplicatedWhen`), in situational
 * language a non-expert would recognize. Those two lists are what the shipped
 * namer reasons over: a model reads the outcome against them and decides
 * whether the situation obtains. They are required rather than optional,
 * because a domain that omits them still routes — silently and worse — and
 * unmeasured surface area added quietly is the failure mode this catalog has
 * already been burned by once.
 *
 * The lists are also where precision is actually bought. Every exclusion here
 * was earned: the contracts keyword firing on nothing that bound anyone,
 * `before` firing on ordinary prose, `customers` earning product-scoping a seat
 * in runs about password storage. That knowledge used to live in comments
 * addressed to whoever next edited this file, which meant the namer — the thing
 * making the decision — never saw it.
 *
 * KEYWORDS ARE THE FALLBACK'S EVIDENCE, NOT THE DEFINITION. With no host
 * present there is no model to reason with, and the keyword map answers instead
 * so that recording an outcome stays free and offline. That path is measurably
 * the weaker one (miss 0.634 against 0.301 on wording its authors never saw,
 * §10), it is labeled as the fallback wherever it answers, and it is not what
 * the product claims. The signals lean toward the words a NON-EXPERT would
 * actually write, for the same reason the conditions do: a catalog keyed on
 * "data processing agreement" and not on "EU users" would only fire for someone
 * who already knew to say it, which is the failure this map exists to prevent.
 */

import type { Route } from '../routing/dispatcher.ts';

export interface Domain extends Route {
  readonly path: string;
  readonly domain: string;
  /** What this domain is responsible for noticing, in the user's words. */
  readonly concern: string;
  /**
   * The conditions under which this concern is genuinely implicated, each
   * stated as a situation rather than as a phrase to look for. A reader who
   * knows nothing about the domain should be able to check one against an
   * outcome and answer yes or no.
   */
  readonly implicatedWhen: readonly string[];
  /**
   * The near misses: situations that resemble this concern and are not it.
   * This is where over-implication is bought down, so an entry earns its place
   * by naming a confusion that has actually happened, not by being cautious.
   * Empty is allowed and honest where a domain has no known false friend.
   */
  readonly notImplicatedWhen: readonly string[];
  /** Signals for the zero-model fallback only. Never the definition. */
  readonly keywords: readonly string[];
  /**
   * The profession that must review this domain's output before anyone relies
   * on it. Construct issue-spots; it does not advise, and the domains where
   * that distinction has legal weight say so here rather than leaving it to a
   * disclaimer nobody reads (STRATEGY risk 3). Absent means no licensed review
   * is required — not that the output is authoritative.
   */
  readonly licensedReview?: string;
}

export const DOMAINS: readonly Domain[] = Object.freeze([
  {
    path: 'privacy',
    domain: 'privacy',
    concern: 'personal data, consent, and cross-border transfer',
    implicatedWhen: [
      'the work collects, stores, shares, or deletes information that identifies a living person — even when nobody calls it data (a customer list, patient records, a student roster, uploaded identity documents)',
      'a person or a regulator could ask what is held about them, or ask for it to be deleted',
      'information about people crosses an organizational or national boundary, including to a vendor, subprocessor, or analytics provider',
      'the people involved are ones the law treats as needing extra protection: children, patients, employees, or anyone whose health, biometric, or financial details are in scope',
    ],
    notImplicatedWhen: [
      'the only information involved describes systems, aggregate counts, or the organization\'s own business records, with no individual identifiable in them',
      'the word "data" refers to schemas, migrations, or storage engineering with no personal information in scope',
    ],
    keywords: [
      'gdpr', 'ccpa', 'personal data', 'user data', 'customer data', 'pii',
      'data subject', 'consent', 'privacy', 'data processing', 'eu', 'europe',
      'european', 'tracking', 'cookies', 'analytics', 'biometric', 'health data',
      'medical records', 'minors', 'children', 'age verification', 'retention',
      'hospital', 'patient', 'clinic', 'school', 'students', 'ids',
      'customer list', 'mailing list', 'subscribers', 'signed up',
      'delete everything', 'another customer',
    ],
    licensedReview: 'attorney',
  },
  {
    path: 'commerce-tax',
    domain: 'commerce-tax',
    concern: 'taking money: pricing, billing, tax, and refunds',
    implicatedWhen: [
      'money changes hands with someone outside the organization — charging, refunding, invoicing, or setting a price',
      'the terms on which money is taken change: the amount, the currency, the billing cadence, or who collects it',
      'money is taken in a place, or from a kind of buyer, the organization does not already sell to',
      'someone else sells or bills on the organization\'s behalf, or is paid a share',
    ],
    notImplicatedWhen: [
      'cost is discussed as internal spend, budget, or infrastructure bill, with nobody outside being charged',
      'revenue appears only as a number being reported or forecast, not as a charge being made or changed',
    ],
    keywords: [
      'paid', 'payment', 'payments', 'pricing', 'price', 'invoice', 'invoicing',
      'vat', 'sales tax', 'tax', 'subscription', 'billing', 'refund', 'refunds',
      'checkout', 'stripe', 'revenue', 'currency', 'monetize', 'charge',
      'purchase', 'ecommerce', 'storefront',
      'charging', 'euros', 'euro', 'dollars', 'owe', 'discount',
      'countries', 'distributor',
    ],
    licensedReview: 'tax professional',
  },
  {
    path: 'contracts',
    domain: 'contracts',
    concern: 'agreements with other parties and what they bind you to',
    implicatedWhen: [
      'the work creates, changes, renews, or ends a binding agreement with a party outside the organization',
      'it depends on somebody else\'s terms — a vendor, a platform, a library license, a reseller, a customer\'s paperwork',
      'a commitment is made to a counterparty that outlives the conversation making it: an obligation, a guarantee, a deadline somebody else is relying on',
      'a party is being brought in whose relationship is not yet papered at all',
    ],
    notImplicatedWhen: [
      '"terms" names product vocabulary, search terms, or a glossary rather than the terms of an agreement',
      'signing refers to authentication — single sign-on, signing in, a signing key — rather than to executing a document',
      'the agreement is internal between teams, with no external party bound',
    ],
    keywords: [
      'contract', 'vendor', 'supplier', 'nda', 'msa', 'sow', 'terms of service',
      'terms', 'licensing', 'license', 'agreement', 'procurement', 'renewal',
      'partner', 'reseller', 'counterparty',
    ],
    licensedReview: 'attorney',
  },
  {
    path: 'employment',
    domain: 'employment',
    concern: 'people you engage and how you engage them',
    implicatedWhen: [
      'somebody is engaged to do work, or stops being engaged — hired, contracted, brought on, let go — whatever the arrangement is called',
      'the terms of an existing engagement change: hours, classification, pay, duties, or where the person works from',
      'work is to be performed by a person in a place where the organization has no established footing for engaging anyone',
      'the distinction between an employee and a contractor is being assumed rather than decided',
    ],
    notImplicatedWhen: [
      'the people named are the organization\'s customers or users rather than the people it engages to work',
      '"roles" or "staff" refer to system roles, service accounts, or permissions rather than to people',
    ],
    keywords: [
      'hiring', 'hire', 'employee', 'employees', 'contractor', 'contractors',
      'payroll', 'offer letter', 'termination', 'onboarding', 'freelancer',
      'intern', 'benefits', 'staff', 'recruiting', 'headcount',
      'part time', 'full time', 'find someone', 'let go',
    ],
    licensedReview: 'attorney',
  },
  {
    path: 'security',
    domain: 'security',
    concern: 'who can reach what, and what happens when that fails',
    implicatedWhen: [
      'who can reach what changes — a new way in, a new credential, a widened permission, or a trust relationship with something outside',
      'a secret, key, token, or password is created, stored, moved, shared, or removed',
      'somebody could see or act on something that is not theirs, including by mistake — one customer seeing another\'s, a support tool that sees everything',
      'something has already gone wrong: an exposure, a leak, a suspicious access, a credential in the wrong place',
    ],
    notImplicatedWhen: [
      'permissions are named only as a product feature\'s own vocabulary, with no boundary changing about who can actually reach what',
    ],
    keywords: [
      'security', 'authentication', 'login', 'password', 'credentials',
      'encryption', 'encrypt', 'breach', 'access control', 'permissions', 'vulnerability',
      // "two factor" not "two-factor": keywords split on whitespace but
      // outcomes tokenize on non-alphanumeric, so a hyphenated keyword can
      // never match anything (found dead during corpus measurement).
      'audit log', 'secrets', 'api keys', 'tokens', 'sso', 'two factor',
      'another customer', 'another user', 'someone else', 'safer',
      'spreadsheet', 'google account', 'work account', 'microsoft account',
    ],
  },
  {
    path: 'compliance',
    domain: 'compliance',
    concern: 'certifications, audits, and regulator-facing obligations',
    implicatedWhen: [
      'an external framework, certification, or regulator sets requirements this work has to satisfy',
      'somebody outside will ask for evidence that a control actually operated — an auditor, a customer\'s security review, a regulator, a questionnaire',
      'a control that already exists is changed, bypassed, or newly relied on by something else',
      'the organization is claiming a certification, or is being asked to',
    ],
    notImplicatedWhen: [
      '"audit" means an informal internal review, or an audit log as a feature, with no external framework or party behind it',
      'the practice is good discipline that nobody is required to evidence to anyone',
    ],
    keywords: [
      'soc 2', 'iso 27001', 'hipaa', 'pci', 'audit', 'regulatory', 'regulation',
      'certification', 'compliance', 'attestation', 'controls', 'evidence',
      'questionnaire', 'due diligence',
    ],
    licensedReview: 'attorney',
  },
  {
    path: 'accessibility',
    domain: 'accessibility',
    concern: 'whether people with disabilities can actually use it',
    implicatedWhen: [
      'a person with a disability could be blocked from finishing the task — someone who cannot see, cannot hear, cannot use a mouse, or cannot hold several things in mind at once',
      'an interface is designed, changed, or removed, including small changes to color, contrast, focus, or motion',
      'content is delivered in one modality only: audio without captions, images carrying meaning without text, a flow that only works by pointing',
    ],
    notImplicatedWhen: [
      'nothing a person operates is involved — a batch job, an internal script, infrastructure with no interface',
    ],
    keywords: [
      'accessibility', 'wcag', 'screen reader', 'contrast', 'keyboard navigation',
      'alt text', 'a11y', 'disability', 'assistive',
      'blind', 'deaf', 'wheelchair', 'colorblind', 'low vision',
      'hard of hearing', 'captions', 'mouse',
    ],
  },
  {
    path: 'program-sequencing',
    domain: 'program-sequencing',
    concern: 'order, dependencies, and whether the date is real',
    implicatedWhen: [
      'the order matters — one piece has to land before another, or something is waiting on a party outside the team\'s control',
      'a date is being committed to, or an existing commitment is at risk',
      'the work is split into stages, phases, or a migration with a cutover, so there is a period where both old and new are live',
      'several people or teams have to move in a particular sequence for this to work at all',
    ],
    notImplicatedWhen: [
      'a date or a time word appears as ordinary background prose, with nothing being scheduled, ordered, or committed',
      '"release" names a version or a build rather than a scheduled event',
    ],
    keywords: [
      'deadline', 'milestone', 'launch', 'next month', 'next week', 'timeline',
      'rollout', 'schedule', 'phased', 'quarter', 'sequence', 'dependencies',
      'by friday', 'ship', 'release', 'migrate', 'migration', 'cutover',
      'weekend', 'before',
    ],
  },
  {
    path: 'product-scoping',
    domain: 'product-scoping',
    concern: 'what is in, what is out, and how you know it worked',
    implicatedWhen: [
      'what is in and what is out is being decided — something added, trimmed, deferred, or a first version defined',
      'a claim is being made about what the work will achieve that somebody will later want to check',
      'the request is broad enough that two people could build very different things from it',
    ],
    notImplicatedWhen: [
      'users or customers are named only as who the work is for. Who it is for is not evidence of what is in scope, and treating it as such earned this domain a seat in runs about password storage',
      'the work is an implementation detail of something whose scope is already settled',
    ],
    keywords: [
      'mvp', 'feature', 'features', 'requirements', 'scope', 'beta', 'pilot',
      'success metric', 'roadmap', 'prototype', 'onboard',
      'redesign', 'rebuild',
      'signup', 'dashboard',
    ],
  },
  {
    path: 'strategy-alignment',
    domain: 'strategy-alignment',
    concern: 'whether the bet is worth its price — what it displaces, what was already promised, and who owns the call',
    implicatedWhen: [
      'doing this means not doing something else, because the people, the money, or the quarter are finite',
      'it changes, delays, or contradicts a commitment already made — to a customer, to a team, or in public',
      'it is a bet whose payoff is uncertain while its cost is not',
      'nobody has said who owns the call, or two people believe they do',
    ],
    notImplicatedWhen: [
      'the choice is local and reversible, with nothing displaced and no commitment touched',
    ],
    keywords: [
      'strategy', 'strategic', 'okr', 'bet', 'priority', 'prioritize',
      'deprioritize', 'competitor', 'competitive', 'market', 'pivot', 'invest',
      'double down', 'sunset', 'trade-off', 'tradeoff', 'instead of',
      'worth it', 'focus on', 'stop doing',
    ],
  },
  {
    path: 'system-design',
    domain: 'system-design',
    concern: 'whether the shape of the system survives the change — boundaries, coupling, and what becomes hard to undo',
    implicatedWhen: [
      'the shape changes — a boundary moves, a new dependency appears, or two things that were separate become able to break each other',
      'something becomes expensive to undo: a data model, an interface others build on, a migration, a format written to disk',
      'the change is motivated by scale, cost, or the accumulated weight of earlier decisions rather than by a new capability',
      'a piece is being split out, replaced, or stood up beside an existing one',
    ],
    notImplicatedWhen: [
      'the change stays inside one existing boundary and nothing outside it could tell the difference',
    ],
    keywords: [
      'architecture', 'architectural', 'api design', 'schema', 'refactor',
      'scalability', 'scale', 'coupling', 'monolith', 'microservice',
      'microservices', 'platform', 'tech debt', 'technical debt',
      'breaking change', 'backward compatible', 'backwards compatible',
      'data model', 'integration',
      'rewrite', 'split out', 'replace the',
    ],
  },
  {
    path: 'operations',
    domain: 'operations',
    concern: 'what happens after it ships — who answers when it breaks, how you find out, and what it costs to keep alive',
    implicatedWhen: [
      'something new has to be kept alive after it ships — somebody answers for it, somebody has to find out when it stops working',
      'the way failure is noticed, escalated, or recovered from changes',
      'it adds ongoing draw on human attention rather than only build effort: a queue to watch, a thing to restart, a customer to answer',
      'it has already broken, or breaks in a way nobody currently sees',
    ],
    notImplicatedWhen: [
      'the work is one-off or has a defined end, after which nothing keeps running and nobody is on the hook',
    ],
    keywords: [
      'support', 'on-call', 'oncall', 'incident', 'outage', 'downtime', 'sla',
      'slo', 'runbook', 'rollback', 'monitoring', 'monitor', 'alerting',
      'alert', 'escalation', 'ticket', 'customer complaint', 'maintenance',
      'pager', 'postmortem', 'troubleshoot',
      'breaks', 'goes down', 'who fixes',
    ],
  },
  {
    path: 'user-experience',
    domain: 'user-experience',
    concern: 'whether people can find, understand, and finish what they came to do',
    implicatedWhen: [
      'a person has to find something, understand something, or finish something, and could fail at any of the three',
      'a flow gains a step, a decision, a wait, or a new way to end up stuck',
      'people are already reporting confusion, abandonment, or a workaround they invented themselves',
      'the words a person reads are being written or changed — labels, errors, empty states, confirmations',
    ],
    notImplicatedWhen: [
      'no person interacts with it directly, so there is no flow to complete or abandon',
    ],
    keywords: [
      'ux', 'user experience', 'usability', 'usable', 'wireframe', 'mockup',
      'user flow', 'navigation', 'empty state', 'error message', 'microcopy',
      'friction', 'confusing', 'confused', 'intuitive', 'drop off', 'drop-off',
      'user testing', 'click through',
      'cannot find', "can't find", 'too many steps', 'gave up',
    ],
  },
  {
    path: 'measurement',
    domain: 'measurement',
    concern: 'how you would know — whether the claim about behavior can be observed at all',
    implicatedWhen: [
      'a claim is being made about how people or systems will behave, and somebody will later want to know whether it came true',
      'success is asserted without saying what would be seen if it were true — or what would be seen if it were false',
      'a decision depends on a number nobody currently collects, or on one collected in a way that cannot support it',
      'two things are being compared, so the comparison needs a baseline that exists before the change',
    ],
    notImplicatedWhen: [
      'the outcome can be checked by looking at it once, rather than by observing behavior over time',
    ],
    keywords: [
      'metric', 'metrics', 'kpi', 'dashboard', 'funnel', 'conversion',
      'experiment', 'a/b test', 'ab test', 'retention', 'churn',
      'instrumentation', 'telemetry', 'data quality', 'success metric',
      'baseline', 'measure', 'track usage', 'analytics',
    ],
  },
  {
    path: 'marketing-claims',
    domain: 'marketing-claims',
    concern: 'what you say publicly and whether you can back it up',
    implicatedWhen: [
      'something is said publicly about what the product is, does, or is better than',
      'a claim is made that a competitor, a customer, or a regulator could dispute — a number, a comparison, a guarantee, an endorsement',
      'a message goes out to many people at once',
      'somebody else\'s name, words, or logo are being used',
    ],
    notImplicatedWhen: [
      'the audience is internal and the statement is not intended to be repeated outside',
    ],
    keywords: [
      'advertising', 'marketing', 'testimonial', 'endorsement', 'campaign',
      'landing page', 'press release', 'announcement', 'positioning', 'brand',
      'newsletter', 'social media',
      'send to everyone', 'signed up',
    ],
  },
]);

/** The catalog keyed by domain name. */
export function domainsByName(
  catalog: readonly Domain[] = DOMAINS,
): ReadonlyMap<string, Domain> {
  return new Map(catalog.map((d) => [d.domain, d]));
}
