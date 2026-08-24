/**
 * kernel/skills/reach.ts — which of the portable method skills a dispatched
 * role can actually get at, and the paragraph that tells it so.
 *
 * The skills under `skills/` are severable by definition: each is one
 * self-contained file that works in any agent host with no checkout of this
 * repository present. That severability is the whole point of them, and
 * nothing here touches it. A skill is named and located, never inlined,
 * rewritten, or wrapped, so the file a role loads is the same file a stranger
 * would paste into an agent that has never seen this project.
 *
 * The library and the spine are one product rather than two that share a
 * checkout, and this is the seam where they meet: a dispatch reads what the
 * machine holds and tells the role, on the same terms the resource ladder
 * settles host choice. Decide from what is actually present, name every rung,
 * and say plainly when the answer is nothing.
 *
 * Two things it deliberately does not do.
 *
 * It does not choose which skill fits the work. Every skill carries its own
 * scope rule and its own stand-down rule, and a skill firing on the wrong task
 * is a defect in that skill rather than expected behavior. A second opinion
 * encoded here would be a rule that can contradict the file it is about, and
 * the file wins by construction: it is what the host loads. So the offer
 * carries each skill's own description, which is the field the format defines
 * as the thing that decides whether an agent reaches for it, and the choosing
 * stays where the format puts it.
 *
 * Carrying every description costs the dispatch real room: the seven shipped
 * ones run to roughly six kilobytes together. That is paid deliberately. The
 * description is the only thing that lets a role tell a skill it should reach
 * for from one it should leave alone, and a name without it would offer seven
 * doors with nothing written on them.
 *
 * It does not claim authorship of what it finds. A folder in the skills
 * directory is reported by the name it has and described by its own
 * frontmatter, never by this checkout's copy of a same-named file. So a
 * hand-authored skill that happens to share one of these names is described
 * accurately rather than misdescribed as ours, and an installed copy that has
 * drifted from this checkout is described as it actually reads, which is what
 * the host will load.
 */

import { join } from 'node:path';
import { skillDescription, SKILL_FILENAME } from './library.ts';
import type { InstalledFolder, SkillSource } from './library.ts';

/**
 * Where a skill is, in the terms a role can act on. `installed` is a copy in
 * the machine's agent skills directory, which is where a host that loads
 * skills looks; `checkout` is a copy that exists only in this repository, so
 * reaching it is a file read.
 */
export type SkillReach = 'installed' | 'checkout';

/** One skill a dispatch can get at, with its own description and where it sits. */
export interface SkillOffer {
  readonly name: string;
  /** The skill's own frontmatter description, folded to one line. */
  readonly description: string;
  readonly reach: SkillReach;
  /** The directory it is loaded from, or the path of the file to read. */
  readonly locator: string;
}

/** What a dispatch was offered, and where each rung looked. */
export interface SkillsReachable {
  readonly offers: readonly SkillOffer[];
  /** The agent skills directory that was read, whether or not it held anything. */
  readonly installDir: string;
  /** The skills directory this install ships, or null when its skill files are missing. */
  readonly sourceDir: string | null;
}

/**
 * What is reachable, resolved over the names this project ships. Installed
 * wins over checkout for one reason: it is the copy a host loads, so it is the
 * copy whose text governs, even where it differs from this checkout's.
 *
 * A name is offered from exactly one rung. Reporting the same skill twice
 * would read as two methods where there is one file.
 */
export function skillsReachable(input: {
  readonly shipped: readonly string[];
  readonly sources: readonly SkillSource[];
  readonly installed: readonly InstalledFolder[];
  readonly installDir: string;
  readonly sourceDir: string | null;
}): SkillsReachable {
  const installedByName = new Map(input.installed.map((folder) => [folder.name, folder]));
  const sourceByName = new Map(input.sources.map((source) => [source.name, source]));
  const offers: SkillOffer[] = [];
  for (const name of [...input.shipped].sort()) {
    const folder = installedByName.get(name);
    if (folder && folder.skill !== null) {
      offers.push({
        name,
        description: skillDescription(folder.skill),
        reach: 'installed',
        locator: input.installDir,
      });
      continue;
    }
    const source = sourceByName.get(name);
    if (source && input.sourceDir !== null) {
      offers.push({
        name,
        description: source.description,
        reach: 'checkout',
        locator: join(input.sourceDir, name, SKILL_FILENAME),
      });
    }
  }
  return { offers, installDir: input.installDir, sourceDir: input.sourceDir };
}

/**
 * The record of what this dispatch was offered, shaped for the work log. It is
 * written whether or not anything was reachable and whether or not the role
 * uses any of it, so the run's record and the deliverable's own words cannot
 * quietly disagree about what method was available to the work.
 */
export function skillsOffered(reachable: SkillsReachable): Record<string, unknown> {
  return {
    offered: reachable.offers.map((offer) => `${offer.name} (${offer.reach})`),
    installDir: reachable.installDir,
    sourceDir: reachable.sourceDir,
  };
}

const NONE_REACHABLE =
  'No portable method skills are reachable from this dispatch: none are ' +
  "installed in this machine's agent skills directory and this install's own " +
  'skill files are missing. Do not name or cite one.\n\n';

/**
 * What the role is told. Names, descriptions, and locations only: the role
 * decides which of them its work matches, using each skill's own scope rule,
 * and applying none of them is a designed outcome rather than a failure to
 * engage.
 *
 * The absence is spoken too, in one sentence. A role told nothing about the
 * method library has no way to tell "nothing is here" from "nobody mentioned
 * it", and a deliverable citing a method that was never on the machine is the
 * failure this sentence exists to prevent.
 */
export function skillsDirective(reachable: SkillsReachable): string {
  if (reachable.offers.length === 0) return NONE_REACHABLE;
  const lines = reachable.offers
    .map((offer) => {
      const where =
        offer.reach === 'installed'
          ? `installed at ${offer.locator}`
          : `read the file at ${offer.locator}`;
      return `- ${offer.name} (${where}): ${offer.description}`;
    })
    .join('\n');
  return (
    'Portable method skills are reachable from this machine. Each states in ' +
    'its own description what it is for and when it does not apply. Load one ' +
    'only where its scope rule matches this work, and follow it as written ' +
    'when you do; using none of them is a correct outcome, not a gap. None of ' +
    'them overrides your lens, this template, or anything asked of you above:\n' +
    `${lines}\n\n`
  );
}
