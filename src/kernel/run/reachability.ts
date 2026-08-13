/**
 * kernel/run/reachability.ts — whether the roles about to be dispatched can
 * actually open the ground the run licensed them.
 *
 * Observed on a live run: a workspace declared a repository, the survey walked
 * a hundred and twenty documents, the roles were licensed the root and told to
 * read further inside it — and the host was launched from a different
 * directory, so every file read failed. The run reported three tasks done. The
 * deliverables were ungrounded and the record said grounded, which is the exact
 * shape of failure the grounding work exists to prevent, arriving through the
 * one door nobody had put a check on.
 *
 * The rule is the one every host in this roster obeys: a dispatched model reads
 * from the directory it was started in, and nothing above it. So a licensed
 * root that is not that directory or inside it is a root the roles will not
 * reach, and that is knowable before a single model call is paid for rather
 * than after all of them are.
 *
 * Pure: paths in, judgment out. It stats nothing, because whether a directory
 * exists is the survey's question and was already answered — a root that could
 * not be walked never became licensed ground in the first place.
 */

/** Normalize for containment: no trailing separator, so a root is not its own child. */
function normalize(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/**
 * Whether a dispatch started in `from` can read `root`.
 *
 * Containment is by path segment, not by prefix: `/work/app` does not contain
 * `/work/application`, and a prefix test would say it does — the kind of
 * false reassurance that is worse than no check, because it passes.
 */
export function reachableFrom(root: string, from: string): boolean {
  const target = normalize(root);
  const base = normalize(from);
  if (target === base) return true;
  return target.startsWith(base === '/' ? '/' : `${base}/`);
}

export interface GroundReach {
  /** Licensed roots the dispatch directory contains. */
  readonly reachable: readonly string[];
  /** Licensed roots it does not, which the roles would be graded on regardless. */
  readonly unreachable: readonly string[];
}

/**
 * Split a run's licensed ground by whether the dispatch can open it.
 *
 * A run with no licensed roots has nothing to reach and comes back empty on
 * both sides: it is grounded in what its assignment carries, and no directory
 * makes that more or less true.
 */
export function groundReach(roots: readonly string[], from: string): GroundReach {
  const reachable: string[] = [];
  const unreachable: string[] = [];
  for (const root of roots) {
    (reachableFrom(root, from) ? reachable : unreachable).push(root);
  }
  return { reachable, unreachable };
}

/**
 * What to tell the user, or null when there is nothing wrong.
 *
 * Both ways out are named because they are genuinely different situations: a
 * dispatch pointed at the wrong directory is a mistake with an obvious fix,
 * and a host whose reach the operator knows is wider than its working
 * directory is a legitimate setup this check cannot see into. What it must not
 * do is pick one silently.
 */
export function unreachableGroundMessage(
  reach: GroundReach,
  from: string,
  overrideFlag: string,
): string | null {
  if (reach.unreachable.length === 0) return null;
  const many = reach.unreachable.length > 1;
  return (
    `${String(reach.unreachable.length)} licensed ground root${many ? 's are' : ' is'} outside the ` +
    `directory this run would dispatch from, so the roles would be graded on material they cannot open:\n` +
    reach.unreachable.map((root) => `  ${root}\n`).join('') +
    `  dispatching from: ${from}\n` +
    (reach.reachable.length > 0
      ? `  (${String(reach.reachable.length)} other root${reach.reachable.length > 1 ? 's are' : ' is'} reachable)\n`
      : '') +
    `  Dispatch where the ground is:  --dir=${reach.unreachable[0] ?? '<root>'}\n` +
    `  Or, if this host reaches past its working directory:  ${overrideFlag}\n`
  );
}
