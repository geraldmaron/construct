/**
 * kernel/project/evidence.ts — whether an evidence reference names something
 * that exists, what it says, and how Construct knows.
 *
 * A step cites what it read. A reference resolves only to something real:
 * a file inside the project or a declared directory source, an item a
 * source reported at its last read (a Jira key from a fixture), a declared
 * source, a deliverable, or a record Construct keeps (a statement, claim,
 * entity, decision, or run). Anything else does not resolve.
 *
 * Provenance is part of the answer. What Construct can open itself is
 * "witnessed". A reference into a source Construct has no reader for (a
 * docs space or a live tracker the host reads through its own tools) is
 * accepted as "reported": the host says it read it, and nobody here can
 * check. Deliverables carry the count of each, so a person can see how much
 * of a result rests on the host's word.
 *
 * Accepted shapes: `docs/a.md`, `./docs/a.md`, `/abs/inside/root.md`,
 * `docs/a.md#section`, `docs/a.md:12-30`, `source:<id>`, `<id>`,
 * `<sourceId>:<item or path>`, `PLAT-101`, `deliverable:<id>`,
 * `statement:<id>`, `claim:<id>`, `entity:<id>`, `decision:<id>`, `run:<id>`.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { ManifestEntry } from '../source/manifest.ts';

export const EVIDENCE_TEXT_CAP_BYTES = 1024 * 1024;

export type Provenance = 'witnessed' | 'reported';

export interface ResolvedRef {
  readonly ref: string;
  readonly kind: 'file' | 'directory' | 'source' | 'item' | 'deliverable' | 'record';
  readonly provenance: Provenance;
  /** Absolute path, for files and directories. */
  readonly path?: string;
  /** The declared source the reference falls under, when one does. */
  readonly sourceId?: string;
  /** The item reference inside that source (a relative path or a key). */
  readonly itemRef?: string;
  /** What it says, when that is cheap to know: file text under the cap, a work item's text. */
  readonly text?: string;
  /** The document that says it replaces this one, when one does. */
  readonly supersededBy?: string;
}

export type RefResolver = (ref: string) => ResolvedRef | null;

export interface EvidenceSource {
  readonly id: string;
  readonly kind: string;
  readonly locator: string | null;
  readonly manifest: readonly ManifestEntry[] | null;
}

/** Kernel record kinds a step may cite by id. */
export const RECORD_PREFIXES = ['statement', 'claim', 'entity', 'decision', 'run', 'drift'] as const;
export type RecordKind = (typeof RECORD_PREFIXES)[number];

export interface ResolverInput {
  readonly root: string;
  readonly sources: readonly EvidenceSource[];
  readonly deliverableIds?: ReadonlySet<string>;
  /** Whether Construct holds a record of this kind with this id. */
  readonly knows?: (kind: RecordKind, id: string) => boolean;
}

/** Names of Construct's own surfaces a step may cite as what it consulted. */
const SURFACES = new Set(['sources', 'constitution', 'project_context', 'inbox']);

