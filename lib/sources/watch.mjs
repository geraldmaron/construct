/**
 * lib/sources/watch.mjs — cross-source change detection + watch state.
 *
 * Watches a configured source target for upstream changes so `construct doctor`
 * / `construct status` / the source-refresh daemon can surface drift without a
 * full corpus sync. Two target kinds are supported (bead construct-wjap9.3):
 *
 *   - corpus (git) targets  — `git ls-remote` the resolved remote + ref and
 *     compare the advertised HEAD against the last seen HEAD. No clone/fetch,
 *     so it is a pure metadata probe (zero content download).
 *   - directory targets      — recursively hash the target directory and
 *     compare against the last seen hash; a single file edit inside the tree
 *     moves the hash.
 *
 * Watch state lives in the ADR-0066 machine state root
 * (`~/.construct/projects/<key>/context-repos/<targetId>.watch.json`), so it is
 * scoped per project key + team like the corpus cache and never lands in the
 * project tree. The evidence cursor (lastSeenHead/lastSeenHash) advances only
 * after downstream processing via acknowledgeSourceChange (construct-4uxq0.11.1),
 * not at detection time. `git` is injectable for testing; production uses the
 * real git binary via execFileSync.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { resolveStatePath } from '../state-root.mjs';
import { getSourceTargetDescriptor } from '../config/source-target-registry.mjs';
import { expandTilde } from '../config/source-targets.mjs';
import { isCorpusTarget, resolveCorpusRemote, corpusRef, readCorpusMeta } from './repo-cache.mjs';
import { recordSourceChange } from './staleness-ledger.mjs';

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Resolve the on-disk watch-state path for a target. Team/project scoped via
 * resolveStateDir (ADR-0066); never project-relative.
 */
export function watchStatePath(target, projectRoot = process.cwd(), { ensureDir = false } = {}) {
  return resolveStatePath(projectRoot, 'context-repos', `${target.id}.watch.json`, { ensureDir });
}

export function readWatchState(target, { projectRoot = process.cwd() } = {}) {
  try {
    return JSON.parse(fs.readFileSync(watchStatePath(target, projectRoot), 'utf8'));
  } catch {
    return null;
  }
}

