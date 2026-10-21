import { createHash } from 'node:crypto';
import { normalizeFigure, figuresIn, citedFiguresIn, figureValue, figureSupported } from './arithmetic.ts';
export { normalizeFigure, figuresIn, citedFiguresIn, figureValue, figureSupported, evaluateExpression } from './arithmetic.ts';
import { verifyDerivations, withoutDerivedFigures } from './derivations.ts';
import { namedArtifactPath } from './verification.ts';
/**
 * kernel/workflow/validators.ts — the deterministic checks a step output or
 * deliverable must pass. Each validator is named in a workflow manifest and
 * returns what it checked and what failed, never a judgment about content.
 *
 * Grounding is checked, not trusted: when the caller supplies a resolver,
 * every cited reference must name something this project holds, every
 * artifact a step says it wrote must exist, and every figure in the output
 * or in a document the step wrote (its artifact or a changed file; code and
 * configuration are not read for figures) must appear in text Construct
 * holds for something else the step cited (or be derived by arithmetic over
 * figures that do); a document the step wrote never grounds itself. An
 * excerpt is checked against that text; it never stands in for it. A cited
 * item dated after the period the run covers is refused unless the output
 * says why it belongs, and every source the run names must have something
 * cited from it or be listed as unread. These are mechanical floors under
 * quality, not a judge of it.
 */

import { realpathSync, statSync } from 'node:fs';
import { researchCoverage } from '../source/research.ts';
import { holdsContent, normalizeQuote, type RefResolver, type ResolvedRef } from '../project/evidence.ts';
import { normalizeUrl } from '../project/urls.ts';
import { redact } from '../render/redact.ts';
import { dayOf, type ResolvedPeriod } from '../registry/slots.ts';

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
  /** Terms the person has said must not be stated as current, each with the decision that settled it. */
  readonly settled?: readonly { readonly term: string; readonly statementId: string }[];
  /** The highest sensitivity among the sources this run (or the deliverable it acts on) cited. */
  readonly sensitivity?: string | null;
  /** The period the run covers, in dates, when it covers one. */
  readonly period?: ResolvedPeriod | null;
  /** The declared source ids the run names, when it names any. */
  readonly sources?: readonly string[] | null;
}

/** A cited item an output says belongs although it is dated after the period. */
export interface OutsidePeriod {
  readonly ref: string;
  readonly why: string;
}

/** A named source an output says could not be read. */
export interface Unread {
  readonly source: string;
  readonly why: string;
}

/** Where the citations a deliverable rests on fall against the period it covers, each by its ref. */
export interface PeriodCoverage {
  /** Items whose recorded update falls inside the period. */
  readonly inside: readonly string[];
  /** Items last updated before the period starts. */
  readonly before: readonly string[];
  /** Items updated after the period ends. */
  readonly after: readonly string[];
  /** Items with no date Construct can read, and project files, which are read as they stand now. */
  readonly undated: readonly string[];
  /** The items after the period that an output said belong, and why. */
  readonly acknowledged: readonly OutsidePeriod[];
}

/** Which of the sources a run names something was cited from, and which an output said could not be read. */
export interface SourcesCoverage {
  readonly named: readonly string[];
  readonly read: readonly string[];
  readonly unread: readonly Unread[];
}

const SENSITIVITY_ORDER = ['public', 'internal', 'confidential', 'restricted'] as const;

/** The more sensitive of two labels; unknown labels rank as internal. */
export function higherSensitivity(a: string | null | undefined, b: string | null | undefined): string | null {
  const rank = (x: string | null | undefined) => (x ? Math.max(0, SENSITIVITY_ORDER.indexOf(x as (typeof SENSITIVITY_ORDER)[number])) : -1);
  return rank(a) >= rank(b) ? (a ?? null) : (b ?? null);
}

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v !== null && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) if (k !== 'evidence' && k !== 'derivations') strings(x, out);
  return out;
}

/** A file an output names: a path, or {path}; a {path, removed: true} entry names a file that is gone. */
const namedPath = namedArtifactPath;

function arithmeticContext(output: unknown, resolve?: RefResolver) {
  const artifact = isRecord(output) ? namedPath(output.artifact) : null;
  const read = [...new Set([...changedPaths(output), ...(artifact ? [artifact] : [])])].filter(isDocument);
  const own = new Set(
    read
      .map((p) => resolve?.(p, 'artifact')?.path)
      .filter((p): p is string => p !== undefined)
      .map(realPath),
  );
  const texts = strings(output);
  for (const p of read) {
    const t = resolve?.(p, 'artifact')?.text;
    if (t) texts.push(t);
  }
  return { own, read, texts };
}

