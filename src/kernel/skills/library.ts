/**
 * kernel/skills/library.ts — the portable method skills this repository ships,
 * judged against whatever sits in a host's skills directory. Pure by
 * construction: the caller does the reading, writing, and removing, and every
 * judgment about what is current, what has diverged, and what may be removed
 * is made here.
 *
 * Installed state is inferred from the disk, never from a manifest. What is
 * installed is what exists at the target; whether it is current is settled by
 * comparing its bytes against this checkout's copy. So there is no record to
 * lose, to go stale, or to disagree with the files it describes: the report
 * cannot claim an install that is not there, and cannot miss one that was
 * copied in by hand.
 *
 * An installed copy is byte-identical to its source — nothing templates it,
 * rewrites paths in it, or stamps it. That is what makes the comparison a
 * comparison rather than a guess, and it is why a version is read from the
 * installed file's own frontmatter rather than assumed from the source.
 *
 * Removal is equally disk-derived: a folder is removed only when it is one of
 * the shipped names and holds nothing except the one file an install writes.
 * A folder carrying anything else is kept with the reason stated, because a
 * command that removes what it did not install has lied about what it did.
 */

import { SKILL_FILENAME, skillFrontmatterLines } from './projection.ts';

export { SKILL_FILENAME };

/**
 * Portable method skills — explicit install, never product auto-install.
 * Kept equal to the method folders under `skills/` (excluding the operational
 * skill) by the skill-spec lint.
 */
export const METHOD_SKILLS: readonly string[] = Object.freeze([
  'adversarial-review',
  'context-mapping',
  'decision-framing',
  'intake',
  'investigative-research',
  'requirements-structuring',
  'written-voice',
]);

/**
 * Method skills that ship but stay out of `skills install --all`: house style
 * is opt-in, not a default pack.
 */
export const OPT_IN_METHOD_SKILLS: readonly string[] = Object.freeze(['written-voice']);

/** What `--all` installs: every method skill except opt-in-only names. */
export const DEFAULT_METHOD_INSTALL: readonly string[] = Object.freeze(
  METHOD_SKILLS.filter((name) => !(OPT_IN_METHOD_SKILLS as readonly string[]).includes(name)),
);

/**
 * The only skill `construct init` plants automatically. Short operational
 * posture for the host session — not a method skill and not a lens pack.
 */
export const OPERATIONAL_SKILL = 'construct';

/**
 * Every folder under `skills/` this checkout ships, method and operational.
 * A skills directory holds other people's skills too: without this list
 * nothing could tell which folders are this project's to name or remove.
 */
export const SHIPPED_SKILLS: readonly string[] = Object.freeze(
  [...METHOD_SKILLS, OPERATIONAL_SKILL].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
);

/**
 * Top-level entries an install may write beside SKILL.md (progressive
 * disclosure). Anything else in an installed folder is treated as foreign
 * and blocks uninstall.
 */
export const SKILL_BUNDLE_ENTRIES: readonly string[] = Object.freeze([
  'references',
  'scripts',
  'assets',
]);

/** One skill this checkout ships: its folder name, its frontmatter, its exact bytes. */
export interface SkillSource {
  /** The folder name under the source directory, which is also the skill's name. */
  readonly name: string;
  /** The frontmatter description, folded to a single line. */
  readonly description: string;
  /** The frontmatter version, or null when the file carries none. */
  readonly version: string | null;
  /** The SKILL.md content, exactly as it sits on disk. */
  readonly bytes: Uint8Array;
  /**
   * Every file the install copies, relative to the skill folder (`SKILL.md`,
   * `references/…`, …). SKILL.md is always included; progressive-disclosure
   * companions ride alongside it.
   */
  readonly files: readonly SkillBundleFile[];
}

/** One file inside a shipped skill folder, path relative to that folder. */
export interface SkillBundleFile {
  readonly relativePath: string;
  readonly bytes: Uint8Array;
}

/** One folder found at the install target, read for the file an install writes. */
export interface InstalledFolder {
  readonly name: string;
  /** The folder's SKILL.md content, or null when it has none. */
  readonly skill: Uint8Array | null;
  /** Every other entry in the folder, sorted — files an install never wrote. */
  readonly extras: readonly string[];
}

/**
 * What the target holds for one shipped skill. `absent` and `diverged` are
 * states a reader acts on, so they are named rather than folded into a
 * boolean.
 */
export type SkillState = 'current' | 'diverged' | 'absent';

/** One line of the installed report: never a claim beyond what the disk showed. */
export interface SkillStatus {
  readonly name: string;
  readonly state: SkillState;
  /** Read from the installed copy's own frontmatter; null when nothing is installed. */
  readonly version: string | null;
  readonly why: string;
}

/** What removal decided for one named skill, and the reason a reader can check. */
export interface RemovalPlan {
  /**
   * `remove` — the folder is one of ours and holds only the installed file.
   * `absent` — nothing is installed under that name; there is nothing to do.
   * `keep`   — something is there that an install did not write.
   */
  readonly outcome: 'remove' | 'absent' | 'keep';
  readonly why: string;
}

const decoder = new TextDecoder();

