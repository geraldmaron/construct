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

import type { RecordedHistory, Divergence } from '../../kernel/tracker/session-drift.ts';

/** Where the tracker writes the export this repository version-controls. */
const EXPORT_PATH = '.beads/issues.jsonl';

/**
 * How far back the export's own history is swept.
 *
 * The sweep exists to catch records the tracker database lost, and a database
 * loses them at a session boundary rather than across years, so a bounded walk
 * finds what an unbounded one would at a fraction of the cost. The bound is
 * reported whenever it truncates, because a sweep that quietly stopped looking
 * would be indistinguishable from one that found nothing.
 *
 * Measured in days, not commits. This file is rewritten on every close, claim,
 * and filing, by however many sessions are working at once, so a commit count
 * measures fleet activity, not elapsed time: the former 200-commit cap read
 * back only ten days of this repo's own history on an ordinary week, and would
 * read back fewer the busier the fleet gets — shrinking the window exactly
 * when more parallel sessions also make a rollback more likely. Measured this
 * way, the walk still costs a fraction of an unbounded one (a 30-day window is
 * under a second on this repo's own history) and gives the same coverage
 * whether the fleet was quiet or busy during it.
 */
export const HISTORY_DAYS_CAP = 30;

/** Blobs are read a chunk at a time so a long history never materialises whole. */
const BLOB_CHUNK = 20;

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

/**
 * The issue records inside one export.
 *
 * A malformed line is skipped rather than thrown on: this parses blobs out of
 * git history as well as the working tree, and one truncated old revision must
 * not take down a sweep whose whole purpose is to read the past.
 */
function parseExport(text: string): BeadIssue[] {
  const issues: BeadIssue[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (record._type !== 'issue' || typeof record.id !== 'string') continue;
    issues.push(record as unknown as BeadIssue);
  }
  return issues;
}

export function loadIssues(root: string): BeadIssue[] | null {
  const path = join(root, EXPORT_PATH);
  if (!existsSync(path)) return null;
  return parseExport(readFileSync(path, 'utf8'));
}

/**
 * The contents of several blobs, in one git process.
 *
 * One spawn per revision is the obvious shape and costs an order of magnitude
 * more than the reading does; a batch keeps the sweep cheap enough to run on
 * every commit, which is the only reason it runs at all.
 */
function readBlobs(root: string, specs: readonly string[]): string[] {
  if (specs.length === 0) return [];
  const result = spawnSync('git', ['cat-file', '--batch'], {
    cwd: root,
    input: `${specs.join('\n')}\n`,
    maxBuffer: 1024 * 1024 * 512,
  });
  const out = result.error || result.status !== 0 ? null : (result.stdout as Buffer | null);
  if (!out) return [];
  const contents: string[] = [];
  let offset = 0;
  while (offset < out.length) {
    const newline = out.indexOf(0x0a, offset);
    if (newline < 0) break;
    const header = out.toString('utf8', offset, newline).split(' ');
    // `<oid> missing` for a revision this repository does not have; nothing follows it.
    if (header.length < 3) {
      offset = newline + 1;
      continue;
    }
    const size = Number(header[2]);
    if (!Number.isFinite(size)) break;
    const start = newline + 1;
    contents.push(out.toString('utf8', start, start + size));
    offset = start + size + 1;
  }
  return contents;
}

/**
 * Every id the export has ever recorded, and every one it ever recorded closed.
 *
 * The working tree's export says what the tracker database believes right now,
 * and a database that was rolled back believes something the repository already
 * wrote down. Comparing the current export only against commit messages cannot
 * see that: the closes were real, the commits were real, and the record of them
 * survives only in this file's own history. So the history is swept.
 *
 * Local refs only. A sweep that fetched would answer a different question on a
 * machine that happens to be online.
 *
 * `now` is supplied, never read, the same way the rest of this codebase keeps
 * a clock read out of anything meant to be tested deterministically: a caller
 * that wants "as of right now" passes its own clock in.
 */
