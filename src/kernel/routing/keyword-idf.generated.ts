/**
 * kernel/routing/keyword-idf.generated.ts — per-keyword IDF weight table
 * (construct-2jb.5).
 *
 * GENERATED. Do not hand-edit; regenerate with:
 *
 *   node scripts/generate-keyword-idf.mjs
 *
 * Computed once, offline, over the pooled UNSEALED corpus (labeled +
 * held-out + fresh + unspent, N = 126 outcomes) as of 2026-08-04. Weight is
 * IDF normalized against the IDF of a keyword firing 3 times
 * (ordinary catalog frequency keeps weight 1.0; only keywords firing MORE
 * often are discounted), floored at 0.2:
 *
 *   idf    = ln(N / fires)
 *   weight = clamp(idf / ln(N / 3), 0.2, 1.0)
 *
 * This is document frequency over outcome TEXT, not over labels — no ground
 * truth is consulted, so this is not fitting to the 83-label unspent corpus
 * the bead's DISPATCH note warned against; it is unsupervised corpus
 * vocabulary statistics, the same figure
 * scripts/measure-decisions.mjs --section 3 already prints. Never touches
 * tests/kernel/implication/fixtures/sealed-outcomes.json.
 *
 * A keyword absent from this table never fired on the pooled corpus: no
 * evidence exists to weight it, so `weightFor` returns the neutral 1.0
 * default rather than guessing.
 */