/** Drop a trailing #anchor or :line / :line-line locator; they narrow, they do not change what is cited. */
export function stripLocator(ref: string): string {
  return ref.trim().replace(/#.*$/, '').replace(/:(\d+)(?:-\d+)?$/, '');
}

function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function createEvidenceResolver(input: ResolverInput): RefResolver {
  const root = resolve(input.root);
  const byId = new Map(input.sources.map((s) => [s.id, s]));
  const dirSources = input.sources
    .filter((s) => s.kind === 'directory' && s.locator)
    .map((s) => ({ ...s, abs: resolve(root, s.locator!), entries: new Map((s.manifest ?? []).map((e) => [e.ref, e])) }));
  const itemIndex = new Map<string, { source: EvidenceSource; entry: ManifestEntry }>();
  for (const s of input.sources) {
    if (s.kind === 'directory') continue;
    for (const e of s.manifest ?? []) if (!itemIndex.has(e.ref)) itemIndex.set(e.ref, { source: s, entry: e });
  }
  const textCache = new Map<string, string | undefined>();
  const readText = (path: string): string | undefined => {
    if (textCache.has(path)) return textCache.get(path);
    let text: string | undefined;
    try {
      if (statSync(path).size <= EVIDENCE_TEXT_CAP_BYTES) text = readFileSync(path, 'utf8');
    } catch {
      text = undefined;
    }
    textCache.set(path, text);
    return text;
  };
  const sourceFor = (abs: string) => dirSources.find((d) => inside(d.abs, abs));
  const asPath = (raw: string, original: string, base = root): ResolvedRef | null => {
    const abs = resolve(base, raw.replace(/^file:/, ''));
    const ds = sourceFor(abs);
    if ((!inside(root, abs) && !ds) || !existsSync(abs)) return null;
    const st = statSync(abs);
    const itemRef = ds ? relative(ds.abs, abs).split(sep).join('/') : undefined;
    const supersededBy = ds && itemRef ? ds.entries.get(itemRef)?.supersededBy : undefined;
    const common = { ref: original, path: abs, provenance: 'witnessed' as const, ...(ds ? { sourceId: ds.id, itemRef } : {}), ...(supersededBy ? { supersededBy } : {}) };
    if (st.isDirectory()) return { ...common, kind: 'directory' };
    if (!st.isFile()) return null;
    return { ...common, kind: 'file', text: readText(abs) };
  };

  return (original: string): ResolvedRef | null => {
    if (typeof original !== 'string') return null;
    const ref = stripLocator(original);
    if (ref === '') return null;
    if (SURFACES.has(ref)) return { ref: original, kind: 'record', provenance: 'witnessed' };
    const colon = ref.indexOf(':');
    const head = colon > 0 ? ref.slice(0, colon) : '';
    const rest = colon > 0 ? ref.slice(colon + 1) : '';
    if (head === 'deliverable') return input.deliverableIds?.has(rest) ? { ref: original, kind: 'deliverable', provenance: 'witnessed' } : null;
    if ((RECORD_PREFIXES as readonly string[]).includes(head) && !byId.has(head)) {
      return rest && input.knows?.(head as RecordKind, rest) ? { ref: original, kind: 'record', provenance: 'witnessed' } : null;
    }
    if (input.deliverableIds?.has(ref)) return { ref: original, kind: 'deliverable', provenance: 'witnessed' };
    const sourceRef = head === 'source' ? rest : ref;
    if (byId.has(sourceRef)) return { ref: original, kind: 'source', sourceId: sourceRef, provenance: byId.get(sourceRef)!.manifest ? 'witnessed' : 'reported' };
    const s = head ? byId.get(head) : undefined;
    if (s && rest) {
      if (s.kind === 'directory' && s.locator) return asPath(rest, original, resolve(root, s.locator));
      // A source with no manifest is one Construct cannot read; the host's word is all there is.
      if (!s.manifest) return { ref: original, kind: 'item', sourceId: s.id, itemRef: rest, provenance: 'reported' };
      const hit = s.manifest.find((e) => e.ref === rest);
      return hit ? { ref: original, kind: 'item', sourceId: s.id, itemRef: hit.ref, text: hit.text, provenance: 'witnessed' } : null;
    }
    const item = itemIndex.get(ref);
    if (item) return { ref: original, kind: 'item', sourceId: item.source.id, itemRef: item.entry.ref, text: item.entry.text, provenance: 'witnessed' };
    return asPath(ref, original);
  };
}

/** How much of a step's evidence Construct could open itself. */
export function provenanceOf(evidence: readonly { readonly ref: string }[], resolve: RefResolver): { witnessed: number; reported: number; unresolved: number } {
  const out = { witnessed: 0, reported: 0, unresolved: 0 };
  for (const e of evidence) {
    const r = resolve(e.ref);
    if (!r) out.unresolved += 1;
    else out[r.provenance] += 1;
  }
  return out;
}

/** Text compared for quotation: case and whitespace do not matter, typographic quotes and dashes fold. */
export function normalizeQuote(text: string): string {
  return text.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
}
