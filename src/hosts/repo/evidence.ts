/**
 * hosts/repo/evidence.ts — what a git repository says about its own tracker.
 *
 * This is the IO half of the reconcile ritual. Every judgement lives in
 * kernel/tracker/session-drift.ts, which is pure and tested against fixtures
 * rather than against whatever this repo happens to look like today. All this
 * module does is gather evidence.
 *
 * It lives under hosts/ rather than kernel/ for the reason the kernel seam
 * exists: it spawns git and reads files from a path the caller supplies, and
 * the kernel is forbidden both. Two callers share it — the reconcile script a
 * session runs at its boundaries, and the standing watch that raises the same
 * drift as inbox decisions. They ask the same question and must not answer it
 * two different ways.
 */

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { BeadIssue, EvidenceBySlug } from '../../kernel/tracker/session-drift.ts';

export interface GatherInput {
  /** Repository root. Supplied by the caller; nothing here reads the cwd. */
  readonly root: string;
  readonly mainBranch?: string;
}

export interface Gathered {
  readonly issues: readonly BeadIssue[];
  readonly evidence: EvidenceBySlug;
}

/** Why nothing could be gathered, in words a caller can print verbatim. */
export interface GatherFailure {
  readonly problem: string;
}

export type GatherResult = Gathered | GatherFailure;

export function isFailure(result: GatherResult): result is GatherFailure {
  return 'problem' in result;
}

function git(root: string, args: readonly string[]): string | null {
  const result = spawnSync('git', [...args], { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return result.stdout;
}

export function loadIssues(root: string): BeadIssue[] | null {
  const path = join(root, '.beads/issues.jsonl');
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((record) => record._type === 'issue' && typeof record.id === 'string')
    .map((record) => record as unknown as BeadIssue);
}

/**
 * Which beads each commit on main landed.
 *
 * Only the trailer counts: a landing commit's subject ends with
 * `(construct-<id>)`, and one subject may carry several. A bead named anywhere
 * else in the message is explicitly NOT evidence that it landed, because a
 * commit can legitimately reference a bead it did not finish — scanning whole
 * messages reproduces that as noise, crediting every epic with each of its
 * children's commits.
 *
 * Trailers are matched against the known id set rather than by shape, so
 * `construct-2jb` never matches inside `construct-2jb.9`.
 */
export function landingCommits(
  root: string,
  ids: readonly string[],
  mainBranch: string,
): Map<string, string[]> | null {
  const log = git(root, ['log', '--format=%H%x00%s%x01', mainBranch]);
  if (log === null) return null;
  const known = new Set(ids);
  const found = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const entry of log.split('\x01')) {
    const [sha, subject] = entry.split('\x00');
    if (!sha || !subject) continue;
    const trailer = /\(([^()]*)\)$/.exec(subject.trim());
    if (!trailer) continue;
    for (const token of trailer[1].split(/[,\s]+/)) {
      const id = token.trim();
      if (known.has(id)) found.get(id)?.push(sha.trim().slice(0, 12));
    }
  }
  return found;
}

/**
 * Which beads have work in flight: named by a branch, a worktree, the stash, or
 * the uncommitted working tree. Deliberately generous — a false "in flight"
 * makes a stale claim look legitimate, which is quieter than the reverse, and
 * this check earns its keep by being trusted rather than by being maximal.
 */
export function inFlight(root: string, ids: readonly string[]): Set<string> {
  const haystack = [
    git(root, ['status', '--porcelain=v1', '-b']) ?? '',
    git(root, ['branch', '--list', '--format=%(refname:short)']) ?? '',
    git(root, ['worktree', 'list']) ?? '',
    git(root, ['stash', 'list']) ?? '',
  ].join('\n');
  return new Set(ids.filter((id) => haystack.includes(id)));
}

/**
 * Gather the whole evidence set, or say why it could not be gathered.
 *
 * Evidence is gathered for every bead, so absence of an entry never silently
 * excuses one. The kernel's skip-what-was-not-looked-at rule is for callers
 * that gather partially; this caller does not.
 */
export function gatherRepoEvidence(input: GatherInput): GatherResult {
  const mainBranch = input.mainBranch ?? 'main';
  const issues = loadIssues(input.root);
  if (issues === null) {
    return { problem: `no .beads/issues.jsonl under ${input.root} — nothing to reconcile` };
  }

  const ids = issues.map((issue) => issue.id);
  const commits = landingCommits(input.root, ids, mainBranch);
  if (commits === null) {
    return { problem: `cannot read git log for ${mainBranch} in ${input.root}` };
  }
  const flight = inFlight(input.root, ids);

  const evidence: Record<string, { landingCommits: string[]; inFlight: boolean }> = {};
  for (const id of ids) {
    evidence[id] = { landingCommits: commits.get(id) ?? [], inFlight: flight.has(id) };
  }
  return { issues, evidence };
}
