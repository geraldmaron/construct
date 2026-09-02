/**
 * kernel/workflow/validators.ts — the deterministic checks a step output or
 * deliverable must pass. Each validator is named in a workflow manifest and
 * returns what it checked and what failed, never a judgment about content.
 */

export interface ValidatorResult {
  readonly validator: string;
  readonly ok: boolean;
  readonly problems: readonly string[];
}

export interface ValidationSubject {
  readonly output: unknown;
  readonly expectedKeys: readonly string[];
  readonly evidence: readonly { readonly ref: string; readonly excerpt?: string }[];
  /** Entities, claims, sources, or files the run may cite; a ref outside it does not resolve. */
  readonly resolvableRefs: ReadonlySet<string>;
}

type Validator = (subject: ValidationSubject) => readonly string[];

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function findings(output: unknown): Array<Record<string, unknown>> {
  if (!isRecord(output)) return [];
  const list = output.findings ?? output.conflicts ?? output.items;
  return Array.isArray(list) ? list.filter(isRecord) : [];
}

const VALIDATORS: Readonly<Record<string, Validator>> = {
  schema: ({ output, expectedKeys }) => {
    if (!isRecord(output)) return ['output is not an object'];
    return expectedKeys.filter((k) => !(k in output)).map((k) => `output lacks "${k}"`);
  },
  citations_present: ({ evidence }) => {
    if (evidence.length === 0) return ['no evidence was submitted; every step that reads cites what it read'];
    return evidence.filter((e) => !e.ref || e.ref.trim() === '').map(() => 'an evidence entry has no reference');
  },
  no_uncited_material_findings: ({ output }) => {
    const problems: string[] = [];
    for (const [i, f] of findings(output).entries()) {
      const material = f.material === true || f.severity === 'material' || f.severity === 'high';
      const cites = Array.isArray(f.citations) && f.citations.length > 0;
      if (material && !cites) problems.push(`finding ${String(i + 1)} is material but cites nothing`);
    }
    return problems;
  },
  deliverable_complete: ({ output }) => {
    if (!isRecord(output)) return ['deliverable is not an object'];
    const problems: string[] = [];
    if (typeof output.summary !== 'string' || output.summary.trim() === '') problems.push('deliverable has no summary');
    if (!('findings' in output) && !('body' in output) && !('decisions' in output)) problems.push('deliverable has no findings, body, or decisions');
    if (isRecord(output) && Array.isArray(output.assumptions) === false && 'assumptions' in output) problems.push('assumptions must be a list');
    return problems;
  },
  constitution_shape: ({ output }) => {
    if (!isRecord(output)) return ['output is not an object'];
    const p = output.principles;
    if (!Array.isArray(p)) return ['output has no principles list'];
    return p.filter((x) => typeof x !== 'string' || x.trim() === '').map(() => 'a principle is empty');
  },
  no_velocity_as_capacity: ({ output }) => {
    const text = JSON.stringify(output ?? {}).toLowerCase();
    const problems: string[] = [];
    if (/"capacity"\s*:\s*\{[^}]*"basis"\s*:\s*"velocity"/.test(text) || /velocity\s+(?:is|as|equals|=)\s+capacity/.test(text)) {
      problems.push('capacity is derived from velocity; velocity is throughput history, never capacity');
    }
    if (isRecord(output) && 'capacity' in output && !(Array.isArray(output.assumptions) && output.assumptions.length > 0)) {
      problems.push('a capacity figure states no assumptions');
    }
    return problems;
  },
  evidence_refs_resolve: ({ evidence, resolvableRefs }) => {
    if (resolvableRefs.size === 0) return [];
    return evidence.filter((e) => !resolvableRefs.has(e.ref)).map((e) => `evidence "${e.ref}" does not resolve to anything this run may cite`);
  },
};

export function knownValidators(): readonly string[] {
  return Object.keys(VALIDATORS);
}

export function runValidators(names: readonly string[], subject: ValidationSubject): ValidatorResult[] {
  return names.map((name) => {
    const v = VALIDATORS[name];
    if (!v) return { validator: name, ok: false, problems: [`no validator named "${name}"`] };
    const problems = v(subject);
    return { validator: name, ok: problems.length === 0, problems };
  });
}