export function writeWatchState(target, state, { projectRoot = process.cwd() } = {}) {
  const p = watchStatePath(target, projectRoot, { ensureDir: true });
  fs.writeFileSync(p, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

/**
 * Recursively hash a directory's relative file paths + contents. Missing or
 * unreadable paths hash as a stable sentinel so an optional target does not
 * abort hashing. Returns a 16-hex digest, or null when the path does not exist.
 */
export function hashDirectory(dir) {
  let st;
  try { st = fs.statSync(dir); } catch { return null; }
  if (!st.isDirectory()) return null;
  const h = createHash('sha256');
  const stack = [dir];
  const files = [];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  files.sort();
  for (const filePath of files) {
    h.update(path.relative(dir, filePath));
    try { h.update(fs.readFileSync(filePath)); } catch { h.update('\0unreadable'); }
  }
  return h.digest('hex').slice(0, 16);
}

function resolveDirectoryTargetPath(target) {
  const descriptor = getSourceTargetDescriptor(target.provider);
  if (!descriptor?.selector?.field) return null;
  const raw = target.selector?.[descriptor.selector.field];
  if (raw == null) return null;
  return expandTilde(String(raw));
}

function lsRemoteHead(remote, ref, git) {
  const out = git(['ls-remote', remote]).trim();
  if (!out) return null;
  const lines = out.split('\n');
  if (ref) {
    const line = lines.find((l) => l.endsWith(`\trefs/heads/${ref}`));
    if (line) return line.split('\t')[0];
    return null;
  }
  const head = lines.find((l) => l.endsWith('\tHEAD'));
  return head ? head.split('\t')[0] : null;
}

/**
 * Compare a target's current upstream state against the last seen watch state.
 *
 * @returns {{
 *   targetId: string,
 *   kind: 'git' | 'directory' | 'unsupported',
 *   changed: boolean,
 *   previous: string | null,
 *   current: string | null,
 *   detail?: string,
 * }}
 */
export function detectSourceChanges(target, { projectRoot = process.cwd(), git = runGit } = {}) {
  if (isCorpusTarget(target)) {
    const remote = resolveCorpusRemote(target);
    if (!remote) {
      return { targetId: target.id, kind: 'git', changed: false, previous: null, current: null, detail: 'no resolvable remote' };
    }
    const ref = corpusRef(target);
    const current = lsRemoteHead(remote, ref, git);
    const state = readWatchState(target, { projectRoot });
    const previous = state?.lastSeenHead ?? readCorpusMeta(target, { projectRoot })?.head ?? null;
    const changed = previous != null && current != null && previous !== current;
    return { targetId: target.id, kind: 'git', changed, previous, current };
  }

  const descriptor = getSourceTargetDescriptor(target.provider);
  if (descriptor?.selector?.existsAs === 'directory') {
    const dir = resolveDirectoryTargetPath(target);
    if (!dir) {
      return { targetId: target.id, kind: 'directory', changed: false, previous: null, current: null, detail: 'no resolvable path' };
    }
    const current = hashDirectory(dir);
    const state = readWatchState(target, { projectRoot });
    const previous = state?.lastSeenHash ?? null;
    const changed = previous != null && current != null && previous !== current;
    return { targetId: target.id, kind: 'directory', changed, previous, current };
  }

  return { targetId: target.id, kind: 'unsupported', changed: false, previous: null, current: null };
}

/**
 * Advance the evidence cursor after downstream processing consumed a pending
 * change (construct-4uxq0.11.1). Clears pending markers and changedAt.
 */
export function acknowledgeSourceChange(target, { projectRoot = process.cwd(), now = Date.now() } = {}) {
  const state = readWatchState(target, { projectRoot });
  if (!state) return null;

  const hasPending = state.pendingHead != null || state.pendingHash != null;
  if (!hasPending && !state.changedAt) return state;

  const next = {
    ...state,
    lastSeenHead: state.pendingHead ?? state.lastSeenHead ?? null,
    lastSeenHash: state.pendingHash ?? state.lastSeenHash ?? null,
    pendingHead: null,
    pendingHash: null,
    changedAt: null,
    acknowledgedAt: new Date(now).toISOString(),
  };
  return writeWatchState(target, next, { projectRoot });
}

/**
 * Detect changes for a target and persist watch metadata. When a change is
 * detected the evidence cursor is NOT advanced; call acknowledgeSourceChange
 * after downstream processing. Baseline capture (no prior watermark) advances
 * immediately because there is nothing pending to lose.
 */
export function refreshWatch(target, { projectRoot = process.cwd(), git = runGit, now = Date.now(), record = true } = {}) {
  const result = detectSourceChanges(target, { projectRoot, git });
  const state = readWatchState(target, { projectRoot }) ?? {};
  const checkedAt = new Date(now).toISOString();

  const hadWatermark = result.kind === 'git'
    ? (state.lastSeenHead ?? readCorpusMeta(target, { projectRoot })?.head ?? null) != null
    : result.kind === 'directory'
      ? state.lastSeenHash != null
      : false;

  let changedAt = state.changedAt ?? null;
  if (result.changed) changedAt = checkedAt;

  const advanceWatermark = !result.changed || !hadWatermark;
  const next = {
    targetId: target.id,
    kind: result.kind,
    lastSeenHead: result.kind === 'git'
      ? (advanceWatermark ? result.current : state.lastSeenHead ?? null)
      : state.lastSeenHead ?? null,
    lastSeenHash: result.kind === 'directory'
      ? (advanceWatermark ? result.current : state.lastSeenHash ?? null)
      : state.lastSeenHash ?? null,
    pendingHead: result.changed && result.kind === 'git' ? result.current : state.pendingHead ?? null,
    pendingHash: result.changed && result.kind === 'directory' ? result.current : state.pendingHash ?? null,
    lastChecked: checkedAt,
    changedAt,
  };
  writeWatchState(target, next, { projectRoot });

  if (record && result.changed) {
    recordSourceChange(target.id, {
      kind: result.kind,
      previous: result.previous,
      current: result.current,
      at: checkedAt,
      detail: result.detail ?? 'upstream changed since last watch',
      projectRoot,
    });
  }

  return { ...result, checkedAt, changedAt, pending: result.changed && hadWatermark };
}
