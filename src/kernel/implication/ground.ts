/**
 * kernel/implication/ground.ts — seats that live in visible documents, not
 * in a keyword map over the user's sentence.
 *
 * First-run may add domains the host did not name when a document Construct
 * can already see is itself that domain's ground: its path, filename, or
 * first heading names a catalog domain. This is identity, not stemming —
 * a file named contractor-agreement does not become contracts, which is
 * the miss the keyword map already makes on "hire a contractor".
 */

import { DOMAINS, domainsByName } from './domains.ts';
import type { Domain } from './domains.ts';
import type { Implication } from './map.ts';

/** A document already on disk (or already extracted) that a run may seat from. */
export interface GroundDocument {
  readonly path: string;
  /** First Markdown/text heading, when the walker read one. */
  readonly title?: string;
}

const NO_KEYWORD_SCORE = 0;

/** Signal written on a ground-seated implication so the record cites the file. */
export function groundSignal(filePath: string): string {
  return `visible document: ${filePath}`;
}

/**
 * Whether this path or title names a catalog domain as an identity, not a stem.
 *
 * A path segment or filename stem that equals the domain seats it. A
 * hyphenated stem that starts or ends with the domain (`privacy-policy`,
 * `cross-border-privacy`) also seats it. Tokens that merely share a prefix
 * (`contractor` vs `contracts`) do not.
 */
export function pathNamesDomain(filePath: string, domain: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const wanted = domain.toLowerCase();
  for (const part of normalized.split('/')) {
    if (part.length === 0) continue;
    const stem = part.includes('.') ? part.slice(0, part.lastIndexOf('.')) : part;
    if (stem === wanted) return true;
    if (stem.startsWith(`${wanted}-`) || stem.endsWith(`-${wanted}`)) return true;
  }
  return false;
}

/** A heading that is the domain name, optionally with a short qualifier after a colon or hyphen. */
export function titleNamesDomain(title: string, domain: string): boolean {
  const trimmed = title.trim().toLowerCase();
  const wanted = domain.toLowerCase();
  if (trimmed === wanted) return true;
  const head = trimmed.split(/[:—–-]/, 1)[0]?.trim() ?? '';
  return head === wanted;
}

/**
 * Domains seated only by what the documents are, in catalog order.
 * The user's sentence is not scored here.
 */
export function seatFromVisibleGround(input: {
  readonly documents: readonly GroundDocument[];
  readonly catalog?: readonly Domain[];
}): Implication[] {
  const catalog = input.catalog ?? DOMAINS;
  const byName = domainsByName(catalog);
  const seated = new Map<string, Implication>();

  for (const domain of catalog) {
    if (!byName.has(domain.domain)) continue;
    for (const document of input.documents) {
      const byPath = pathNamesDomain(document.path, domain.domain);
      const byTitle =
        document.title !== undefined && titleNamesDomain(document.title, domain.domain);
      if (!byPath && !byTitle) continue;
      const existing = seated.get(domain.domain);
      const signal = groundSignal(document.path);
      if (existing) {
        if (!existing.signals.includes(signal)) {
          seated.set(domain.domain, {
            ...existing,
            signals: [...existing.signals, signal],
          });
        }
        continue;
      }
      seated.set(domain.domain, {
        domain: domain.domain,
        concern: domain.concern,
        score: NO_KEYWORD_SCORE,
        signals: [signal],
      });
    }
  }

  return catalog.filter((d) => seated.has(d.domain)).map((d) => seated.get(d.domain)!);
}

/** Host-admitted seats first; ground seats the host did not name follow. */
export function mergeSeats(
  hostNamed: readonly Implication[],
  ground: readonly Implication[],
): Implication[] {
  const seen = new Set(hostNamed.map((row) => row.domain));
  const extra = ground.filter((row) => !seen.has(row.domain));
  return [...hostNamed, ...extra];
}
