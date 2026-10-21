/** Immutable method accounting. Host reports of application are never execution proof. */
import { createHash } from 'node:crypto';
import type { SkillRegistry } from '../registry/skill-registry.ts';
import type { RefResolver } from '../project/evidence.ts';
import { sameRef } from './validators.ts';

export interface MethodReceipt {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
  readonly status: 'reported_applied' | 'reported_skipped' | 'reported_deferred' | 'unreported';
  readonly why: string;
  readonly doctrine?: readonly { readonly ref: string; readonly purpose: 'procedure_only' }[];
  readonly obligations?: readonly {
    readonly obligation: string;
    readonly section: string;
    readonly evidence: readonly string[];
    readonly sectionDigest: string;
  }[];
  readonly evidence: readonly { readonly ref: string; readonly digest: string | null; readonly provenance: string }[];
}

export function methodReceipts(
  output: Record<string, unknown>,
  primary: string | null,
  registry: SkillRegistry,
  resolve?: RefResolver,
): { receipts: MethodReceipt[]; problems: string[] } {
  const receipts: MethodReceipt[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  if (output.methods !== undefined && !Array.isArray(output.methods))
    problems.push('methods must be a list of {id, disposition: applied|skipped|deferred, why, evidence: [ref]}');
  for (const entry of Array.isArray(output.methods) ? output.methods : []) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.id !== 'string' ||
      !['applied', 'skipped', 'deferred'].includes(entry.disposition) ||
      typeof entry.why !== 'string' ||
      !entry.why.trim()
    ) {
      problems.push('each method needs a registered id, disposition (applied, skipped, deferred), and why');
      continue;
    }
    const skill = registry.get(entry.id);
    if (!skill) {
      problems.push(`unknown method ${entry.id}`);
      continue;
    }
    if (seen.has(entry.id)) {
      problems.push(`duplicate method ${entry.id}`);
      continue;
    }
    seen.add(entry.id);
    const evidence: { ref: string; digest: string | null; provenance: string }[] = [];
    for (const ref of Array.isArray(entry.evidence) ? entry.evidence : []) {
      if (typeof ref !== 'string') {
        problems.push(`method ${entry.id} evidence must contain references`);
        continue;
      }
      const hit = resolve?.(ref);
      if (!hit) problems.push(`method ${entry.id} evidence ${ref} does not resolve`);
      evidence.push({
        ref,
        digest: typeof hit?.text === 'string' ? createHash('sha256').update(hit.text).digest('hex') : null,
        provenance: hit?.provenance ?? 'unresolved',
      });
    }
    const doctrine: { ref: string; purpose: 'procedure_only' }[] = [];
    if (entry.doctrine !== undefined && !Array.isArray(entry.doctrine))
      problems.push(`method ${entry.id} doctrine must be a list of references`);
    for (const ref of Array.isArray(entry.doctrine) ? entry.doctrine : []) {
      if (typeof ref !== 'string' || !ref.trim()) problems.push(`method ${entry.id} doctrine needs references`);
      else doctrine.push({ ref, purpose: 'procedure_only' });
    }
    const obligations: { obligation: string; section: string; evidence: string[]; sectionDigest: string }[] = [];
    if (entry.obligations !== undefined && !Array.isArray(entry.obligations))
      problems.push(`method ${entry.id} obligations must be a list`);
    for (const item of Array.isArray(entry.obligations) ? entry.obligations : []) {
      if (
        !item ||
        typeof item.obligation !== 'string' ||
        !item.obligation.trim() ||
        typeof item.section !== 'string' ||
        !item.section.startsWith('/') ||
        !Array.isArray(item.evidence)
      ) {
        problems.push(`method ${entry.id} obligation needs text, a JSON pointer section and evidence references`);
        continue;
      }
      let section: unknown = output;
      for (const key of item.section
        .slice(1)
        .split('/')
        .map((k: string) => k.replaceAll('~1', '/').replaceAll('~0', '~')))
        section =
          section && typeof section === 'object' && Object.hasOwn(section, key) ? (section as Record<string, unknown>)[key] : undefined;
      if (section === undefined || section === null || JSON.stringify(section) === '""') {
        problems.push(`method ${entry.id} section ${item.section} is absent or empty`);
        continue;
      }
      const listed = (r: string) =>
        evidence.some(
          (e) => e.ref === r || (resolve !== undefined && sameRef(e.ref, r, resolve) && resolve(e.ref)?.sourceId === resolve(r)?.sourceId),
        );
      const stray = item.evidence.filter((r: unknown) => typeof r !== 'string' || !listed(r));
      if (stray.length) {
        problems.push(
          `method ${entry.id} obligation evidence ${stray.map((r: unknown) => JSON.stringify(r)).join(', ')} is not in its project evidence list (${evidence.map((e) => e.ref).join(', ') || 'empty'}); add it to the method's evidence or cite one that is listed`,
        );
        continue;
      }
      obligations.push({
        obligation: item.obligation,
        section: item.section,
        evidence: item.evidence,
        sectionDigest: createHash('sha256').update(JSON.stringify(section)).digest('hex'),
      });
    }
    receipts.push({
      id: skill.manifest.id,
      version: skill.manifest.version,
      digest: skill.digest,
      status: `reported_${entry.disposition}` as MethodReceipt['status'],
      why: entry.why.trim(),
      evidence,
      ...(doctrine.length ? { doctrine } : {}),
      ...(obligations.length ? { obligations } : {}),
    });
  }
  if (primary && !seen.has(primary)) {
    const skill = registry.get(primary);
    if (skill)
      receipts.unshift({
        id: primary,
        version: skill.manifest.version,
        digest: skill.digest,
        status: 'unreported',
        why: 'Assigned method has no application report; binding or delivery alone does not establish use.',
        evidence: [],
      });
  }
  return { receipts, problems };
}

export interface RequestedMethod {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
  readonly binding: 'workflow' | 'supplemental';
}

/** Explicit host-selected method; deliverable matching never silently substitutes for it. */
export function requestedMethodBinding(id: string | null, registry: SkillRegistry, boundIds: readonly string[]): RequestedMethod | null {
  const skill = id ? registry.get(id) : null;
  return skill
    ? {
        id: skill.manifest.id,
        version: skill.manifest.version,
        digest: skill.digest,
        binding: boundIds.includes(skill.manifest.id) ? 'workflow' : 'supplemental',
      }
    : null;
}

/** Latest explicit successful report wins; an unreported assignment does not erase an earlier report. */
export function latestMethodReport(id: string, reports: readonly MethodReceipt[]): MethodReceipt | null {
  return reports.filter((r) => r.id === id && r.status !== 'unreported').at(-1) ?? null;
}

export function requestedMethodProblems(required: RequestedMethod, report: MethodReceipt | null): string[] {
  const remedy = `Report methods:[{id:"${required.id}",disposition:"applied"|"skipped",why:"reason",evidence:[ref]}] on this submission; applied also needs obligations:[{obligation,section:"/outputKey",evidence:[ref]}]. Reports are host assertions, not proof of application.`;
  if (!report || report.status === 'reported_deferred')
    return [`Requested method ${required.id} is ${report?.status ?? 'unreported'}. ${remedy}`];
  if (report.digest !== required.digest || report.version !== required.version)
    return [`Requested method ${required.id} changed; checkpoint and re-resolve the work against current skill bytes.`];
  if (report.status === 'reported_applied' && !report.obligations?.length)
    return [`Requested method ${required.id} has no application obligations. ${remedy}`];
  return [];
}
