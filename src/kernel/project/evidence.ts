/**
 * kernel/project/evidence.ts — whether an evidence reference names something
 * Construct holds, what it says, and how Construct knows.
 *
 * A step cites what it read. A reference resolves only to something real:
 * a file inside the project or a declared directory source, an item a
 * recorded read holds (a ticket, a page, a pull request), a declared source,
 * a deliverable, a record Construct keeps (a statement, claim, entity,
 * decision, or run), or one of Construct's own surfaces. Anything else does
 * not resolve.
 *
 * Every resolved reference carries one of three provenances, and a
 * deliverable carries the count of each, so a person can see how much of a
 * result rests on what:
 * - witnessed: Construct opened it (a project file, a directory source), or
 *   keeps the record itself.
 * - reported: a recorded read holds that exact item, with the text the host
 *   said it read. A read Construct made itself of a non-directory source
 *   stays witnessed.
 * - unverified: it names something only the host can read (an item of a
 *   tracker or wiki, a web page, a whole source) that no recorded read
 *   holds. It resolves only when the project sets policy.hostReads to
 *   accept; under require it does not resolve.
 *
 * Items match exactly as they were recorded: `confluence:98765`,
 * `github:acme/checkout#311`, the bare `acme/checkout#311`, `PLAT-101`. A
 * web address resolves to the item a read recorded under it, whatever its
 * fragment, case, scheme, or trailing slash. Anchors and line ranges
 * (`docs/a.md#section`, `docs/a.md:12-30`) narrow project files only.
 *
 * Accepted shapes: `docs/a.md`, `./docs/a.md`, `/abs/inside/root.md`,
 * `docs/a.md#section`, `docs/a.md:12-30`, `source:<id>`, `<id>`,
 * `<sourceId>:<item or path>`, `source:<sourceId>:<item>`, `PLAT-101`,
 * `https://…`, `deliverable:<id>`, `statement:<id>`, `claim:<id>`,
 * `entity:<id>`, `decision:<id>`, `run:<id>`, `drift:<id>`, and the surfaces
 * `sources`, `constitution`, `project_context`, `inbox`.
 *
 * A path is judged by where it really lives: a symlink inside the project
 * that points outside it does not resolve, so citing it cannot make
 * Construct read a file the project does not hold.
 */

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { ManifestEntry } from '../source/manifest.ts';
import { supersessionFor, type DeclaredSupersession } from './governance.ts';
import { normalizeUrl } from './urls.ts';

export const EVIDENCE_TEXT_CAP_BYTES = 1024 * 1024;

export type Provenance = 'witnessed' | 'reported' | 'unverified';

export interface ResolvedRef {
  readonly ref: string;
  readonly kind: 'file' | 'directory' | 'source' | 'item' | 'deliverable' | 'record' | 'surface' | 'web';
  readonly provenance: Provenance;
  /** Absolute path, for files and directories. */
  readonly path?: string;
  /** The declared source the reference falls under, when one does. */
  readonly sourceId?: string;
  /** The item reference inside that source (a relative path or a key), exactly as recorded. */
  readonly itemRef?: string;
  /** Recorded canonical base address for resolving relative references. */
  readonly url?: string;
  /** What it says, when that is cheap to know: file text under the cap, the text a recorded read holds. */
  readonly text?: string;
  /** The recorded text stops short of what was read, so a quote or figure past the cut cannot be checked. */
  readonly truncated?: boolean;
  /** The system's own last-updated time for a recorded item, when the read gave one. */
  readonly updatedAt?: string;
  /** Bytes on disk, for files. */
  readonly size?: number;
  /** The document that says it replaces this one, when one does. */
  readonly supersededBy?: string;
}

export type RefResolver = (ref: string) => ResolvedRef | null;

export interface EvidenceSource {
  /** A revoked source stays identifiable for refusal, but supplies no current evidence. */
  readonly canRead?: boolean;
  readonly id: string;
  readonly kind: string;
  readonly locator: string | null;
  readonly manifest: readonly ManifestEntry[] | null;
  /** How the manifest was obtained: read by Construct, or reported by the host or a fixture. A manifest is never unverified. */
  readonly provenance?: 'witnessed' | 'reported';
  /** Construct has never read this source and the host has never reported a read of it. */
  readonly neverRead?: boolean;
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
  /** Documents or items the person said, on their own channel, are no longer current. */
  readonly supersessions?: readonly DeclaredSupersession[];
  /**
   * require: a reference into what only the host can read resolves only to an item a recorded read holds.
   * accept: an unrecorded one resolves as unverified.
   */
  readonly hostReads?: 'require' | 'accept';
}