export function recordedHistory(
  root: string,
  days: number = HISTORY_DAYS_CAP,
  now: string = new Date().toISOString(),
): RecordedHistory | null {
  const cutoffMs = Date.parse(now) - days * 24 * 60 * 60 * 1000;
  const since = new Date(cutoffMs).toISOString();
  const log = git(root, ['log', '--all', `--since=${since}`, '--format=%H', '--', EXPORT_PATH]);
  if (log === null) return null;
  const scanned = log
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

  // `--since` and `--before` each include a commit sitting exactly on the
  // boundary, so checking `--before=since` would see the newest scanned
  // commit again and call it older history the walk missed. Shifting the
  // probe one second earlier asks the question this is actually meant to
  // answer: does anything strictly outside the scanned window exist.
  const olderProbe = git(root, [
    'log',
    '--all',
    `--before=${new Date(cutoffMs - 1000).toISOString()}`,
    '-1',
    '--format=%H',
    '--',
    EXPORT_PATH,
  ]);
  const truncated = (olderProbe ?? '').trim() !== '';

  const everFiled = new Set<string>();
  const everClosed = new Set<string>();
  for (let i = 0; i < scanned.length; i += BLOB_CHUNK) {
    const specs = scanned.slice(i, i + BLOB_CHUNK).map((sha) => `${sha}:${EXPORT_PATH}`);
    for (const content of readBlobs(root, specs)) {
      for (const issue of parseExport(content)) {
        everFiled.add(issue.id);
        if (issue.status === 'closed') everClosed.add(issue.id);
      }
    }
  }

  return {
    everFiled: [...everFiled].sort(),
    everClosed: [...everClosed].sort(),
    commitsScanned: scanned.length,
    truncated,
  };
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
 * a parent id never matches inside one of its own child ids.
 */
/** The `%H%x00%B%x01` log format, unpacked. */
function parseLog(log: string): { sha: string; message: string }[] {
  const commits: { sha: string; message: string }[] = [];
  for (const entry of log.split('\x01')) {
    const [sha, message] = entry.split('\x00');
    if (!sha || !message) continue;
    commits.push({ sha: sha.trim(), message });
  }
  return commits;
}

/**
 * The tokens a commit message carries in trailer position: the last
 * parenthesised group on a line, wherever in the message that line sits.
 * Whether a token is an id this repository knows is the caller's question.
 */
function trailerTokens(message: string): string[] {
  const tokens: string[] = [];
  for (const line of message.split('\n')) {
    const trailer = /\(([^()]*)\)$/.exec(line.trim());
    if (!trailer) continue;
    for (const token of trailer[1].split(/[,\s]+/)) {
      const trimmed = token.trim();
      if (trimmed !== '') tokens.push(trimmed);
    }
  }
  return tokens;
}

export function landingCommits(
  root: string,
  ids: readonly string[],
  mainBranch: string,
): Map<string, string[]> | null {
  // The whole message, not the subject. The convention puts the id at the end
  // of the first line, which works for a commit landing one bead and cannot
  // work for one landing four — the trailer goes in the body, and reading only
  // the subject reported every bead except the one that fit. A trailer is the
  // last parenthesised group on its own line, wherever in the message that line
  // sits, so both shapes are found and neither is guessed at.
  const log = git(root, ['log', '--format=%H%x00%B%x01', mainBranch]);
  if (log === null) return null;
  const known = new Set(ids);
  const found = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const { sha, message } of parseLog(log)) {
    for (const id of trailerTokens(message)) {
      if (known.has(id)) found.get(id)?.push(sha.slice(0, 12));
    }
  }
  // A commit naming the same bead on two lines is one landing commit.
  for (const [id, shas] of found) found.set(id, [...new Set(shas)]);
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

/** `git rev-list --left-right --count A...B` — commits only in A, only in B. */
function countBoth(root: string, left: string, right: string): [number, number] {
  const counts = git(root, ['rev-list', '--left-right', '--count', `${left}...${right}`]);
  if (counts === null) return [0, 0];
  const [onlyLeft, onlyRight] = counts.trim().split(/\s+/).map(Number);
  return [Number.isFinite(onlyLeft) ? onlyLeft : 0, Number.isFinite(onlyRight) ? onlyRight : 0];
}

/**
 * Where this checkout stands relative to main and to its upstream, and which
 * beads have commits on main that it does not contain.
 *
 * Local refs only, and deliberately: a gather that fetched would report a
 * different repository than the one the session is working in, would need the
 * network to answer at all, and would make a commit-time check depend on being
 * online. The question here is what this machine already knows and the session
 * has not looked at.
 */
export function gatherDivergence(input: GatherInput): Divergence | null {
  const root = input.root;
  const mainBranch = input.mainBranch ?? 'main';
  if (git(root, ['rev-parse', '--verify', '--quiet', `${mainBranch}^{commit}`]) === null) {
    return null;
  }
  const head = (git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? '').trim() || 'HEAD';
  const [behindMain, aheadOfMain] = countBoth(root, mainBranch, 'HEAD');

  const upstreamRaw = git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  const upstream = upstreamRaw === null ? null : upstreamRaw.trim() || null;
  const [behindUpstream, aheadOfUpstream] = upstream
    ? countBoth(root, upstream, 'HEAD')
    : [0, 0];

  // The load-bearing part. A session that cannot see these commits will judge
  // the work in them missing and do it a second time, which is what happened.
  const ids = loadIssues(root)?.map((issue) => issue.id) ?? [];
  const prefixes = new Set(ids.map((id) => id.split('-')[0]).filter((p) => p !== ''));
  const beadsOnlyOnMain: string[] = [];
  const seen = new Set<string>();
  if (behindMain > 0) {
    const log = git(root, ['log', '--format=%H%x00%B%x01', `HEAD..${mainBranch}`]) ?? '';
    for (const { message } of parseLog(log)) {
      for (const token of trailerTokens(message)) {
        if (!prefixes.has(token.split('-')[0]) || !token.includes('-')) continue;
        if (seen.has(token)) continue;
        seen.add(token);
        beadsOnlyOnMain.push(token);
      }
    }
  }

  return {
    head,
    mainBranch,
    aheadOfMain,
    behindMain,
    upstream,
    aheadOfUpstream,
    behindUpstream,
    beadsOnlyOnMain,
  };
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
