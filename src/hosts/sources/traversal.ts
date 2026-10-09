/** Bounded host traversal. The adapter owns authorization and I/O; source text owns neither. */
import { createHash } from 'node:crypto';
import { referencesIn, RESEARCH_LIMITS } from '../../kernel/source/research.ts';
import type { ResolvedRef } from '../../kernel/project/evidence.ts';
import { redact } from '../../kernel/render/redact.ts';

export interface TraversalAdapter {
  /** The host's configured policy, evaluated before every read, including redirects. */
  authorize(ref: string, from: string | null): Promise<{ allowed: boolean; reason: string }> | { allowed: boolean; reason: string };
  /** Adapter must bound bytes/time and reauthorize any redirect; no credential material in returned text. */
  read(ref: string, options: { signal: AbortSignal; maxBytes: number }): Promise<{ outcome: 'read'; document: ResolvedRef; operation: string; principal: string; sessionId: string; scope: string; expiresAt: string } | { outcome: 'denied' | 'missing' | 'unreachable'; reason: string }>;
  /** Optional host decision based on the requested outcome, never an instruction from source content. */
  relevant?(ref: string, from: string | null): { relevant: boolean; reason: string };
}
export async function traverseReferences(input: { roots: readonly string[]; adapter: TraversalAdapter; maxDocuments?: number; maxLinks?: number; maxBytes?: number; timeoutMs?: number; now: () => string }) {
  const documentsLimit = input.maxDocuments ?? RESEARCH_LIMITS.documents, linksLimit = input.maxLinks ?? RESEARCH_LIMITS.links, bytesLimit = input.maxBytes ?? RESEARCH_LIMITS.bytes, timeoutMs = input.timeoutMs ?? 30_000;
  if (![documentsLimit, linksLimit, bytesLimit, timeoutMs].every((n) => Number.isSafeInteger(n) && n > 0) || documentsLimit > RESEARCH_LIMITS.documents || linksLimit > RESEARCH_LIMITS.links || bytesLimit > RESEARCH_LIMITS.bytes || timeoutMs > 120_000 || input.roots.length > linksLimit) throw new Error('traversal limits must fit the bounded research envelope');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const bounded = async <T>(operation: Promise<T> | T): Promise<T> => {
    if (controller.signal.aborted) throw new Error('traversal deadline reached');
    let stop: (() => void) | undefined;
    const deadline = new Promise<never>((_, reject) => { stop = () => reject(new Error('traversal deadline reached')); controller.signal.addEventListener('abort', stop, { once: true }); });
    try { return await Promise.race([Promise.resolve(operation), deadline]); } finally { if (stop) controller.signal.removeEventListener('abort', stop); }
  };
  const queue = input.roots.map((ref) => ({ ref, from: null as string | null }));
  const queued = new Set(input.roots), seen = new Set<string>();
  const documents: { ref: string; digest: string; text: string; provenance: string; observation: Record<string, string>; truncated: boolean }[] = [];
  const dispositions: { ref: string; from: string | null; status: string; why: string }[] = [];
  const links: { from: string; ref: string }[] = [];
  let bytes = 0, omittedLinks = 0;
  try {
    for (let i = 0; i < queue.length; i++) {
      const { ref, from } = queue[i]!;
      if (controller.signal.aborted || documents.length >= documentsLimit || bytes >= bytesLimit) {
        dispositions.push(...queue.slice(i).map((entry) => ({ ...entry, status: 'budget', why: controller.signal.aborted ? 'traversal deadline reached' : 'document or byte budget reached' }))); break;
      }
      if (controller.signal.aborted) break;
      let authorized: { allowed: boolean; reason: string };
      try { authorized = await bounded(input.adapter.authorize(ref, from)); } catch { dispositions.push(...queue.slice(i).map((entry) => ({ ...entry, status: 'budget', why: 'authorization did not finish before the traversal deadline' }))); break; }
      if (!authorized.allowed) { dispositions.push({ ref, from, status: 'inaccessible', why: redact(authorized.reason) }); continue; }
      const relevant = input.adapter.relevant?.(ref, from);
      if (relevant && !relevant.relevant) { dispositions.push({ ref, from, status: 'irrelevant', why: redact(relevant.reason) }); continue; }
      const remaining = bytesLimit - bytes;
      try {
        const result = await bounded(input.adapter.read(ref, { signal: controller.signal, maxBytes: remaining }));
        if (result.outcome !== 'read') { dispositions.push({ ref, from, status: result.outcome === 'denied' ? 'inaccessible' : result.outcome, why: redact(result.reason) }); continue; }
        // A returned canonical address can reveal a redirect. It must be inside the same permission boundary.
        const canonical = result.document.url ?? result.document.path ?? result.document.ref;
        if (canonical !== ref && !(await bounded(input.adapter.authorize(canonical, ref))).allowed) { dispositions.push({ ref, from, status: 'inaccessible', why: 'adapter returned an unauthorized canonical document; its body was not admitted' }); continue; }
        if (seen.has(canonical)) { dispositions.push({ ref, from, status: 'duplicate', why: 'canonical document already read' }); continue; }
        seen.add(canonical);
        if (!result.principal || !result.sessionId || !result.operation || !result.scope || !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.parse(input.now())) { dispositions.push({ ref, from, status: 'unknown', why: 'adapter observation lacks current principal/session/operation/scope/expiry' }); continue; }
        const body = result.document.text;
        if (typeof body !== 'string') { dispositions.push({ ref, from, status: 'unknown', why: 'adapter returned no held text' }); continue; }
        const size = Buffer.byteLength(body);
        if (size > remaining) { dispositions.push({ ref, from, status: 'budget', why: 'adapter response exceeded the remaining byte budget; content not admitted' }); bytes = bytesLimit; continue; }
        bytes += size;
        const text = redact(body);
        documents.push({ ref, digest: createHash('sha256').update(body).digest('hex'), text, provenance: result.document.provenance, observation: { operation: result.operation, principal: result.principal, sessionId: result.sessionId, scope: result.scope, expiresAt: result.expiresAt, observedAt: input.now() }, truncated: result.document.truncated === true });
        if (result.document.truncated) dispositions.push({ ref, from, status: 'budget', why: 'adapter returned truncated text; unread remainder is unknown' });
        const discovered = referencesIn(text, result.document);
        for (const [index, target] of discovered.entries()) {
          if (links.length >= linksLimit) { omittedLinks += discovered.length - index; dispositions.push({ ref: target, from: ref, status: 'budget', why: 'link budget reached; remaining references were not traversed' }); break; }
          links.push({ from: ref, ref: target });
          if (!queued.has(target) && !seen.has(target)) { queued.add(target); queue.push({ ref: target, from: ref }); }
        }
      } catch (error) { dispositions.push({ ref, from, status: 'unreachable', why: controller.signal.aborted ? 'traversal deadline reached' : redact((error as Error).message) }); }
    }
  } finally { clearTimeout(timer); controller.abort(); }
  return { formatVersion: 1, documents, links, dispositions, bytes, omittedLinks, limits: { documents: documentsLimit, links: linksLimit, bytes: bytesLimit, timeoutMs }, coverage: dispositions.some((d) => !['duplicate', 'irrelevant'].includes(d.status)) ? 'incomplete' : 'traversed_within_declared_scope', semanticCompletenessVerified: false, permissionGranted: false };
}
