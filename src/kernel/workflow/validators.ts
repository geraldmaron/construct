/**
 * kernel/workflow/validators.ts — the deterministic checks a step output or
 * deliverable must pass. Each validator is named in a workflow manifest and
 * returns what it checked and what failed, never a judgment about content.
 *
 * Grounding is checked, not trusted: when the caller supplies a resolver,
 * every cited reference must name something real, every artifact a step says
 * it wrote must exist, and every figure in the output or the artifact must
 * appear in something the step cited (or be declared as derived from figures
 * that do). These are mechanical floors under quality, not a judge of it.
 */

import { normalizeQuote, type RefResolver } from '../project/evidence.ts';

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
  /** Resolves a reference to what it names; when present it is the authority on what resolves. */
  readonly resolve?: RefResolver;
  /** The run's input, for checks that compare against what was asked (a named template). */
  readonly input?: unknown;
}

const YEAR = /^(?:19|20)\d\d$/;
const NUMBER = /(?<![\w.\-/:#])[$€£]?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|[kKmMbB]\b|ms\b|h\b|x\b))?(?![\w\-:])/g;

/** A figure as it would be matched: no currency sign, no thousands separators, no inner space. */
export function normalizeFigure(raw: string): string {
  return raw.replace(/[$€£,]/g, '').replace(/\s+/g, '').toLowerCase();
}

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'evidence' && k !== 'derivations') strings(x, out);
  return out;
}

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DATES = [
  new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?![.,]?\\d|\\s?(?:%|[kmb]\\b))`, 'gi'),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\b`, 'gi'),
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:am|pm)?\b/gi,
];

