/**
 * kernel/implication/domains.ts — the domain catalog the implication map scores
 * against.
 *
 * This is the table that decides which invisible roles an outcome pulls in. It
 * is data, not logic, on purpose: adding a domain must never mean editing the
 * matcher, and the catalog is caller-replaceable so a workspace can carry its
 * own without forking the kernel.
 *
 * Each domain is expressed as a routing `Route`, so scoring reuses the harvested
 * dispatcher rather than growing a second matcher for the same job.
 *
 * The signals lean toward the words a NON-EXPERT would actually write. The whole
 * promise is that a user never has to know a domain exists — a catalog keyed on
 * "data processing agreement" and not on "EU users" would only fire for someone
 * who already knew to say it, which is the failure this map exists to prevent.
 */

import type { Route } from '../routing/dispatcher.ts';

export interface Domain extends Route {
  readonly path: string;
  readonly domain: string;
  /** What this domain is responsible for noticing, in the user's words. */
  readonly concern: string;
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
    keywords: [
      'gdpr', 'ccpa', 'personal data', 'user data', 'customer data', 'pii',
      'data subject', 'consent', 'privacy', 'data processing', 'eu', 'europe',
      'european', 'tracking', 'cookies', 'analytics', 'biometric', 'health data',
      'medical records', 'minors', 'children', 'age verification', 'retention',
      // Situations that carry personal data without anyone saying "data":
      // a hospital or school as counterparty, a person's identity documents,
      // a list of people you can contact, a request to erase someone.
      'hospital', 'patient', 'clinic', 'school', 'students', 'ids',
      'customer list', 'mailing list', 'subscribers', 'signed up',
      'delete everything', 'another customer',
      // "shares telemetry" is the phrasing a platform team uses when device
      // or product signals leave to someone else's system ("shares telemetry
      // with a customer's third-party EDR vendor") — privacy's personal-data
      // list alone missed it (labeled-outcomes.json o21, measured 2026-08-28).
      // Checked against every corpus fixture: the phrase appears in none of
      // the other labeled, held-out, fresh, or unspent outcomes. Bare
      // "telemetry" stays measurement's keyword; this phrase is the sharing.
      'shares telemetry',
    ],
    licensedReview: 'attorney',
  },
  {
    path: 'commerce-tax',
    domain: 'commerce-tax',
    concern: 'taking money: pricing, billing, tax, and refunds',
    keywords: [
      'paid', 'payment', 'payments', 'pricing', 'price', 'invoice', 'invoicing',
      'vat', 'sales tax', 'tax', 'subscription', 'billing', 'refund', 'refunds',
      'checkout', 'stripe', 'revenue', 'currency', 'monetize', 'charge',
      'purchase', 'ecommerce', 'storefront',
      // How people actually talk about money changing hands: naming the
      // currency, what is owed, price concessions, selling through someone,
      // selling into more places. ("charging" is separate because the matcher's
      // stem-prefix cannot reach it from "charge".)
      'charging', 'euros', 'euro', 'dollars', 'owe', 'discount',
      'countries', 'distributor',
    ],
    licensedReview: 'tax professional',
  },
  {
    path: 'contracts',
    domain: 'contracts',
    concern: 'agreements with other parties and what they bind you to',
    // "sign" is deliberately absent: it fired this domain on "single sign-on"
    // and "sign in", and a signal that gets cited as evidence for the wrong
    // inference is worse than a lower score. Signing language
    // always travels with the thing being signed — the agreement, the terms —
    // and those keywords carry the match honestly.
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
    keywords: [
      'hiring', 'hire', 'employee', 'employees', 'contractor', 'contractors',
      'payroll', 'offer letter', 'termination', 'onboarding', 'freelancer',
      'intern', 'benefits', 'staff', 'recruiting', 'headcount',
      // Engaging people without HR words: how much of their time, finding a
      // person for a duty, ending an engagement.
      'part time', 'full time', 'find someone', 'let go',
    ],
    licensedReview: 'attorney',
  },
  {
    path: 'security',
    domain: 'security',
    concern: 'who can reach what, and what happens when that fails',
    keywords: [
      'security', 'authentication', 'login', 'password', 'credentials',
      'encryption', 'encrypt', 'breach', 'access control', 'permissions', 'vulnerability',
      // "network access" is the phrasing a platform team actually uses for a
      // gating decision ("before allowing network access") — "access
      // control" alone missed it (see labeled-outcomes.json o21, added from a
      // real dispatch measured 2026-08-28). Checked against every corpus
      // fixture: the phrase appears in none of the other labeled, held-out,
      // fresh, or unspent outcomes, so this closes the one confirmed miss
      // without a measured over-rate cost.
      'network access',
      // "two factor" not "two-factor": keywords split on whitespace but
      // outcomes tokenize on non-alphanumeric, so a hyphenated keyword can
      // never match anything (found dead during corpus measurement).
      'audit log', 'secrets', 'api keys', 'tokens', 'sso', 'two factor',
      // How non-experts report or ask for security: seeing someone else's
      // things, wanting something kept somewhere safer, sensitive records
      // living in a spreadsheet, signing in with an existing account.
      'another customer', 'another user', 'someone else', 'safer',
      'spreadsheet', 'google account', 'work account', 'microsoft account',
    ],
  },
  {
    path: 'compliance',
    domain: 'compliance',
    concern: 'certifications, audits, and regulator-facing obligations',
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
    keywords: [
      'accessibility', 'wcag', 'screen reader', 'contrast', 'keyboard navigation',
      'alt text', 'a11y', 'disability', 'assistive',
      // People describe who is excluded, not the standard that covers them:
      // blind users, deaf users, someone who cannot use a mouse.
      'blind', 'deaf', 'wheelchair', 'colorblind', 'low vision',
      'hard of hearing', 'captions', 'mouse',
    ],
  },
  {
    path: 'program-sequencing',
    domain: 'program-sequencing',
    concern: 'order, dependencies, and whether the date is real',
    keywords: [
      'deadline', 'milestone', 'launch', 'next month', 'next week', 'timeline',
      'rollout', 'schedule', 'phased', 'quarter', 'sequence', 'dependencies',
      'by friday', 'ship', 'release', 'migrate', 'migration', 'cutover',
      // Ordinary date and ordering language: doing it over a weekend, doing
      // one thing before another.
      'weekend', 'before',
    ],
  },
  {
    path: 'product-scoping',
    domain: 'product-scoping',
    concern: 'what is in, what is out, and how you know it worked',
    // "users" and "customers" are deliberately absent. They appear in almost
    // any sentence a business writes, so they earned this domain a seat in runs
    // that had nothing to do with scope — "encrypt customer passwords" pulled in
    // product-scoping on the word "customer" alone. Removing them cut the
    // over-rate on the held-out set from 0.245 to 0.140 and cost exactly one
    // labeled-set match, o14, which was resting on that same weak word
    //. Who the work is for is not evidence of what is in scope.
    keywords: [
      'mvp', 'feature', 'features', 'requirements', 'scope', 'beta', 'pilot',
      'success metric', 'roadmap', 'prototype', 'onboard',
      'redesign', 'rebuild',
      // The product surfaces people name when scoping what to build or trim.
      'signup', 'dashboard',
    ],
  },
  {
    path: 'strategy-alignment',
    domain: 'strategy-alignment',
    concern: 'whether the bet is worth its price — what it displaces, what was already promised, and who owns the call',
    keywords: [
      'strategy', 'strategic', 'okr', 'bet', 'priority', 'prioritize',
      'deprioritize', 'competitor', 'competitive', 'market', 'pivot', 'invest',
      'double down', 'sunset', 'trade-off', 'tradeoff', 'instead of',
      // The plain words a leader uses when the real question is what gets
      // dropped to pay for this.
      'worth it', 'focus on', 'stop doing',
    ],
  },
  {
    path: 'system-design',
    domain: 'system-design',
    concern: 'whether the shape of the system survives the change — boundaries, coupling, and what becomes hard to undo',
    keywords: [
      'architecture', 'architectural', 'api design', 'schema', 'refactor',
      'scalability', 'scale', 'coupling', 'monolith', 'microservice',
      'microservices', 'platform', 'tech debt', 'technical debt',
      'breaking change', 'backward compatible', 'backwards compatible',
      'data model', 'integration',
      // Ordinary words for the same worry: rebuilding a piece, splitting
      // something apart, or standing a new service next to an old one.
      'rewrite', 'split out', 'replace the',
    ],
  },
  {
    path: 'operations',
    domain: 'operations',
    concern: 'what happens after it ships — who answers when it breaks, how you find out, and what it costs to keep alive',
    keywords: [
      'support', 'on-call', 'oncall', 'incident', 'outage', 'downtime', 'sla',
      'slo', 'runbook', 'rollback', 'monitoring', 'monitor', 'alerting',
      'alert', 'escalation', 'ticket', 'customer complaint', 'maintenance',
      'pager', 'postmortem', 'troubleshoot',
      // What a non-expert says instead: it broke, who fixes it, at night.
      'breaks', 'goes down', 'who fixes',
    ],
  },
  {
    path: 'user-experience',
    domain: 'user-experience',
    concern: 'whether people can find, understand, and finish what they came to do',
    // "design" and "onboarding" are deliberately absent. "design" fires on any
    // architecture sentence, and "onboarding" already earns employment (hiring)
    // and product-scoping (onboard) — a third claimant on an ambiguous word
    // buys over-fires without buying a finding.
    keywords: [
      'ux', 'user experience', 'usability', 'usable', 'wireframe', 'mockup',
      'user flow', 'navigation', 'empty state', 'error message', 'microcopy',
      'friction', 'confusing', 'confused', 'intuitive', 'drop off', 'drop-off',
      'user testing', 'click through',
      // How a user reports the same problem without the vocabulary.
      'cannot find', "can't find", 'too many steps', 'gave up',
    ],
  },
  {
    path: 'measurement',
    domain: 'measurement',
    concern: 'how you would know — whether the claim about behavior can be observed at all',
    // The words a non-expert writes when they are already thinking about
    // numbers. "success metric" is deliberately shared with product-scoping:
    // a sentence that names one is asking both what the promise is and
    // whether anyone can check it, and both roles should answer.
    keywords: [
      'metric', 'metrics', 'kpi', 'dashboard', 'funnel', 'conversion',
      'experiment', 'a/b test', 'ab test', 'retention', 'churn',
      'instrumentation', 'telemetry', 'data quality', 'success metric',
      'baseline', 'measure', 'measurement', 'track usage', 'analytics',

    ],
  },
  {
    path: 'evidence-provenance',
    domain: 'evidence-provenance',
    concern: 'where a claim comes from, what kind of source that is, and whether a reader can check it',
    // The words people use when the work turns on somebody else's record.
    // Deliberately not the words of measurement: an instrumented product
    // measures its own behavior, and this domain is about material the work
    // did not produce and cannot re-run.
    keywords: [
      'archive', 'archives', 'archival', 'source', 'sources', 'citation', 'cite',
      'provenance', 'primary source', 'secondary source', 'attribution',
      'catalog', 'catalogue', 'corpus', 'dataset', 'records', 'record',
      'transcript', 'transcription', 'oral history', 'aggregate', 'aggregator',
      'scrape', 'scraped', 'ingest', 'digitize', 'digitise', 'metadata',
      'footnote', 'bibliography', 'evidence', 'verify', 'fact check',
      'fact-check', 'historical', 'history', 'genealogy', 'census',
    ],
  },
  {
    path: 'coverage-gaps',
    domain: 'coverage-gaps',
    concern: 'what is missing from the record, and whether its absence is a finding or a bias',
    // The boundary against evidence-provenance, which the lens entries repeat:
    // provenance asks whether what is said is traceable, and coverage asks
    // whether what is unsaid is a bias. A blank region on a map and a claim
    // with no footnote are different defects with different remedies.
    keywords: [
      'coverage', 'gap', 'gaps', 'missing', 'incomplete', 'completeness',
      'representative', 'representation', 'underrepresented', 'sample',
      'sampling', 'sampling frame', 'blind spot', 'blank', 'sparse',
      'nationwide', 'comprehensive', 'every', 'all of them', 'exhaustive',
      'map of', 'directory of', 'index of', 'inventory',
    ],
  },
  {
    path: 'marketing-claims',
    domain: 'marketing-claims',
    concern: 'what you say publicly and whether you can back it up',
    keywords: [
      'advertising', 'marketing', 'testimonial', 'endorsement', 'campaign',
      'landing page', 'press release', 'announcement', 'positioning', 'brand',
      'newsletter', 'social media',
      // Mass outreach in plain words: contacting everyone on your list.
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
