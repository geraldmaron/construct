/** Bounded claim checks compare current evidence, not a model's passed flag. */
import { createHash } from 'node:crypto';
import type { RefResolver } from '../project/evidence.ts';
import type { StateStore } from '../state/open.ts';
import { sourceMapping } from '../source/mapping.ts';

export interface ClaimCheck {
  readonly claim: string;
  readonly refs: readonly string[];
  readonly calculation?: { readonly sourceId: string; readonly item: string; readonly field: string; readonly operation: 'sum'; readonly expected: number; readonly unit: string };
}
export function claimChecks(value: unknown): ClaimCheck[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) throw new Error('claims must be a bounded array (at most 50)');
  return value.map((raw) => {
    const c = raw as ClaimCheck;
    if (!c || typeof c.claim !== 'string' || !c.claim.trim() || c.claim.length > 2000 || !Array.isArray(c.refs) || !c.refs.length || c.refs.length > 20 || c.refs.some((r) => typeof r !== 'string' || !r.trim())) throw new Error('each claim needs its exact answer text and evidence references');
    if (c.calculation && (c.calculation.operation !== 'sum' || !Number.isFinite(c.calculation.expected) || [c.calculation.sourceId, c.calculation.item, c.calculation.field, c.calculation.unit].some((v) => typeof v !== 'string' || !v.trim()))) throw new Error('calculation needs sourceId, item, mapped field, sum, expected and explicit unit');
    return { claim: c.claim, refs: c.refs, ...(c.calculation ? { calculation: c.calculation } : {}) };
  });
}
const normalize = (s: string) => s.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim().replace(/[.!]$/, '');
function proposition(text: string): { key: string; negative: boolean } | null {
  // Deliberately narrow present-tense assertions. Questions, quotations, modality,
  // attribution and conditional context cannot be certified by a matching substring.
  const s = normalize(text.replace(/^[-*]\s+/, ''));
  if (/[?"“”]/.test(s) || /\b(if|unless|may|might|could|would|allegedly|claims?|said|says|previously|formerly)\b/.test(s)) return null;
  const hit = s.match(/^((?:the |our )?[a-z][a-z -]{0,60}?) (does not |doesn't |never |does )?(store|stores|retain|retains|encrypt|encrypts|support|supports|require|requires|use|uses) ([a-z][a-z0-9 -]{0,100})$/);
  if (!hit) return null;
  const verb = hit[3]!.replace(/s$/, '');
  return { key: `${hit[1]} ${verb} ${hit[4]}`, negative: ['does not ', "doesn't ", 'never '].includes(hit[2] ?? '') };
}
function sentences(text: string): string[] { return text.split(/(?<=[.!?])\s+|\n/).map((s) => s.trim()).filter(Boolean); }
export function assessClaims(input: { answer: string; claims: readonly ClaimCheck[]; citations: readonly {ref: string}[]; resolve: RefResolver; store: StateStore; at: string }) {
  const automatic = sentences(input.answer).filter((s) => proposition(s)).map((claim) => ({ claim, refs: input.citations.map((c) => c.ref) }));
  const claims: ClaimCheck[] = [...input.claims, ...automatic.filter((c) => !input.claims.some((explicit) => normalize(explicit.claim) === normalize(c.claim)))];
  const results = claims.map((c) => {
    const problems: string[] = [];
    const evidence = c.refs.map((ref) => {
      const hit = input.resolve(ref);
      if (!hit || typeof hit.text !== 'string' || hit.truncated || hit.supersededBy) problems.push(`${ref}: missing, incomplete or superseded evidence`);
      return { ref, digest: typeof hit?.text === 'string' ? createHash('sha256').update(hit.text).digest('hex') : null, provenance: hit?.provenance ?? 'unresolved', text: hit?.text ?? '' };
    });
    let derivation: { value: string; expression: string } | undefined;
    let status: 'supported' | 'contradicted' | 'unknown' = 'unknown';
    let basis = 'No bounded check establishes this claim; use an independent domain assessment.';
    if (!normalize(input.answer).includes(normalize(c.claim))) problems.push('claim text is not present in this answer');
    if (c.refs.some((ref) => !input.citations.some((citation) => citation.ref === ref))) problems.push('claim reference is not among the answer citations');
    if (c.calculation) {
      const calc = c.calculation;
      if (normalize(c.claim) !== normalize(`Total ${calc.field} is ${String(calc.expected)} ${calc.unit}.`)) problems.push('typed sum claim must state exactly: Total <field> is <expected> <unit>; broader prose needs independent assessment');
      const result = sourceMapping(input.store, { sourceId: calc.sourceId, item: calc.item, resolve: input.resolve, at: input.at, nextId: () => { throw new Error('read-only mapping assessment must not create an observation'); } });
      const sourceRef = `${calc.sourceId}:${calc.item}`;
      if (!c.refs.some((ref) => { const hit = input.resolve(ref); return hit?.sourceId === calc.sourceId && hit?.itemRef === calc.item; })) problems.push(`calculation needs the mapped source item citation ${sourceRef}`);
      if (!('mapping' in result) || !result.aggregationReady) problems.push('calculation requires a current mapping and complete coverage');
      else {
        const field = result.mapping.fields.find((f) => f.name === calc.field);
        const values = result.rows.map((row) => row.values[calc.field]);
        if (!field || field.type !== 'number' || field.unit !== calc.unit || values.some((v) => typeof v !== 'number' || !Number.isFinite(v))) problems.push('calculation field, unit or values do not match the typed mapping');
        else {
          const sum = (values as number[]).reduce((a, b) => a + b, 0);
          if (!Number.isFinite(sum)) problems.push('calculation overflows finite numeric range');
          else {
            status = Math.abs(sum - calc.expected) <= Number.EPSILON * Math.max(1, Math.abs(sum), Math.abs(calc.expected)) * Math.max(1, values.length) ? 'supported' : 'contradicted';
            if (status === 'supported') derivation = { value: String(calc.expected), expression: (values as number[]).map((n) => `(${String(n)})`).join('+') || '0' };
            basis = `Mapped sum is ${String(sum)} ${calc.unit}; claim expects ${String(calc.expected)} ${calc.unit}. This verifies the typed calculation, not the surrounding prose.`;
          }
        }
      }
    } else {
      const target = proposition(c.claim);
      if (target) {
        const observations = evidence.flatMap((e) => sentences(e.text).map(proposition).filter((p) => p?.key === target.key));
        const support = observations.some((p) => p!.negative === target.negative);
        const opposition = observations.some((p) => p!.negative !== target.negative);
        if (support && opposition) { basis = 'Cited observations disagree on this scoped proposition; preserve both or justify a resolution.'; }
        else if (support || opposition) { status = support ? 'supported' : 'contradicted'; basis = 'Compared full present-tense clauses with the same subject, predicate and object, preserving negation. Broader entailment is unassessed.'; }
      }
    }
    if (problems.length) status = 'unknown';
    return { claim: c.claim, status, basis, problems, ...(status === 'supported' && derivation ? { derivation } : {}), evidence: evidence.map(({ ref, digest, provenance }) => ({ ref, digest, provenance })) };
  });
  return { formatVersion: 1, verifier: 'bounded-claim-checks/1', answerDigest: createHash('sha256').update(input.answer).digest('hex'), checkedAt: input.at, scope: 'listed claims and recognized simple clauses only', semanticSupportVerified: false, results, complete: false, status: results.some((r) => r.status === 'contradicted') ? 'contradicted' : results.length && results.every((r) => r.status === 'supported') ? 'supported_within_checked_scope' : 'unknown', limits: 'Evidence assertions are not guaranteed truth. Unrecognized paraphrases, omitted claims, authority, semantic scope and prose around calculations require independent review.' };
}