/** Figures worth checking: not a lone digit, a year, a date or time, or a list or section number. */
export function figuresIn(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    let body = line.replace(/^\s*(?:#+\s*)?(?:[-*]\s+)?\d+[.)]\s+/, '');
    for (const d of DATES) body = body.replace(d, ' ');
    for (const m of body.matchAll(NUMBER)) {
      const f = normalizeFigure(m[0]);
      const digits = f.replace(/[^\d.]/g, '');
      if (YEAR.test(digits) && f === digits) continue;
      if (/^\d$/.test(f)) continue;
      out.push(f);
    }
  }
  return out;
}

/** A figure's magnitude: 2.1M -> 2100000, 18% -> 18, 1,600 -> 1600. Null when it is not a figure. */
export function figureValue(raw: string): number | null {
  const f = normalizeFigure(raw);
  const m = /^(\d+(?:\.\d+)?)(%|k|m|b|ms|h|x)?$/.exec(f);
  if (!m) return null;
  const n = Number(m[1]);
  // A percentage is a fraction, so 1.6M * 50% is 0.8M and "18%" compares as 0.18.
  const scale = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'b' ? 1e9 : m[2] === '%' ? 0.01 : 1;
  return n * scale;
}

/** The half-unit of a figure's last written digit: "2M" covers 1.5M to 2.5M, "2.1M" covers 2.05M to 2.15M. */
function roundingTolerance(fig: string): number {
  const f = normalizeFigure(fig);
  const m = /^(\d+)(?:\.(\d+))?(%|k|m|b|ms|h|x)?$/.exec(f);
  if (!m) return 0;
  const decimals = m[2]?.length ?? 0;
  const scale = m[3] === 'k' ? 1e3 : m[3] === 'm' ? 1e6 : m[3] === 'b' ? 1e9 : m[3] === '%' ? 0.01 : 1;
  return (10 ** -decimals * scale) / 2;
}

/** A written figure is supported when a cited figure has the same value, allowing for how far it was rounded. */
export function figureSupported(fig: string, cited: ReadonlySet<string>, citedValues: readonly number[]): boolean {
  if (cited.has(fig)) return true;
  const v = figureValue(fig);
  if (v === null) return false;
  const tol = roundingTolerance(fig);
  return citedValues.some((c) => Math.abs(c - v) <= tol + 1e-9 * Math.max(1, Math.abs(c)));
}

/** Unit constants an expression may use without citing them: per-cent, per-mille, calendar and clock. */
const CONSTANTS = new Set(['2', '3', '4', '7', '10', '12', '24', '52', '60', '100', '365', '1000']);

/** Evaluate + - * / and parentheses over figures; anything else is refused. */
export function evaluateExpression(expr: string): number | null {
  const tokens = expr.match(/\d[\d,]*(?:\.\d+)?\s?(?:%|[kKmMbB](?![a-z]))?|[()+\-*/]/g);
  if (!tokens || tokens.join('').replace(/\s/g, '') !== expr.replace(/\s/g, '')) return null;
  let i = 0;
  const peek = () => tokens[i];
  const num = (): number | null => {
    const t = tokens[i++];
    if (t === '(') {
      const v = sum();
      if (tokens[i++] !== ')') return null;
      return v;
    }
    if (t === '-') {
      const v = num();
      return v === null ? null : -v;
    }
    return t === undefined ? null : figureValue(t);
  };
  const product = (): number | null => {
    let v = num();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = tokens[i++];
      const r = num();
      if (r === null) return null;
      v = op === '*' ? v * r : r === 0 ? null : v / r;
    }
    return v;
  };
  const sum = (): number | null => {
    let v = product();
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = tokens[i++];
      const r = product();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const v = sum();
  return v !== null && i === tokens.length ? v : null;
}

function artifactPaths(output: unknown): string[] {
  if (!isRecord(output)) return [];
  const out: string[] = [];
  const push = (x: unknown) => {
    if (typeof x === 'string' && x.trim() !== '') out.push(x.trim());
    else if (isRecord(x) && typeof x.path === 'string') out.push(x.path);
  };
  if (Array.isArray(output.changes)) output.changes.forEach(push);
  push(output.artifact);
  return out;
}

function headings(text: string): string[] {
  return text
    .split('\n')
    .filter((l) => /^#{1,6}\s/.test(l))
    .map((l) => l.replace(/^#{1,6}\s+/, '').replace(/^\d+[.)]\s*/, '').replace(/<[^>]*>/g, '').replace(/[:\-–—]+\s*$/, '').trim().toLowerCase())
    .filter((h) => h !== '');
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
  citations_present: ({ evidence, resolve }) => {
    if (evidence.length === 0) return ['no evidence was submitted; every step that reads cites what it read'];
    const problems = evidence.filter((e) => !e.ref || e.ref.trim() === '').map(() => 'an evidence entry has no reference');
    if (resolve) for (const e of evidence) if (e.ref && e.ref.trim() !== '' && !resolve(e.ref)) problems.push(`evidence "${e.ref}" does not name a file, source, item, or deliverable this project has`);
    return problems;
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
  evidence_refs_resolve: ({ evidence, resolvableRefs, resolve }) => {
    if (resolve) return evidence.filter((e) => !resolve(e.ref)).map((e) => `evidence "${e.ref}" does not resolve to anything this run may cite`);
    // Fail closed: with nothing to resolve against, an unchecked pass would read as a checked one.
    if (resolvableRefs.size === 0) return evidence.length === 0 ? [] : ['nothing was supplied to resolve evidence against, so no citation could be checked'];
    return evidence.filter((e) => !resolvableRefs.has(e.ref)).map((e) => `evidence "${e.ref}" does not resolve to anything this run may cite`);
  },
  artifacts_exist: ({ output, resolve }) => {
    const paths = artifactPaths(output);
    if (paths.length === 0) return ['the output names no artifact (give "artifact" or "changes" with the file written)'];
    if (!resolve) return ['nothing was supplied to check that the artifact exists'];
    const problems: string[] = [];
    for (const p of paths) {
      const r = resolve(p);
      if (!r || r.kind !== 'file') problems.push(`artifact "${p}" was not found in the project`);
      else if ((r.text ?? '').trim() === '') problems.push(`artifact "${p}" is empty`);
    }
    return problems;
  },
  numbers_grounded: ({ output, evidence, resolve, input }) => {
    const cited: string[] = [];
    for (const e of evidence) {
      if (e.excerpt) cited.push(e.excerpt);
      const r = resolve?.(e.ref);
      if (r?.text) cited.push(r.text);
    }
    // What the person asked for counts as given: a figure in the request or inputs is theirs, not invented.
    cited.push(...strings(input));
    const haystack = new Set(figuresIn(cited.join('\n')));
    const citedValues = [...haystack].map(figureValue).filter((x): x is number => x !== null);
    const supported = (f: string) => figureSupported(f, haystack, citedValues);
    const derived = new Set<string>();
    const problems: string[] = [];
    if (isRecord(output) && Array.isArray(output.derivations)) {
      output.derivations.forEach((d, i) => {
        if (!isRecord(d) || (typeof d.value !== 'string' && typeof d.value !== 'number')) {
          problems.push(`derivation ${String(i + 1)} gives no value`);
          return;
        }
        const value = String(d.value);
        if (typeof d.expression === 'string' && d.expression.trim() !== '') {
          // The figures it is computed from must themselves be grounded, and the arithmetic must hold.
          for (const f of figuresIn(d.expression)) if (!supported(f) && !CONSTANTS.has(f)) problems.push(`derivation of "${value}" uses "${f}", which no cited source contains`);
          const got = evaluateExpression(d.expression);
          const want = figureValue(value);
          if (got === null) problems.push(`derivation of "${value}": "${d.expression}" is not arithmetic over figures`);
          else if (want !== null && Math.abs(got - want) > Math.max(Math.abs(want) * 0.01, 1e-9)) problems.push(`derivation of "${value}": "${d.expression}" comes to ${String(Number(got.toPrecision(6)))}, not ${value}`);
          derived.add(normalizeFigure(value));
        } else if (typeof d.from === 'string' && d.from.trim() !== '') {
          derived.add(normalizeFigure(value));
        } else {
          problems.push(`derivation of "${value}" says neither how it was computed (expression) nor from what (from)`);
        }
      });
    }
    const texts = strings(output);
    for (const p of artifactPaths(output)) {
      const t = resolve?.(p)?.text;
      if (t) texts.push(t);
    }
    const unsupported = new Set<string>();
    const derivedValues = [...derived].map(figureValue).filter((x): x is number => x !== null);
    for (const f of figuresIn(texts.join('\n'))) if (!supported(f) && !figureSupported(f, derived, derivedValues)) unsupported.add(f);
    return [...problems, ...[...unsupported].map((f) => `the figure "${f}" appears in no cited source; cite where it comes from, or list it under derivations with the expression that computes it`)];
  },
  template_conformance: ({ output, input, resolve }) => {
    const template = (isRecord(output) && typeof output.template === 'string' ? output.template : null) ?? (isRecord(input) && typeof input.template === 'string' ? input.template : null);
    if (!template) return [];
    if (!resolve) return ['nothing was supplied to read the template'];
    const t = resolve(template);
    if (!t?.text) return [`template "${template}" was not found`];
    const [artifact] = artifactPaths(output);
    if (!artifact) return ['a template was named but the output names no artifact to check against it'];
    const a = resolve(artifact)?.text;
    if (!a) return [`artifact "${artifact}" could not be read`];
    const have = headings(a);
    const want = headings(t.text).filter((h) => h !== '');
    // The template's first heading is the document title placeholder; the artifact's title is its own.
    return want.slice(1).filter((h) => !have.some((x) => x.includes(h) || h.includes(x))).map((h) => `the artifact has no "${h}" section that the template requires`);
  },
  excerpts_match: ({ evidence, resolve }) => {
    if (!resolve) return evidence.some((e) => e.excerpt) ? ['nothing was supplied to check excerpts against'] : [];
    const problems: string[] = [];
    for (const e of evidence) {
      if (!e.excerpt || e.excerpt.trim() === '') continue;
      const r = resolve(e.ref);
      // A reported reference has no text here to compare; its excerpt stands as the host's word.
      if (!r || r.provenance === 'reported' || r.text === undefined) continue;
      if (!normalizeQuote(r.text).includes(normalizeQuote(e.excerpt))) problems.push(`the excerpt cited from "${e.ref}" does not appear in it`);
    }
    return problems;
  },
  evidence_witnessed: ({ evidence, resolve }) => {
    if (!resolve) return ['nothing was supplied to resolve evidence against'];
    if (evidence.length === 0) return ['no evidence was submitted'];
    const witnessed = evidence.filter((e) => resolve(e.ref)?.provenance === 'witnessed').length;
    return witnessed === 0 ? ['every citation rests on the host\'s word; cite at least one thing Construct can open (a project file or a source it reads)'] : [];
  },
  superseded_acknowledged: ({ output, evidence, resolve }) => {
    if (!resolve) return [];
    const text = strings(output).join('\n').toLowerCase();
    const problems: string[] = [];
    for (const e of evidence) {
      const r = resolve(e.ref);
      if (!r?.supersededBy) continue;
      const name = (r.itemRef ?? e.ref).toLowerCase();
      const base = name.slice(name.lastIndexOf('/') + 1).replace(/\.[a-z]+$/, '');
      if (!text.includes('supersed') || !(text.includes(name) || text.includes(base))) {
        problems.push(`"${e.ref}" is superseded by ${r.supersededBy}; say so where it is used, or cite the document that replaces it`);
      }
    }
    return problems;
  },
  decision_ask_present: ({ output, input, resolve }) => {
    const [artifact] = artifactPaths(output);
    const text = artifact ? resolve?.(artifact)?.text : undefined;
    if (!text) return ['the output names no readable artifact to check for the decision being asked'];
    const lines = text.split('\n');
    const start = lines.findIndex((l) => /^#{1,6}\s.*\bdecision\b/i.test(l));
    if (start === -1) return ['the artifact has no section that states the decision being asked for'];
    const end = lines.findIndex((l, i) => i > start && /^#{1,6}\s/.test(l));
    const section = lines.slice(start, end === -1 ? undefined : end).join('\n');
    const problems: string[] = [];
    const audience = isRecord(input) && typeof input.audience === 'string' ? input.audience.trim() : '';
    const by = isRecord(input) && typeof input.decisionBy === 'string' ? input.decisionBy.trim() : '';
    if (audience && !section.toLowerCase().includes(audience.toLowerCase())) problems.push(`the decision section does not name who decides (${audience})`);
    if (by ? !section.toLowerCase().includes(by.toLowerCase()) : !/\b(?:by|before|no later than)\b/i.test(section)) problems.push('the decision section does not say by when');
    return problems;
  },
  sources_diverse: ({ evidence, resolve }) => {
    // Triangulation: a finding resting on one document is a quotation, not research.
    const roots = new Set<string>();
    for (const e of evidence) {
      const r = resolve?.(e.ref);
      if (!r) continue;
      if (r.kind === 'web') {
        try { roots.add(new URL(e.ref.trim()).hostname.replace(/^www\./, '')); } catch { /* unparseable stays uncounted */ }
      } else roots.add(r.sourceId ? `${r.sourceId}:${r.itemRef ?? ''}` : (r.path ?? e.ref));
    }
    return roots.size >= 2 ? [] : [`the findings rest on ${String(roots.size)} independent source(s); research needs at least two that do not come from the same place`];
  },
  conflicts_declared: ({ output }) => {
    if (!isRecord(output) || !Array.isArray(output.conflicts)) return ['the output has no "conflicts" list; give one, empty if the sources agree'];
    const problems: string[] = [];
    output.conflicts.forEach((c, i) => {
      const cites = isRecord(c) && Array.isArray(c.citations) ? c.citations.filter((x) => typeof x === 'string' && x.trim() !== '') : [];
      if (cites.length < 2) problems.push(`conflict ${String(i + 1)} cites fewer than the two sources that disagree`);
    });
    return problems;
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