export const KEYWORD_IDF_WEIGHT: Readonly<Record<string, number>> = {
  "agreement": 1.0000, // fires 3/126, idf 3.738
  "analytics": 1.0000, // fires 1/126, idf 4.836
  "another customer": 1.0000, // fires 1/126, idf 4.836
  "api keys": 1.0000, // fires 1/126, idf 4.836
  "audit": 1.0000, // fires 2/126, idf 4.143
  "authentication": 1.0000, // fires 1/126, idf 4.836
  "beta": 1.0000, // fires 2/126, idf 4.143
  "blind": 1.0000, // fires 2/126, idf 4.143
  "by friday": 1.0000, // fires 1/126, idf 4.836
  "campaign": 1.0000, // fires 1/126, idf 4.836
  "charge": 1.0000, // fires 2/126, idf 4.143
  "charging": 1.0000, // fires 1/126, idf 4.836
  "checkout": 1.0000, // fires 3/126, idf 3.738
  "controls": 1.0000, // fires 1/126, idf 4.836
  "countries": 1.0000, // fires 2/126, idf 4.143
  "customer data": 1.0000, // fires 1/126, idf 4.836
  "customer list": 1.0000, // fires 1/126, idf 4.836
  "dashboard": 1.0000, // fires 2/126, idf 4.143
  "data subject": 1.0000, // fires 1/126, idf 4.836
  "delete everything": 1.0000, // fires 1/126, idf 4.836
  "discount": 1.0000, // fires 3/126, idf 3.738
  "distributor": 1.0000, // fires 1/126, idf 4.836
  "dollars": 1.0000, // fires 2/126, idf 4.143
  "employee": 1.0000, // fires 2/126, idf 4.143
  "employees": 1.0000, // fires 2/126, idf 4.143
  "encrypt": 1.0000, // fires 1/126, idf 4.836
  "eu": 1.0000, // fires 1/126, idf 4.836
  "euro": 1.0000, // fires 1/126, idf 4.836
  "europe": 1.0000, // fires 1/126, idf 4.836
  "european": 1.0000, // fires 1/126, idf 4.836
  "euros": 1.0000, // fires 1/126, idf 4.836
  "feature": 1.0000, // fires 1/126, idf 4.836
  "features": 1.0000, // fires 1/126, idf 4.836
  "find someone": 1.0000, // fires 1/126, idf 4.836
  "google account": 1.0000, // fires 2/126, idf 4.143
  "health data": 1.0000, // fires 1/126, idf 4.836
  "hipaa": 1.0000, // fires 1/126, idf 4.836
  "hiring": 1.0000, // fires 1/126, idf 4.836
  "hospital": 1.0000, // fires 2/126, idf 4.143
  "ids": 1.0000, // fires 1/126, idf 4.836
  "invoice": 1.0000, // fires 2/126, idf 4.143
  "launch": 1.0000, // fires 3/126, idf 3.738
  "let go": 1.0000, // fires 2/126, idf 4.143
  "license": 1.0000, // fires 1/126, idf 4.836
  "login": 1.0000, // fires 1/126, idf 4.836
  "mailing list": 1.0000, // fires 1/126, idf 4.836
  "marketing": 1.0000, // fires 1/126, idf 4.836
  "migrate": 1.0000, // fires 1/126, idf 4.836
  "milestone": 1.0000, // fires 1/126, idf 4.836
  "mouse": 1.0000, // fires 1/126, idf 4.836
  "newsletter": 1.0000, // fires 1/126, idf 4.836
  "next month": 1.0000, // fires 2/126, idf 4.143
  "next week": 1.0000, // fires 1/126, idf 4.836
  "onboard": 1.0000, // fires 1/126, idf 4.836
  "owe": 0.9230, // fires 4/126, idf 3.450
  "paid": 1.0000, // fires 2/126, idf 4.143
  "part time": 1.0000, // fires 2/126, idf 4.143
  "partner": 1.0000, // fires 1/126, idf 4.836
  "patient": 1.0000, // fires 3/126, idf 3.738
  "payroll": 1.0000, // fires 1/126, idf 4.836
  "phased": 1.0000, // fires 1/126, idf 4.836
  "pilot": 1.0000, // fires 2/126, idf 4.143
  "press release": 1.0000, // fires 2/126, idf 4.143
  "pricing": 1.0000, // fires 2/126, idf 4.143
  "quarter": 1.0000, // fires 3/126, idf 3.738
  "questionnaire": 1.0000, // fires 2/126, idf 4.143
  "rebuild": 1.0000, // fires 1/126, idf 4.836
  "redesign": 1.0000, // fires 1/126, idf 4.836
  "release": 1.0000, // fires 2/126, idf 4.143
  "renewal": 1.0000, // fires 1/126, idf 4.836
  "reseller": 1.0000, // fires 2/126, idf 4.143
  "rollout": 1.0000, // fires 1/126, idf 4.836
  "safer": 1.0000, // fires 1/126, idf 4.836
  "school": 0.9230, // fires 4/126, idf 3.450
  "screen reader": 1.0000, // fires 1/126, idf 4.836
  "security": 1.0000, // fires 2/126, idf 4.143
  "ship": 0.9230, // fires 4/126, idf 3.450
  "signed up": 1.0000, // fires 1/126, idf 4.836
  "signup": 1.0000, // fires 1/126, idf 4.836
  "soc 2": 1.0000, // fires 1/126, idf 4.836
  "spreadsheet": 1.0000, // fires 1/126, idf 4.836
  "sso": 1.0000, // fires 1/126, idf 4.836
  "staff": 0.9230, // fires 4/126, idf 3.450
  "students": 1.0000, // fires 2/126, idf 4.143
  "subscription": 1.0000, // fires 1/126, idf 4.836
  "supplier": 1.0000, // fires 1/126, idf 4.836
  "tax": 1.0000, // fires 2/126, idf 4.143
  "terms": 1.0000, // fires 3/126, idf 3.738
  "terms of service": 1.0000, // fires 1/126, idf 4.836
  "vendor": 1.0000, // fires 1/126, idf 4.836
  "weekend": 1.0000, // fires 1/126, idf 4.836
};

/** Neutral weight for a keyword with no measured document frequency. */
export const DEFAULT_WEIGHT = 1;

/** The weight for a keyword's exact text, case-insensitive. */
export function weightFor(keyword: string): number {
  return KEYWORD_IDF_WEIGHT[keyword.toLowerCase()] ?? DEFAULT_WEIGHT;
}
