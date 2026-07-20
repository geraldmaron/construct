/**
 * lib/sources/repo-cache.mjs — local content cache for corpus source targets.
 *
 * A source target opts into a full-content corpus by declaring its provider
 * manifest's `content` descriptor shape in the selector (github: `content:
 * {mode:"corpus", ref?}`). Eligibility is keyed off that manifest `content`
 * descriptor, never a hardcoded `provider === 'github'` check, so any future
 * git-hosted provider that declares a `content` block gets caching for free
 * (bead construct-760c.1 R5).
 *
 * The checkout lives only under the ADR-0066 machine state root
 * (`~/.construct/projects/<key>/context-repos/<targetId>/`, resolved through
 * lib/state-root.mjs) — never in the project tree, so `construct init` never
 * scaffolds it. A sibling `<targetId>.meta.json` records the remote, ref,
 * resolved HEAD, sync mode, and last-fetch timestamp for freshness/TTL
 * reporting. The first sync clones shallow (`--depth 1`); every subsequent
 * sync fetches into the existing `.git` (incremental, re-run-safe — R4).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { resolveStateDir, resolveStatePath } from '../state-root.mjs';
import { getSourceTargetDescriptor, renderTemplate } from '../config/source-target-registry.mjs';
import { expandTilde } from '../config/source-targets.mjs';

export const DEFAULT_CORPUS_TTL_MS = 24 * 60 * 60 * 1000;

function contentDescriptor(target) {
  const descriptor = getSourceTargetDescriptor(target?.provider);
  return descriptor?.content ? { descriptor, content: descriptor.content } : null;
}

/**
 * Is this target opted into corpus caching? True only when its provider
 * manifest declares a `content` descriptor and the target's selector sets that
 * descriptor's mode field to the corpus value.
 */
export function isCorpusTarget(target) {
  const found = contentDescriptor(target);
  if (!found) return false;
  const block = target.selector?.[found.content.field];
  return !!block && block[found.content.modeField] === found.content.modeValue;
}

/**
 * Resolve the git remote URL for a corpus target: an explicit `remote` in the
 * content selector — a local `file://` bare repo, say — wins over the
 * manifest's `remoteTemplate` rendered from the selector value.
 */
export function resolveCorpusRemote(target) {
  const found = contentDescriptor(target);
  if (!found) return null;
  const { descriptor, content } = found;
  const block = target.selector?.[content.field] ?? {};
  if (content.remoteField && block[content.remoteField]) return String(block[content.remoteField]);
  const value = target.selector?.[descriptor.selector.field];
  if (!value) return null;
  if (content.remoteTemplate) return renderTemplate(content.remoteTemplate, { value });

  return expandTilde(String(value));
}

export function corpusRef(target) {
  const found = contentDescriptor(target);
  const block = target.selector?.[found.content.field] ?? {};
  return block[found.content.refField] || found.content.defaultRef;
}

export function corpusCacheDir(target, { projectRoot = process.cwd(), ensureDir = false } = {}) {
  return resolveStateDir(projectRoot, 'context-repos', target.id, { ensureDir });
}

function metaPathFor(target, projectRoot, { ensureDir = false } = {}) {
  return resolveStatePath(projectRoot, 'context-repos', `${target.id}.meta.json`, { ensureDir });
}

export function readCorpusMeta(target, { projectRoot = process.cwd() } = {}) {
  try {
    return JSON.parse(fs.readFileSync(metaPathFor(target, projectRoot), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Freshness view for a corpus target: whether a cache exists, its last-fetch
 * timestamp, and whether it is older than `ttlMs`. Drives `sources list`.
 */
export function corpusFreshness(target, { projectRoot = process.cwd(), ttlMs = DEFAULT_CORPUS_TTL_MS, now = Date.now() } = {}) {
  const dir = corpusCacheDir(target, { projectRoot });
  const cached = fs.existsSync(path.join(dir, '.git'));
  const meta = readCorpusMeta(target, { projectRoot });
  const lastFetch = meta?.lastFetch ?? null;
  const ageMs = lastFetch ? now - Date.parse(lastFetch) : null;
  const stale = ageMs == null ? cached : ageMs > ttlMs;
  return { cached, lastFetch, ageMs, stale, ref: meta?.ref ?? corpusRef(target), head: meta?.head ?? null, dir };
}

/**
 * Clone (first run) or fetch (subsequent runs) a corpus target's content into
 * its state-root cache and record freshness metadata. Incremental and
 * re-run-safe: an existing `.git` takes the fetch path, so objects are reused
 * rather than re-cloned. `git` is injectable purely for testing; production
 * uses the real git binary via execFileSync.
 */
export function syncCorpusTarget(target, { projectRoot = process.cwd(), git = runGit, now = () => new Date().toISOString() } = {}) {
  if (!isCorpusTarget(target)) {
    throw new Error(`target ${target.id} is not a corpus target`);
  }
  const remote = resolveCorpusRemote(target);
  if (!remote) throw new Error(`target ${target.id} has no resolvable corpus remote`);
  const ref = corpusRef(target);
  const dir = corpusCacheDir(target, { projectRoot });
  const gitDir = path.join(dir, '.git');

  let mode;
  if (fs.existsSync(gitDir)) {
    git(['-C', dir, 'fetch', '--depth', '1', 'origin', ref]);
    git(['-C', dir, 'checkout', '-f', 'FETCH_HEAD']);
    mode = 'fetch';
  } else {
    fs.mkdirSync(dir, { recursive: true });
    git(['clone', '--depth', '1', '--branch', ref, remote, dir]);
    mode = 'clone';
  }

  const head = git(['-C', dir, 'rev-parse', 'HEAD']).trim();
  const meta = {
    targetId: target.id,
    provider: target.provider,
    remote,
    ref,
    head,
    mode,
    lastFetch: now(),
  };
  fs.writeFileSync(metaPathFor(target, projectRoot, { ensureDir: true }), `${JSON.stringify(meta, null, 2)}\n`);
  return { ...meta, dir };
}

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