/** The same bound calculation results presented by submit_work and enforced by numbers_grounded. */
export function verifyOutputArithmetic({ output, evidence, resolve }: Pick<ValidationSubject, 'output' | 'evidence' | 'resolve'>) {
  const { own, texts } = arithmeticContext(output, resolve);
  return verifyDerivations({
    derivations: isRecord(output) ? output.derivations : undefined,
    texts,
    evidence,
    resolve,
    excludedPaths: own,
  });
}

/** The files an output lists under "changes". */
function changedPaths(output: unknown): string[] {
  if (!isRecord(output) || !Array.isArray(output.changes)) return [];
  return output.changes.map(namedPath).filter((p): p is string => p !== null);
}

/** Every file an output says it wrote: its changes, then its artifact. */
function artifactPaths(output: unknown): string[] {
  const artifact = isRecord(output) ? namedPath(output.artifact) : null;
  return [...changedPaths(output), ...(artifact ? [artifact] : [])];
}

/** Files whose text states figures to a reader; code and configuration are not read for them. */
const DOCUMENT_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc', '.html', '.htm', '.csv', '.tsv', '.mmd']);

function isDocument(path: string): boolean {
  const name = path.replaceAll('\\', '/').split('/').pop()!.toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot > 0 && DOCUMENT_EXTENSIONS.has(name.slice(dot));
}

/** Where a file really lives, so a symlink to it or the same name in another letter case is the same file. */
function realPath(path: string): string {
  try {
    const stat = statSync(path);
    return stat.isFile() ? `file:${String(stat.dev)}:${String(stat.ino)}` : realpathSync.native(path);
  } catch {
    return path;
  }
}

