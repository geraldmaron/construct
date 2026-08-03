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
    ],
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
    ],
  },
  {
    path: 'contracts',
    domain: 'contracts',
    concern: 'agreements with other parties and what they bind you to',
    keywords: [
      'contract', 'vendor', 'supplier', 'nda', 'msa', 'sow', 'terms of service',
      'terms', 'licensing', 'license', 'agreement', 'procurement', 'renewal',
      'partner', 'reseller', 'sign', 'counterparty',
    ],
  },
  {
    path: 'employment',
    domain: 'employment',
    concern: 'people you engage and how you engage them',
    keywords: [
      'hiring', 'hire', 'employee', 'employees', 'contractor', 'contractors',
      'payroll', 'offer letter', 'termination', 'onboarding', 'freelancer',
      'intern', 'benefits', 'staff', 'recruiting', 'headcount',
    ],
  },
  {
    path: 'security',
    domain: 'security',
    concern: 'who can reach what, and what happens when that fails',
    keywords: [
      'security', 'authentication', 'login', 'password', 'credentials',
      'encryption', 'encrypt', 'breach', 'access control', 'permissions', 'vulnerability',
      'audit log', 'secrets', 'api keys', 'tokens', 'sso', 'two-factor',
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
  },
  {
    path: 'accessibility',
    domain: 'accessibility',
    concern: 'whether people with disabilities can actually use it',
    keywords: [
      'accessibility', 'wcag', 'screen reader', 'contrast', 'keyboard navigation',
      'alt text', 'a11y', 'disability', 'assistive',
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
    ],
  },
  {
    path: 'product-scoping',
    domain: 'product-scoping',
    concern: 'what is in, what is out, and how you know it worked',
    keywords: [
      'mvp', 'feature', 'features', 'requirements', 'scope', 'beta', 'pilot',
      'success metric', 'roadmap', 'prototype', 'users', 'customers', 'onboard',
      'redesign', 'rebuild',
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
    ],
  },
]);

/** The catalog keyed by domain name. */
export function domainsByName(
  catalog: readonly Domain[] = DOMAINS,
): ReadonlyMap<string, Domain> {
  return new Map(catalog.map((d) => [d.domain, d]));
}
