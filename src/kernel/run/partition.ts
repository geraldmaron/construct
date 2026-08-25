/**
 * kernel/run/partition.ts — dividing a run's ground across its dispatches.
 *
 * Giving several dispatches different questions over identical material does
 * not produce different findings; giving them different material does. So when
 * a user has said how their sources stand to each other, that statement is what
 * decides which material reaches which dispatch, and nothing else here invents
 * a division of its own.
 *
 * Four rules, each one a declared relationship being read rather than a
 * heuristic:
 *
 *   1. Sources joined by `governs`, `depends-on`, `feeds` or `contradicts`
 *      travel together, always, into whichever dispatch they reach. Each of
 *      those four says the two cannot be read correctly apart: a rule without
 *      the thing it governs, or one half of a contradiction, is worse than
 *      either source alone.
 *   2. Sources joined by `covers-same-initiative` or `supersedes` are spread
 *      out. Both words say the two ends describe one thing — one from a second
 *      place, one from an earlier time — so handing every dispatch both is
 *      paying twice for one view, and handing different dispatches different
 *      sides of it is the whole point. Spreading a replacement away from what
 *      it replaced is also what lets both survive the next rule.
 *   3. A source something else `supersedes` is withheld from any dispatch that
 *      carries what supersedes it. Sending both is how a role cites the version
 *      that was replaced.
 *   4. A source that rule 3 emptied out of every dispatch is put back into one
 *      where its replacement is not. Withholding the older version from a role
 *      reading the newer one is the point of rule 3; deleting it from the run
 *      is not, and a run that read a source and then handed it to nobody has
 *      lost material the user declared and paid to survey.
 *
 * Where a replacement genuinely reaches every dispatch — a single-dispatch run,
 * or two sources the user also declared inseparable — rule 4 has nowhere legal
 * to put the replaced version, and its absence is then the declared outcome
 * rather than a loss.
 *
 * Material from a source nobody has related to anything reaches every dispatch.
 * That is the deliberate default: withholding ground on the strength of a
 * relationship the user never declared would be Construct dividing someone's
 * material by its own guess, which is exactly what this module exists not to
 * do.
 */

import type { Material } from './grounding.ts';
import type { SourceEdge, SourceRelation } from '../store/source-edges.ts';

/** The relationships whose two ends are never read apart. */
const INSEPARABLE: ReadonlySet<SourceRelation> = new Set<SourceRelation>([
  'governs',
  'depends-on',
  'feeds',
  'contradicts',
]);

/**
 * Smallest disjoint-set that does the job: sources are joined into groups, and
 * groups are joined into sets of alternates. Two passes over a handful of rows,
 * with no traversal engine anywhere near it.
 */
function unionFind(members: readonly string[]): {
  join: (a: string, b: string) => void;
  root: (a: string) => string;
} {
  const parent = new Map<string, string>(members.map((m) => [m, m] as const));
  const root = (a: string): string => {
    let current = a;
    while (parent.get(current) !== undefined && parent.get(current) !== current) {
      current = parent.get(current)!;
    }
    return current;
  };
  return {
    root,
    join: (a, b) => {
      if (!parent.has(a) || !parent.has(b)) return;
      const ra = root(a);
      const rb = root(b);
      if (ra !== rb) parent.set(rb, ra);
    },
  };
}

/**
 * Which of a run's material reaches which dispatch.
 *
 * Keyed by whatever the caller uses to name a dispatch — a task id in a live
 * run — and ordered inside each dispatch exactly as the material arrived, so a
 * role reads its ground in the order the run recorded reading it. Every
 * dispatch named gets an entry, including one that ends up with nothing.
 */