function headings(text: string): string[] {
  return text
    .split('\n')
    .filter((l) => /^#{1,6}\s/.test(l))
    .map((l) =>
      l
        .replace(/^#{1,6}\s+/, '')
        .replace(/^\d+[.)]\s*/, '')
        .replace(/<[^>]*>/g, '')
        .replace(/[:\-–—]+\s*$/, '')
        .trim()
        .toLowerCase(),
    )
    .filter((h) => h !== '');
}

type Validator = (subject: ValidationSubject) => readonly string[];

/** What a citation that names nothing held is told: what does resolve, and how to make a host read citable. */
function unheld(ref: string): string {
  return `evidence "${ref}" names nothing this project holds: cite a project file, a deliverable, or an item a recorded read holds (its ref or its url); record what you read through your own tools with the sources tool (action report) before citing it`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function findings(output: unknown): Array<Record<string, unknown>> {
  if (!isRecord(output)) return [];
  const list = output.findings ?? output.conflicts ?? output.items;
  return Array.isArray(list) ? list.filter(isRecord) : [];
}

/**
 * An ISO date, or an ISO date and time with or without a zone. Only these
 * are read as a day, so the day never depends on the timezone of the machine
 * that checks it; anything else is undated.
 */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i;

/** The day a cited item was last updated, in `timezone`; null for anything that is not a recorded item with an ISO date. */
function itemDay(r: ResolvedRef | null, timezone: string): string | null {
  if (!r || r.kind !== 'item' || typeof r.updatedAt !== 'string') return null;
  const at = r.updatedAt.trim();
  return ISO_TIME.test(at) ? dayOf(at, timezone) : null;
}

/** Whether two references name the same thing: written alike, or resolving to one recorded item or one file. */
export function sameRef(a: string, b: string, resolve: RefResolver): boolean {
  if (a.trim() === b.trim()) return true;
  const [x, y] = [resolve(a), resolve(b)];
  if (!x || !y || x.kind !== y.kind) return false;
  if (x.kind === 'item') return x.sourceId === y.sourceId && x.itemRef === y.itemRef;
  return x.path !== undefined && x.path === y.path;
}

/** What an output lists under a key, as {first, why} pairs; an entry that is not an object comes back blank. */
function entriesOf(output: unknown, key: 'outsidePeriod' | 'unread', first: 'ref' | 'source'): { name: string; why: string }[] {
  if (!isRecord(output) || !Array.isArray(output[key])) return [];
  const text = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
  return (output[key] as unknown[]).map((x) => (isRecord(x) ? { name: text(x[first]), why: text(x.why) } : { name: '', why: '' }));
}

/** The items an output says belong although they are dated after the period, each with why. */
export function outsidePeriodOf(output: unknown): OutsidePeriod[] {
  return entriesOf(output, 'outsidePeriod', 'ref')
    .filter((x) => x.name !== '' && x.why !== '')
    .map((x) => ({ ref: x.name, why: x.why }));
}

/** The named sources an output says could not be read, each with why. */
export function unreadOf(output: unknown): Unread[] {
  return entriesOf(output, 'unread', 'source')
    .filter((x) => x.name !== '' && x.why !== '')
    .map((x) => ({ source: x.name, why: x.why }));
}

/** The distinct, non-empty refs cited, in the order first cited. */
function citedRefs(evidence: readonly { readonly ref: string }[]): string[] {
  return [...new Set(evidence.map((e) => e.ref).filter((ref): ref is string => typeof ref === 'string' && ref.trim() !== ''))];
}

/** The sources something was cited from: an item, a file, or a folder inside them; naming a whole source reads nothing from it. */
function sourcesReadFrom(evidence: readonly { readonly ref: string }[], resolve: RefResolver): Set<string> {
  const read = new Set<string>();
  for (const ref of citedRefs(evidence)) {
    const r = resolve(ref);
    if (r?.sourceId && (r.kind === 'item' || r.kind === 'file' || r.kind === 'directory')) read.add(r.sourceId);
  }
  return read;
}

/**
 * Where what a deliverable rests on falls against its period. Only things
 * that hold or name content are counted: a recorded item by its recorded
 * update; an item with no ISO date, an unrecorded page, and files and
 * folders, which are read as they stand now, as undated. Acknowledgments are
 * kept only for items after the period.
 */
export function periodCoverage(
  evidence: readonly { readonly ref: string }[],
  resolve: RefResolver,
  period: ResolvedPeriod,
  acknowledged: readonly OutsidePeriod[],
): PeriodCoverage {
  const inside: string[] = [];
  const before: string[] = [];
  const after: string[] = [];
  const undated: string[] = [];
  for (const ref of citedRefs(evidence)) {
    const r = resolve(ref);
    if (!r || !(r.kind === 'item' || r.kind === 'web' || r.kind === 'file' || r.kind === 'directory')) continue;
    const day = itemDay(r, period.timezone);
    if (day === null) undated.push(ref);
    else if (day > period.to) after.push(ref);
    else if (period.from !== null && day < period.from) before.push(ref);
    else inside.push(ref);
  }
  const kept: OutsidePeriod[] = [];
  for (const a of acknowledged) {
    if (a.why.trim() === '' || kept.some((k) => sameRef(k.ref, a.ref, resolve))) continue;
    if (after.some((ref) => sameRef(ref, a.ref, resolve))) kept.push({ ref: a.ref, why: a.why });
  }
  return { inside, before, after, undated, acknowledged: kept };
}

/** Which named sources something was cited from, and which an output said could not be read (and were not read). */
export function sourcesCoverage(
  evidence: readonly { readonly ref: string }[],
  resolve: RefResolver,
  sources: readonly string[],
  unread: readonly Unread[],
): SourcesCoverage {
  const read = sourcesReadFrom(evidence, resolve);
  const listed: Unread[] = [];
  for (const u of unread) {
    if (u.why.trim() === '' || !sources.includes(u.source) || read.has(u.source) || listed.some((x) => x.source === u.source)) continue;
    listed.push({ source: u.source, why: u.why });
  }
  return { named: [...sources], read: sources.filter((id) => read.has(id)), unread: listed };
}

const VALIDATORS: Readonly<Record<string, Validator>> = {
  schema: ({ output, expectedKeys }) => {
    if (!isRecord(output)) return ['output is not an object'];
    return expectedKeys.filter((k) => !(k in output)).map((k) => `output lacks "${k}"`);
  },
  citations_present: ({ evidence, resolve }) => {
    if (evidence.length === 0) return ['no evidence was submitted; every step that reads cites what it read'];
    const problems = evidence.filter((e) => !e.ref || e.ref.trim() === '').map(() => 'an evidence entry has no reference');
    if (resolve) for (const e of evidence) if (e.ref && e.ref.trim() !== '' && !resolve(e.ref)) problems.push(unheld(e.ref));
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
  deliverable_complete: ({ output, expectedKeys }) => {
    if (!isRecord(output)) return ['deliverable is not an object'];
    // A step that declared outputs is complete when those keys are present.
    // Requiring summary/findings of a plan step is how the flagship path
    // became unblockable except by guessing undeclared keys.
    if (expectedKeys.length > 0) {
      const problems: string[] = [];
      for (const k of expectedKeys) {
        if (!(k in output)) problems.push(`output lacks "${k}"`);
        else if (typeof output[k] === 'string' && output[k].trim() === '') problems.push(`"${k}" is empty`);
      }
      if ('assumptions' in output && Array.isArray(output.assumptions) === false) problems.push('assumptions must be a list');
      return problems;
    }
    const problems: string[] = [];
    if (typeof output.summary !== 'string' || output.summary.trim() === '') problems.push('deliverable has no summary');
    if (!('findings' in output) && !('body' in output) && !('decisions' in output))
      problems.push('deliverable has no findings, body, or decisions');
    if (Array.isArray(output.assumptions) === false && 'assumptions' in output) problems.push('assumptions must be a list');
    return problems;
  },
  no_placeholder_facts: ({ output }) => {
    if (!isRecord(output)) return [];
    const problems: string[] = [];
    if (output.invented === true || output.fabricated === true) {
      problems.push('output presents invented facts as if they were found');
    }
    const unknowns = Array.isArray(output.unknowns) ? output.unknowns.filter((x) => typeof x === 'string' && x.trim() !== '') : [];
    if (output.verified === true && unknowns.length > 0) {
      problems.push('required facts are still unknown; the work is not verified');
    }
    const blob = JSON.stringify(output.findings ?? output.body ?? '');
    if (output.verified === true && /\b(lorem ipsum|\[insert |TKTK|TODO: fill)\b/i.test(blob)) {
      problems.push('a placeholder was presented as verified');
    }
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
  evidence_refs_resolve: ({ output, evidence, resolvableRefs, resolve }) => {
    if (resolve) {
      const body = output as { historicalEvidence?: readonly { ref: string; why: string }[] };
      return evidence.flatMap((e) => {
        const hit = resolve(e.ref);
        if (!hit) return [unheld(e.ref)];
        if (
          hit.historical &&
          !(
            Array.isArray(body?.historicalEvidence) &&
            body.historicalEvidence.some((h) => h?.ref === e.ref && typeof h.why === 'string' && h.why.trim())
          )
        )
          return [
            `evidence "${e.ref}" is historical; acknowledge its historical use under historicalEvidence:{ref,why}, or cite the current generation`,
          ];
        return [];
      });
    }
    // Fail closed: with nothing to resolve against, an unchecked pass would read as a checked one.
    if (resolvableRefs.size === 0)
      return evidence.length === 0 ? [] : ['nothing was supplied to resolve evidence against, so no citation could be checked'];
    return evidence
      .filter((e) => !resolvableRefs.has(e.ref))
      .map((e) => `evidence "${e.ref}" does not resolve to anything this run may cite`);
  },
  reference_coverage: ({ output, evidence, resolve }) => [...researchCoverage(evidence, resolve, output).problems],
  verification_result: ({ output }) => {
    if (!isRecord(output)) return ['verification output is not an object'];
    const problems: string[] = [];
    const verification = isRecord(output.verification) ? output.verification : output;
    const passed = verification.passed ?? output.passed;
    if (passed === false) problems.push('verification reported passed:false');
    if (verification.artifact === null || output.artifact === null || output.deliverable === null) {
      problems.push('verification names a null artifact');
    }
    const command = verification.command ?? output.command;
    const exit = verification.exitStatus ?? verification.exit ?? output.exitStatus;
    const revision = verification.revision ?? output.revision;
    const result = verification.result ?? output.result;
    if (!(typeof command === 'string' && command.trim() && typeof exit === 'number') && !(typeof result === 'string' && result.trim())) {
      problems.push(
        'verification needs a command with observed exit status, or a non-empty inspection result; passed:true alone is not evidence',
      );
    }
    if (typeof result === 'string' && result.trim() === '') problems.push('verification result is empty');
    if (exit !== undefined && exit !== 0) {
      problems.push('a failing exit status cannot be recorded as passed');
    }
    if (revision === 'old' || verification.staleRevision === true) {
      problems.push('verification cites an old revision of the subject');
    }
    const refs = verification.unresolved ?? output.unresolved;
    if (Array.isArray(refs) && refs.length > 0) problems.push('verification cites unresolved references');
    return problems;
  },
  review_complete: ({ output }) => {
    if (!isRecord(output)) return ['review is not an object'];
    const problems: string[] = [];
    if (!output.subject || output.subject === null) problems.push('review names no subject');
    if (!output.subjectRevision) problems.push('review is not bound to a subject revision');
    if (!output.method && !output.reviewer) problems.push('review names no method or reviewer');
    const findings = Array.isArray(output.findings) ? output.findings : [];
    if (findings.length === 0 && output.disposition !== 'no_findings') {
      problems.push('review has no findings and no explicit no_findings disposition');
    }
    for (const [i, f] of findings.entries()) {
      if (!isRecord(f)) {
        problems.push(`finding ${String(i + 1)} is not an object`);
        continue;
      }
      if (!f.disposition) problems.push(`finding ${String(i + 1)} has no disposition`);
      if (f.required === true && (f.disposition === 'open' || f.disposition === 'unresolved' || !f.disposition)) {
        problems.push(`required finding ${String(i + 1)} is unresolved`);
      }
    }
    if (Array.isArray(output.unresolved) && output.unresolved.length > 0 && output.passed === true) {
      problems.push('unresolved required findings cannot pass the review gate');
    }
    return problems;
  },
  plan_complete: ({ output }) => {
    if (!isRecord(output)) return ['plan is not an object'];
    const problems: string[] = [];
    const need = ['outcome', 'scope', 'nonGoals', 'premises', 'acceptance'] as const;
    for (const k of need) {
      if (!(k in output) || output[k] === null || (typeof output[k] === 'string' && output[k].trim() === '')) {
        problems.push(`plan lacks ${k}`);
      }
    }
    if (Array.isArray(output.blockers) && output.blockers.length > 0 && output.ready === true) {
      problems.push('a plan with unresolved blockers is not ready to dispatch');
    }
    if (Array.isArray(output.cycles) && output.cycles.length > 0) {
      problems.push('a plan with dependency cycles cannot be dispatched');
    }
    if (Array.isArray(output.missingCapabilities) && output.missingCapabilities.length > 0) {
      problems.push('a plan missing required capabilities cannot be dispatched');
    }
    return problems;
  },
  artifacts_exist: ({ output, expectedKeys, resolve }) => {
    const paths = artifactPaths(output);
    if (paths.length === 0) {
      // A step that declares the files it changed may honestly change none: an analysis, or work that wrote nothing here.
      if (expectedKeys.includes('changes') && isRecord(output) && Array.isArray(output.changes)) return [];
      return ['the output names no artifact (give "artifact" or "changes" with the file written)'];
    }
    if (!resolve) return ['nothing was supplied to check that the artifact exists'];
    const problems: string[] = [];
    for (const p of paths) {
      const r = resolve(p, 'artifact');
      if (!r || r.kind !== 'file') problems.push(`artifact "${p}" was not found in the project`);
      // Text is only loaded under a size cap; a file too large to load is not empty.
      else if (r.text !== undefined ? r.text.trim() === '' : (r.size ?? 0) === 0) problems.push(`artifact "${p}" is empty`);
    }
    return problems;
  },
  numbers_grounded: ({ output, evidence, resolve, input }) => {
    // Only text Construct holds grounds a figure: a file, or what a recorded read kept. An excerpt is a claim about
    // that text, checked by excerpts_match, and supports nothing on its own.
    // Documents the step wrote are read for figures; code and configuration are not, since their ports, limits and
    // versions are the change itself, and citing a changed code file can ground what the output says about it. What
    // is read is what is being checked, so citing it, by any name for the same file, grounds nothing.
    const { own, texts } = arithmeticContext(output, resolve);
    const cited: string[] = [];
    const cut: string[] = [];
    const selfCited: string[] = [];
    for (const e of evidence) {
      const r = resolve?.(e.ref);
      if (r?.path !== undefined && own.has(realPath(r.path))) {
        if (!selfCited.includes(e.ref)) selfCited.push(e.ref);
        continue;
      }
      if (r?.text) cited.push(r.text);
      if (r?.truncated && !cut.includes(e.ref)) cut.push(e.ref);
    }
    // What the person asked for counts as given: a figure in the request or inputs is theirs, not invented.
    const citedText = cited.join('\n');
    const haystack = new Set([...citedFiguresIn(citedText), ...figuresIn(citedText), ...figuresIn(strings(input).join('\n'))]);
    const citedValues = [...haystack].map(figureValue).filter((x): x is number => x !== null);
    const supported = (f: string) => figureSupported(f, haystack, citedValues);
    const arithmetic = verifyDerivations({
      derivations: isRecord(output) ? output.derivations : undefined,
      texts,
      evidence,
      resolve,
      excludedPaths: own,
    });
    const problems = arithmetic.problems;
    const unsupported = new Set<string>();
    for (const text of texts)
      for (const f of figuresIn(withoutDerivedFigures(text, arithmetic.results))) if (!supported(f)) unsupported.add(f);
    const cutNote =
      cut.length > 0
        ? ` (the recorded text of ${cut.join(', ')} is partial; report the exact passage under the same stable item ref with truncated:true, and explain the unread remainder in referenceDispositions)`
        : '';
    const selfNote = selfCited.length > 0 ? ` (citing ${selfCited.join(', ')}, which this step wrote, grounds nothing in it)` : '';
    return [
      ...problems,
      ...[...unsupported].map(
        (f) =>
          `the figure "${f}" appears in no cited source; cite where it comes from, or supply a bound derivation with id, claim, value, expression and source-bound operands${cutNote}${selfNote}`,
      ),
    ];
  },
  template_conformance: ({ output, input, resolve }) => {
    const template =
      (isRecord(output) && typeof output.template === 'string' ? output.template : null) ??
      (isRecord(input) && typeof input.template === 'string' ? input.template : null);
    if (!template) return [];
    if (!resolve) return ['nothing was supplied to read the template'];
    const t = resolve(template);
    if (!t?.text) return [`template "${template}" was not found`];
    const [artifact] = artifactPaths(output);
    if (!artifact) return ['a template was named but the output names no artifact to check against it'];
    const a = resolve(artifact, 'artifact')?.text;
    if (!a) return [`artifact "${artifact}" could not be read`];
    const have = headings(a);
    const want = headings(t.text).filter((h) => h !== '');
    // The template's first heading is the document title placeholder; the artifact's title is its own.
    return want
      .slice(1)
      .filter((h) => !have.some((x) => x.includes(h) || h.includes(x)))
      .map((h) => `the artifact has no "${h}" section that the template requires`);
  },
  excerpts_match: ({ evidence, resolve }) => {
    if (!resolve) return evidence.some((e) => e.excerpt) ? ['nothing was supplied to check excerpts against'] : [];
    const problems: string[] = [];
    for (const e of evidence) {
      if (!e.excerpt || e.excerpt.trim() === '') continue;
      const r = resolve(e.ref);
      // Without text there is nothing to compare: the excerpt is not checked, and it supports nothing (no figure,
      // no content floor). With text, even reported text (a fixture, a host's read), the quote has to agree with
      // what was recorded. Both sides are compared with credentials removed, since recorded text is kept that way.
      if (!r || r.text === undefined) continue;
      if (normalizeQuote(redact(r.text)).includes(normalizeQuote(redact(e.excerpt)))) continue;
      // Text cut at the cap may hold the quote past the cut: unchecked, not a misquote.
      if (r.truncated) continue;
      problems.push(`the excerpt cited from "${e.ref}" does not appear in it`);
    }
    return problems;
  },
  evidence_recorded: ({ evidence, resolve }) => {
    if (!resolve) return ['nothing was supplied to resolve evidence against'];
    if (evidence.length === 0) return ['no evidence was submitted'];
    return evidence.some((e) => holdsContent(resolve(e.ref)))
      ? []
      : ['nothing cited holds content Construct can check: cite a project file, or an item whose text a recorded read holds'];
  },
  within_period: ({ output, evidence, resolve, period }) => {
    // Only an item dated after the period ends is refused. One last updated before it starts, one with no date, and a
    // file are not: the deliverable counts them so the person sees what the work could not place in the period.
    if (!period || !resolve) return [];
    const problems: string[] = [];
    if (isRecord(output) && output.outsidePeriod !== undefined && !Array.isArray(output.outsidePeriod))
      problems.push('"outsidePeriod" must be a list of {ref, why}');
    const entries = entriesOf(output, 'outsidePeriod', 'ref');
    const cited = citedRefs(evidence);
    for (const entry of entries) {
      if (entry.name === '') problems.push('an "outsidePeriod" entry names no ref; give {ref, why}');
      else if (!cited.some((ref) => sameRef(ref, entry.name, resolve)))
        problems.push(`"outsidePeriod" lists "${entry.name}", which this step does not cite; list only what you cite`);
      else if (entry.why === '') problems.push(`"outsidePeriod" lists "${entry.name}" without saying why it belongs`);
    }
    for (const ref of cited) {
      const day = itemDay(resolve(ref), period.timezone);
      if (day === null || day <= period.to) continue;
      if (entries.some((x) => x.name !== '' && sameRef(ref, x.name, resolve))) continue;
      problems.push(
        `"${ref}" was updated ${day}, after the period ends (${period.to}); cite a version from inside the period, or list it under "outsidePeriod" with why it belongs`,
      );
    }
    return problems;
  },
  named_sources_read: ({ output, evidence, resolve, sources }) => {
    if (!sources || sources.length === 0) return [];
    const problems: string[] = [];
    if (isRecord(output) && output.unread !== undefined && !Array.isArray(output.unread))
      problems.push('"unread" must be a list of {source, why}');
    const entries = entriesOf(output, 'unread', 'source');
    const read = resolve ? sourcesReadFrom(evidence, resolve) : null;
    for (const id of sources) {
      if (read?.has(id)) continue;
      const entry = entries.find((x) => x.name === id);
      if (entry?.why) continue;
      if (entry) problems.push(`"unread" lists ${id} without saying why it could not be read`);
      else if (!read) problems.push(`nothing was supplied to check what was read from ${id}`);
      else
        problems.push(
          `this run names ${id}, and this step cites nothing read from it; cite what you read (as ${id}:<item>), or list it under "unread" with why`,
        );
    }
    return problems;
  },
  superseded_acknowledged: ({ output, evidence, resolve }) => {
    if (!resolve) return [];
    // The host lists each superseded document it relied on, with what replaces it, in "superseded": [{ref, replacedBy}].
    const listed = isRecord(output) && Array.isArray(output.superseded) ? output.superseded.filter(isRecord) : [];
    const problems: string[] = [];
    for (const entry of listed) {
      const ref = typeof entry.ref === 'string' ? entry.ref : '';
      const r = ref ? resolve(ref) : null;
      if (!r?.supersededBy) problems.push(`"superseded" lists ${JSON.stringify(ref)}, which is not superseded here`);
      else if (entry.replacedBy !== r.supersededBy)
        problems.push(`"superseded" says ${ref} is replaced by ${JSON.stringify(entry.replacedBy)}; it is replaced by ${r.supersededBy}`);
    }
    for (const e of evidence) {
      const r = resolve(e.ref);
      if (!r?.supersededBy || listed.some((entry) => entry.ref === e.ref)) continue;
      problems.push(
        `"${e.ref}" is superseded by ${r.supersededBy}; list it in "superseded" as {ref, replacedBy}, or cite the document that replaces it`,
      );
    }
    return problems;
  },
  decision_ask_present: ({ output, input }) => {
    // The host states the ask as data in "decision": {ask, decider, by}, with by a YYYY-MM-DD date.
    const d = isRecord(output) && isRecord(output.decision) ? output.decision : null;
    if (!d) return ['the output has no "decision": {ask, decider, by} stating the decision being asked for, who decides and by when'];
    const problems: string[] = [];
    if (typeof d.ask !== 'string' || !d.ask.trim()) problems.push('"decision.ask" is empty; state the decision being asked for');
    const audience = isRecord(input) && typeof input.audience === 'string' ? input.audience.trim() : '';
    const decider = typeof d.decider === 'string' ? d.decider.trim() : '';
    if (!decider) problems.push('"decision.decider" is empty; name who decides');
    else if (audience && decider.toLowerCase() !== audience.toLowerCase())
      problems.push(`"decision.decider" is ${JSON.stringify(decider)}, but this run's audience is ${JSON.stringify(audience)}`);
    const by = typeof d.by === 'string' ? d.by.trim() : '';
    const asked = isRecord(input) && typeof input.decisionBy === 'string' ? input.decisionBy.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(by) || Number.isNaN(Date.parse(`${by}T00:00:00Z`)))
      problems.push('"decision.by" is not a YYYY-MM-DD date');
    else if (/^\d{4}-\d{2}-\d{2}$/.test(asked) && by !== asked) problems.push(`"decision.by" is ${by}, but the decision is due ${asked}`);
    return problems;
  },
  sources_diverse: ({ evidence, resolve }) => {
    // Count distinct locations after exact-content deduplication. This is not a proof of independent origins.
    const roots = new Set<string>();
    const content = new Set<string>();
    for (const e of evidence) {
      const r = resolve?.(e.ref);
      if (!r || !holdsContent(r)) continue;
      const digest = createHash('sha256')
        .update(r.text ?? '')
        .digest('hex');
      content.add(digest);
      const page = r.itemRef ? normalizeUrl(r.itemRef) : null;
      if (page !== null) roots.add(new URL(page).hostname.replace(/^www\./, ''));
      else roots.add(r.sourceId ? `${r.sourceId}:${r.itemRef ?? ''}` : (r.path ?? e.ref));
    }
    // For the two-location floor, both partitions must have two members. Greedily
    // discarding a mirror would make the verdict depend on citation order when
    // one location also holds another document.
    const distinct = Math.min(roots.size, content.size);
    return distinct >= 2
      ? []
      : [
          `the findings rest on ${String(distinct)} distinct source location(s) after exact-content deduplication; research needs at least two locations with different held content. This does not establish source independence`,
        ];
  },
  revision_linked: ({ output, input, resolve }) => {
    const problems: string[] = [];
    const revises =
      (isRecord(output) && typeof output.revises === 'string' ? output.revises : null) ??
      (isRecord(input) && typeof input.deliverable === 'string' ? input.deliverable : null);
    if (!revises) problems.push('the output does not say which deliverable it revises ("revises")');
    else if (resolve && resolve(revises.startsWith('deliverable:') ? revises : `deliverable:${revises}`)?.kind !== 'deliverable')
      problems.push(`"${revises}" is not a deliverable of this project`);
    const summary = isRecord(output) ? output.changeSummary : undefined;
    const said =
      typeof summary === 'string'
        ? summary.trim()
        : Array.isArray(summary)
          ? summary.filter((x) => typeof x === 'string' && x.trim() !== '').join(' ')
          : '';
    if (said === '') problems.push('the output has no "changeSummary" saying what changed from the version it revises and why');
    return problems;
  },
  settled_not_contradicted: ({ output, settled, resolve }) => {
    if (!settled || settled.length === 0) return [];
    // The host lists the settled statements it knowingly sets aside or discusses, by id, in "setAside".
    const setAside =
      isRecord(output) && Array.isArray(output.setAside) ? output.setAside.filter((x): x is string => typeof x === 'string') : [];
    const problems: string[] = [];
    for (const id of setAside) {
      if (!settled.some((s) => s.statementId === id))
        problems.push(`"setAside" names ${JSON.stringify(id)}, which is not a statement settled for this run`);
    }
    const texts = strings(output);
    for (const p of artifactPaths(output)) {
      const t = resolve?.(p, 'artifact')?.text;
      if (t) texts.push(t);
    }
    for (const { term, statementId } of settled) {
      if (setAside.includes(statementId)) continue;
      const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[- ]/g, '[- ]')}\\b`, 'i');
      if (texts.some((t) => re.test(t)))
        problems.push(
          `"${term}" appears, and the person settled against it (statement:${statementId}); if the work knowingly sets that decision aside or discusses it, list ${statementId} in "setAside"; otherwise remove the term`,
        );
    }
    return problems;
  },
  sensitivity_cleared: ({ input, sensitivity }) => {
    if (!sensitivity || (sensitivity !== 'confidential' && sensitivity !== 'restricted')) return [];
    const cleared = isRecord(input) && typeof input.clearedFor === 'string' ? input.clearedFor : null;
    return higherSensitivity(cleared, sensitivity) === cleared && cleared !== null
      ? []
      : [
          `this rests on ${sensitivity} sources; the person has to clear it for its audience first (start the outcome with clearedFor: "${sensitivity}")`,
        ];
  },
  published_location: ({ output }) => {
    const loc = isRecord(output) && typeof output.location === 'string' ? output.location.trim() : '';
    if (loc === '') return ['the output gives no "location" where it was published (a URL or a page id)'];
    return /^https?:\/\/\S+|^[a-z][\w-]*:\S+/i.test(loc) ? [] : [`"${loc}" is not a URL or a provider:id location`];
  },
  conflicts_declared: ({ output }) => {
    if (!isRecord(output) || !Array.isArray(output.conflicts))
      return ['the output has no "conflicts" list; give one, empty if the sources agree'];
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
