/** Immutable method accounting. Host reports of application are never execution proof. */
import { createHash } from 'node:crypto';
import type { SkillRegistry } from '../registry/skill-registry.ts';
import type { RefResolver } from '../project/evidence.ts';

export interface MethodReceipt {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
  readonly status: 'reported_applied' | 'reported_skipped' | 'reported_deferred' | 'unreported';
  readonly why: string;
  readonly evidence: readonly { readonly ref: string; readonly digest: string | null; readonly provenance: string }[];
}

export function methodReceipts(output: Record<string, unknown>, primary: string | null, registry: SkillRegistry, resolve?: RefResolver): { receipts: MethodReceipt[]; problems: string[] } {
  const receipts: MethodReceipt[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  if (output.methods !== undefined && !Array.isArray(output.methods)) problems.push('methods must be a list of {id, disposition: applied|skipped|deferred, why, evidence: [ref]}');
  for (const entry of Array.isArray(output.methods) ? output.methods : []) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !['applied', 'skipped', 'deferred'].includes(entry.disposition) || typeof entry.why !== 'string' || !entry.why.trim()) {
      problems.push('each method needs a registered id, disposition (applied, skipped, deferred), and why'); continue;
    }
    const skill = registry.get(entry.id);
    if (!skill) { problems.push(`unknown method ${entry.id}`); continue; }
    if (seen.has(entry.id)) { problems.push(`duplicate method ${entry.id}`); continue; }
    seen.add(entry.id);
    const evidence: { ref: string; digest: string | null; provenance: string }[] = [];
    for (const ref of Array.isArray(entry.evidence) ? entry.evidence : []) {
      if (typeof ref !== 'string') { problems.push(`method ${entry.id} evidence must contain references`); continue; }
      const hit = resolve?.(ref);
      if (!hit) problems.push(`method ${entry.id} evidence ${ref} does not resolve`);
      evidence.push({ ref, digest: typeof hit?.text === 'string' ? createHash('sha256').update(hit.text).digest('hex') : null, provenance: hit?.provenance ?? 'unresolved' });
    }
    receipts.push({ id: skill.manifest.id, version: skill.manifest.version, digest: skill.digest, status: `reported_${entry.disposition}` as MethodReceipt['status'], why: entry.why.trim(), evidence });
  }
  if (primary && !seen.has(primary)) {
    const skill = registry.get(primary);
    if (skill) receipts.unshift({ id: primary, version: skill.manifest.version, digest: skill.digest, status: 'unreported', why: 'Assigned method has no application report; binding or delivery alone does not establish use.', evidence: [] });
  }
  return { receipts, problems };
}