/** Byte-for-byte equality — the whole test for whether an installed copy is current. */
export function sameSkillBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** The frontmatter description, folded onto one line; empty when there is none. */
export function skillDescription(bytes: Uint8Array): string {
  const lines = skillFrontmatterLines(decoder.decode(bytes));
  const start = lines.findIndex((line) => /^description:/.test(line));
  if (start === -1) return '';
  // A description is written either inline, as a plain scalar continued on
  // indented lines, or as a folded block. All three fold to the same sentence,
  // so the reader takes the continuation lines and joins on single spaces.
  const head = lines[start].replace(/^description:\s*/, '').replace(/^[>|][-+]?\s*$/, '');
  const parts = head === '' ? [] : [head];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s/.test(line)) break;
    const text = line.trim();
    if (text !== '') parts.push(text);
  }
  return parts.join(' ').trim();
}

/**
 * The version this file declares, wherever the frontmatter carries it — the
 * shipped skills nest it under `metadata`, which the Agent Skills format
 * reserves for exactly this.
 */
export function skillVersion(bytes: Uint8Array): string | null {
  for (const line of skillFrontmatterLines(decoder.decode(bytes))) {
    const match = /^\s*version:\s*(.+?)\s*$/.exec(line);
    if (match) return unquote(match[1]);
  }
  return null;
}

function unquote(value: string): string {
  const quoted = /^'(.*)'$/.exec(value) ?? /^"(.*)"$/.exec(value);
  return quoted ? quoted[1].replace(/''/g, "'") : value;
}

/**
 * The state of every shipped skill at the target, in source order. A skill the
 * target does not hold is reported absent rather than omitted, so the report
 * answers "is it installed?" for each name instead of leaving the reader to
 * infer it from a short list.
 */
export function skillStatuses(
  sources: readonly SkillSource[],
  folders: readonly InstalledFolder[],
): readonly SkillStatus[] {
  const found = new Map(folders.map((folder) => [folder.name, folder]));
  return sources.map((source) => {
    const folder = found.get(source.name);
    if (!folder || folder.skill === null) {
      return { name: source.name, state: 'absent' as const, version: null, why: 'not installed' };
    }
    const current = sameSkillBytes(folder.skill, source.bytes);
    return {
      name: source.name,
      state: current ? ('current' as const) : ('diverged' as const),
      version: skillVersion(folder.skill),
      why: current
        ? "byte-identical to this checkout's copy"
        : "differs from this checkout's copy — edited here, or installed from another version",
    };
  });
}

/** Folders at the target that this checkout does not ship, counted but never claimed. */
export function foreignFolders(
  sources: readonly SkillSource[],
  folders: readonly InstalledFolder[],
): readonly string[] {
  const shipped = new Set(sources.map((source) => source.name));
  return folders
    .filter((folder) => !shipped.has(folder.name))
    .map((folder) => folder.name)
    .sort();
}

/**
 * The sources named by an install request, and the names that match nothing.
 * An unrecognized name resolves to no source at all rather than to a guess, so
 * the caller can refuse before it writes anything.
 */
export function selectSkills(
  sources: readonly SkillSource[],
  requested: readonly string[],
): { readonly selected: readonly SkillSource[]; readonly unknown: readonly string[] } {
  const byName = new Map(sources.map((source) => [source.name, source]));
  const selected: SkillSource[] = [];
  const unknown: string[] = [];
  for (const name of requested) {
    const source = byName.get(name);
    if (source) {
      if (!selected.includes(source)) selected.push(source);
    } else if (!unknown.includes(name)) {
      unknown.push(name);
    }
  }
  return { selected, unknown };
}

/**
 * Whether the named skill's folder may be removed whole. The name having been
 * shipped is the caller's check; this decides what the folder on disk permits.
 * Progressive-disclosure companions (`references`, `scripts`, `assets`) are
 * install-owned; any other top-level entry is foreign and blocks removal.
 */
export function planSkillRemoval(
  source: SkillSource,
  folder: InstalledFolder | undefined,
): RemovalPlan {
  if (!folder) return { outcome: 'absent', why: 'nothing is installed under that name' };
  if (folder.skill === null) {
    return { outcome: 'keep', why: `no ${SKILL_FILENAME} — an install never wrote this folder` };
  }
  const allowed = new Set<string>([...SKILL_BUNDLE_ENTRIES]);
  const foreign = folder.extras.filter((entry) => !allowed.has(entry));
  if (foreign.length > 0) {
    return {
      outcome: 'keep',
      why: `holds files an install never wrote: ${foreign.join(', ')}`,
    };
  }
  return sameSkillBytes(folder.skill, source.bytes)
    ? { outcome: 'remove', why: "the installed copy is byte-identical to this checkout's" }
    : { outcome: 'remove', why: "the installed copy differs from this checkout's — removed as it was" };
}

/** Sources named by `--all`: default method install set, never opt-in-only names. */
export function selectDefaultMethodInstall(
  sources: readonly SkillSource[],
): readonly SkillSource[] {
  const allowed = new Set(DEFAULT_METHOD_INSTALL);
  return sources.filter((source) => allowed.has(source.name));
}