export function partitionMaterial(input: {
  readonly material: readonly Material[];
  readonly edges: readonly SourceEdge[];
  readonly dispatches: readonly string[];
}): Map<string, Material[]> {
  const { material, edges, dispatches } = input;
  const partitioned = new Map<string, Material[]>();
  if (dispatches.length === 0) return partitioned;

  // First-appearance order, so the division is a function of what the run read
  // and in what order — the same run partitions the same way every time.
  const sources: string[] = [];
  for (const item of material) if (!sources.includes(item.source)) sources.push(item.source);

  const live = edges.filter(
    (edge) => edge.retiredAt === null && sources.includes(edge.from) && sources.includes(edge.to),
  );
  if (live.length === 0) {
    for (const dispatch of dispatches) partitioned.set(dispatch, [...material]);
    return partitioned;
  }

  // Rule 1: what is never read apart.
  const groups = unionFind(sources);
  for (const edge of live) {
    if (INSEPARABLE.has(edge.relation)) groups.join(edge.from, edge.to);
  }
  const groupOf = new Map<string, string[]>();
  const groupOrder: string[] = [];
  for (const source of sources) {
    const root = groups.root(source);
    if (!groupOf.has(root)) {
      groupOf.set(root, []);
      groupOrder.push(root);
    }
    groupOf.get(root)!.push(source);
  }

  // Rule 2: which groups are alternate views of one thing — a second place it
  // is described from, or the earlier version of it.
  const alternates = unionFind(groupOrder);
  for (const edge of live) {
    if (edge.relation === 'covers-same-initiative' || edge.relation === 'supersedes') {
      alternates.join(groups.root(edge.from), groups.root(edge.to));
    }
  }
  const alternateSets = new Map<string, string[]>();
  for (const root of groupOrder) {
    const set = alternates.root(root);
    if (!alternateSets.has(set)) alternateSets.set(set, []);
    alternateSets.get(set)!.push(root);
  }

  const reaching = new Map<string, Set<string>>(
    dispatches.map((dispatch) => [dispatch, new Set<string>()] as const),
  );
  for (const members of alternateSets.values()) {
    if (members.length === 1) {
      // Nothing was declared to be an alternate view of this, so nothing is
      // held back from anyone.
      for (const dispatch of dispatches) {
        for (const source of groupOf.get(members[0]!) ?? []) reaching.get(dispatch)!.add(source);
      }
      continue;
    }
    members.forEach((root, index) => {
      const dispatch = dispatches[index % dispatches.length]!;
      for (const source of groupOf.get(root) ?? []) reaching.get(dispatch)!.add(source);
    });
  }

  // More dispatches than the declared division has parts. A role handed
  // nothing is worse than a role handed material somebody else also has: it
  // reasons from its domain alone while the run's own ground sits unread. So
  // a dispatch the division left empty gets the whole of it.
  for (const set of reaching.values()) {
    if (set.size === 0) for (const source of sources) set.add(source);
  }

  // Rule 3: the replaced version does not travel with its replacement.
  for (const set of reaching.values()) {
    for (const edge of live) {
      if (edge.relation === 'supersedes' && set.has(edge.from)) set.delete(edge.to);
    }
  }

  // Rule 4: nothing the run read disappears from the run. A source rule 3
  // emptied out everywhere goes back into the first dispatch that holds none of
  // its replacements — which is a different question from where it started,
  // because rule 3 has finished moving things by now. When every dispatch holds
  // a replacement there is no legal home and the source stays absent, which is
  // the user's own statement being honoured rather than material going missing.
  const replacements = new Map<string, string[]>();
  for (const edge of live) {
    if (edge.relation !== 'supersedes') continue;
    if (!replacements.has(edge.to)) replacements.set(edge.to, []);
    replacements.get(edge.to)!.push(edge.from);
  }
  for (const source of sources) {
    if ([...reaching.values()].some((set) => set.has(source))) continue;
    const supersededBy = replacements.get(source) ?? [];
    const home = dispatches.find((dispatch) => {
      const set = reaching.get(dispatch)!;
      return !supersededBy.some((replacement) => set.has(replacement));
    });
    if (home !== undefined) reaching.get(home)!.add(source);
  }

  for (const dispatch of dispatches) {
    const allowed = reaching.get(dispatch)!;
    partitioned.set(
      dispatch,
      material.filter((item) => allowed.has(item.source)),
    );
  }
  return partitioned;
}