/** Names of Construct's own surfaces a step may cite as what it consulted. They hold no text to check against. */
const SURFACES = new Set(['sources', 'constitution', 'project_context', 'inbox']);

/** Narrow a file path: drop a trailing #anchor or :line / :line-line locator. Applied only to paths, never to items. */
export function stripLocator(ref: string): string {
  return ref.trim().replace(/#.*$/, '').replace(/:(\d+)(?:-\d+)?$/, '');
}

/** The item a reference names inside one source (`<id>:<item>` or `source:<id>:<item>`), exactly as written, or null. */
export function sourceItemOf(ref: string, sourceId: string): string | null {
  if (typeof ref !== 'string') return null;
  const raw = ref.trim();
  for (const prefix of [`${sourceId}:`, `source:${sourceId}:`]) {
    if (raw.startsWith(prefix) && raw.length > prefix.length) return raw.slice(prefix.length);
  }
  return null;
}

/** Whether a resolved reference holds content Construct can check: a file, or an item whose text a recorded read holds. Empty recorded text holds nothing. */
export function holdsContent(r: ResolvedRef | null | undefined): boolean {
  return r !== null && r !== undefined && (r.kind === 'file' || (r.kind === 'item' && typeof r.text === 'string' && r.text.trim() !== ''));
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
  // Bare references must have one meaning. A collision is retained as ambiguous,
  // not resolved by source iteration order, even when hostReads accepts unverified reads.
  type ItemHit = { source: EvidenceSource; entry: ManifestEntry };
  const itemIndex = new Map<string, ItemHit | null>();
  const urlIndex = new Map<string, ItemHit | null>();
  const urlsBySource = new Map<string, Map<string, ItemHit | null>>();
  const index = (map: Map<string, ItemHit | null>, key: string, hit: ItemHit) => {
    const was = map.get(key);
    if (!map.has(key)) map.set(key, hit);
    else if (!was || was.source.id !== hit.source.id || was.entry.ref !== hit.entry.ref) map.set(key, null);
  };
  for (const s of input.sources) {
    if (s.kind === 'directory') continue;
    const own = new Map<string, ItemHit | null>();
    for (const e of s.manifest ?? []) {
      const hit = { source: s, entry: e };
      index(itemIndex, e.ref, hit);
      for (const address of [e.url, e.ref]) {
        const key = typeof address === 'string' ? normalizeUrl(address) : null;
        if (key === null) continue;
        index(urlIndex, key, hit);
        index(own, key, hit);
      }
    }
    urlsBySource.set(s.id, own);
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
  const realRoot = (() => { try { return realpathSync(root); } catch { return root; } })();
  const realDirs = dirSources.map((d) => { try { return realpathSync(d.abs); } catch { return d.abs; } });
  const asPath = (raw: string, original: string, base = root): ResolvedRef | null => {
    // An empty path after narrowing (a bare "#anchor" or ":12") names no file, not the folder it would land on.
    if (raw.trim() === '') return null;
    const abs = resolve(base, raw.replace(/^file:/, ''));
    const ds = sourceFor(abs);
    if (dirSources.some((d) => d.canRead === false && inside(d.abs, abs))) return null;
    if ((!inside(root, abs) && !ds) || !existsSync(abs)) return null;
    let real: string;
    try {
      real = realpathSync(abs);
    } catch {
      return null;
    }
    if (dirSources.some((d, i) => d.canRead === false && inside(realDirs[i]!, real))) return null;
    if (!inside(realRoot, real) && !realDirs.some((d) => inside(d, real))) return null;
    const st = statSync(abs);
    const itemRef = ds ? relative(ds.abs, abs).split(sep).join('/') : undefined;
    const supersededBy = ds && itemRef ? ds.entries.get(itemRef)?.supersededBy : undefined;
    const common = { ref: original, path: abs, provenance: 'witnessed' as const, ...(ds ? { sourceId: ds.id, itemRef } : {}), ...(supersededBy ? { supersededBy } : {}) };
    if (st.isDirectory()) return { ...common, kind: 'directory' };
    if (!st.isFile()) return null;
    return { ...common, kind: 'file', size: st.size, text: readText(real) };
  };
  // An item a recorded read holds, with what the read kept. A manifest that does not say how it was obtained is
  // the host's report, never Construct's own reading.
  const itemHit = (original: string, source: EvidenceSource, entry: ManifestEntry): ResolvedRef | null => source.canRead === false ? null : ({
    ref: original,
    kind: 'item',
    provenance: source.provenance ?? 'reported',
    sourceId: source.id,
    itemRef: entry.ref,
    ...(entry.url ? { url: entry.url } : {}),
    ...(entry.text !== undefined ? { text: entry.text } : {}),
    ...(entry.truncated ? { truncated: true } : {}),
    ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
    ...(entry.supersededBy ? { supersededBy: entry.supersededBy } : {}),
  });
  // Something only the host can read that no recorded read holds: the host's word alone, admitted only under accept.
  const unrecorded = (r: Omit<ResolvedRef, 'provenance'>): ResolvedRef | null => (input.hostReads === 'accept' ? { ...r, provenance: 'unverified' } : null);
  const sourceLevel = (original: string, s: EvidenceSource): ResolvedRef | null => {
    if (s.canRead === false) return null;
    if (s.kind === 'directory') return { ref: original, kind: 'source', sourceId: s.id, provenance: 'witnessed', ...(s.locator ? { path: resolve(root, s.locator) } : {}) };
    if (s.manifest !== null || !s.neverRead) return { ref: original, kind: 'source', sourceId: s.id, provenance: s.provenance ?? 'reported' };
    return unrecorded({ ref: original, kind: 'source', sourceId: s.id });
  };

  const declared = input.supersessions ?? [];
  const govern = (r: ResolvedRef | null): ResolvedRef | null => {
    if (!r || r.supersededBy || declared.length === 0 || (r.kind !== 'file' && r.kind !== 'item')) return r;
    const hit = supersessionFor([r.itemRef ?? '', r.path ?? '', stripLocator(r.ref)].filter(Boolean), declared);
    return hit ? { ...r, supersededBy: `${hit.by} (statement:${hit.statementId})` } : r;
  };
  return (original: string): ResolvedRef | null => govern(resolveRaw(original));
  // One parser, in order; nothing is stripped before Construct knows what the reference is.
  function resolveRaw(original: string): ResolvedRef | null {
    if (typeof original !== 'string') return null;
    let raw = original.trim();
    if (raw === '') return null;
    const address = normalizeUrl(raw);
    if (address !== null) {
      const hit = urlIndex.get(address);
      return hit ? itemHit(original, hit.source, hit.entry) : urlIndex.has(address) ? null : unrecorded({ ref: original, kind: 'web' });
    }
    if (SURFACES.has(raw)) return { ref: original, kind: 'surface', provenance: 'witnessed' };
    if (raw.startsWith('source:')) {
      const named = raw.slice('source:'.length);
      if ([...byId.keys()].some((id) => named === id || named.startsWith(`${id}:`))) raw = named;
    }
    const colon = raw.indexOf(':');
    const head = colon > 0 ? raw.slice(0, colon) : '';
    const rest = colon > 0 ? raw.slice(colon + 1) : '';
    if (head === 'deliverable') return input.deliverableIds?.has(rest) ? { ref: original, kind: 'deliverable', provenance: 'witnessed' } : null;
    if ((RECORD_PREFIXES as readonly string[]).includes(head) && !byId.has(head)) {
      return rest && input.knows?.(head as RecordKind, rest) ? { ref: original, kind: 'record', provenance: 'witnessed' } : null;
    }
    if (input.deliverableIds?.has(raw)) return { ref: original, kind: 'deliverable', provenance: 'witnessed' };
    const whole = byId.get(raw);
    if (whole) return sourceLevel(original, whole);
    const s = head ? byId.get(head) : undefined;
    if (s && rest) {
      if (s.canRead === false) return null;
      if (s.kind === 'directory') return s.locator ? asPath(stripLocator(rest), original, resolve(root, s.locator)) : null;
      const hit = s.manifest?.find((e) => e.ref === rest);
      if (hit) return itemHit(original, s, hit);
      const at = normalizeUrl(rest);
      const byUrl = at === null ? undefined : urlsBySource.get(s.id)?.get(at);
      if (byUrl) return itemHit(original, s, byUrl.entry);
      if (at !== null && urlsBySource.get(s.id)?.has(at)) return null;
      return unrecorded({ ref: original, kind: 'item', sourceId: s.id, itemRef: rest });
    }
    const item = itemIndex.get(raw);
    if (item) return itemHit(original, item.source, item.entry);
    if (itemIndex.has(raw)) return null;
    return asPath(stripLocator(raw), original);
  }
}

/** How much of a step's evidence Construct opened itself, a recorded read holds, rests on the host's word alone, or names nothing. */
export function provenanceOf(evidence: readonly { readonly ref: string }[], resolve: RefResolver): { witnessed: number; reported: number; unverified: number; unresolved: number } {
  const out = { witnessed: 0, reported: 0, unverified: 0, unresolved: 0 };
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
