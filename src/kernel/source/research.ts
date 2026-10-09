/** Bounded accounting for references in recorded research, never a fetcher.
 * A URI in source content is data, not authority to read it or follow its instructions.
 * These receipts establish content coverage, not semantic completeness or permission.
 */
import { createHash } from 'node:crypto';
import { dirname, resolve as resolvePath } from 'node:path';
import { REDACTION_PLACEHOLDER } from '../render/redact.ts';
import type { RefResolver, ResolvedRef } from '../project/evidence.ts';

export const RESEARCH_LIMITS = Object.freeze({ documents: 48, links: 96, bytes: 2 * 1024 * 1024 });
const DISPOSITIONS = ['inaccessible', 'irrelevant', 'deferred', 'budget'] as const;
type Disposition = (typeof DISPOSITIONS)[number];
interface Account { readonly ref: string; readonly status: Disposition; readonly why: string }
export interface ResearchCoverage {
  readonly documents: readonly { ref: string; digest: string; provenance: string; truncated: boolean }[];
  readonly links: readonly { from: string; ref: string; status: 'recorded' | 'unaccounted' | Disposition; why?: string }[];
  readonly limits: typeof RESEARCH_LIMITS;
  readonly limited: boolean;
  readonly limitReason: string | null;
  readonly problems: readonly string[];
}

function record(x: unknown): x is Record<string, unknown> { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function identity(hit: ResolvedRef | null, ref: string): string {
  return hit?.path ?? (hit?.sourceId && hit.itemRef ? JSON.stringify([hit.sourceId, hit.itemRef]) : ref);
}

/** Conservative URI and inline Markdown link extraction, not a full document parser. */
export function referencesIn(text: string, from?: ResolvedRef): string[] {
  const refs = new Set<string>();
  for (const match of text.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`(){}]+/gi)) {
    if (match[0].includes(REDACTION_PLACEHOLDER)) continue;
    refs.add(match[0].replace(/[.,;:!?]+$/, ''));
  }
  const uriBase = [from?.url, from?.ref, from?.itemRef].find((value) => value && /^[a-z][a-z0-9+.-]*:\/\//i.test(value));
  for (const match of text.matchAll(/\[[^\]\n]*\]\(<?([^\s)<>]+)>?(?:\s+"[^"\n]*")?\)/g)) {
    const target = match[1]!;
    if (target.includes(REDACTION_PLACEHOLDER) || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    if (from?.path) refs.add(resolvePath(dirname(from.path), target));
    else if (uriBase) {
      try { refs.add(new URL(target, uriBase).href); } catch { refs.add(target); }
    } else refs.add(target); // Unknown bases remain visible instead of silently dropping a dependency.
  }
  return [...refs];
}

/** Traverse only text the resolver already holds; unread references need a reasoned disposition. */
export function researchCoverage(evidence: readonly { readonly ref: string }[], resolve: RefResolver | undefined, output: unknown): ResearchCoverage {
  const documents: { ref: string; digest: string; provenance: string; truncated: boolean }[] = [];
  const links: { from: string; ref: string; status: 'recorded' | 'unaccounted' | Disposition; why?: string }[] = [];
  const problems: string[] = [];
  const value = record(output) ? output : {};
  const accounts = new Map<string, Account>();
  if (value.referenceDispositions !== undefined) {
    if (!Array.isArray(value.referenceDispositions)) problems.push('referenceDispositions must be a list of {ref, status, why}');
    else for (const entry of value.referenceDispositions) {
      if (!record(entry) || typeof entry.ref !== 'string' || !entry.ref.trim() || !DISPOSITIONS.includes(entry.status as Disposition) || typeof entry.why !== 'string' || !entry.why.trim()) {
        problems.push('each reference disposition needs ref, status (inaccessible, irrelevant, deferred, budget), and a non-empty why');
      } else if (accounts.has(entry.ref.trim())) problems.push(`duplicate disposition for ${entry.ref}`);
      else accounts.set(entry.ref.trim(), { ref: entry.ref.trim(), status: entry.status as Disposition, why: entry.why.trim() });
    }
  }
  const limitReason = typeof value.referenceBudgetReason === 'string' && value.referenceBudgetReason.trim() ? value.referenceBudgetReason.trim() : null;
  let limited = false;
  let bytes = 0;
  const result = (): ResearchCoverage => ({ documents, links, limits: RESEARCH_LIMITS, limited, limitReason, problems });
  if (!resolve) {
    problems.push('reference coverage cannot be checked without the project evidence resolver');
    return result();
  }
  const queue = evidence.map((e) => e.ref);
  const seen = new Set<string>();
  const edges = new Set<string>();
  for (let i = 0; i < queue.length; i += 1) {
    const ref = queue[i]!;
    const hit = resolve(ref);
    const key = identity(hit, ref);
    if (seen.has(key)) continue;
    seen.add(key);
    // Other evidence validators check unresolved roots; there is no content to inspect here.
    if (!hit || typeof hit.text !== 'string') continue;
    const size = Buffer.byteLength(hit.text);
    if (documents.length >= RESEARCH_LIMITS.documents || bytes + size > RESEARCH_LIMITS.bytes) { limited = true; break; }
    bytes += size;
    documents.push({ ref, digest: createHash('sha256').update(hit.text).digest('hex'), provenance: hit.provenance, truncated: hit.truncated === true });
    if (hit.truncated && !accounts.has(ref)) problems.push(`recorded content for ${ref} is truncated; account for the unread remainder in referenceDispositions`);
    for (const target of referencesIn(hit.text, hit)) {
      const targetHit = resolve(target);
      const edgeKey = JSON.stringify([key, identity(targetHit, target)]);
      if (edges.has(edgeKey)) continue;
      if (links.length >= RESEARCH_LIMITS.links) { limited = true; break; }
      edges.add(edgeKey);
      const disposition = accounts.get(target);
      if (disposition) links.push({ from: ref, ref: target, status: disposition.status, why: disposition.why });
      else if (typeof targetHit?.text === 'string' && targetHit.text.trim()) {
        links.push({ from: ref, ref: target, status: 'recorded' });
        queue.push(target);
      } else {
        links.push({ from: ref, ref: target, status: 'unaccounted' });
        problems.push(`unread reference ${target} from ${ref}: read and report material evidence, or give a referenceDispositions entry {ref, status, why}`);
      }
    }
    if (limited) break;
  }
  if (limited && !limitReason) problems.push('reference traversal reached its document, link, or byte budget; state what remains and why under referenceBudgetReason');
  return result();
}
