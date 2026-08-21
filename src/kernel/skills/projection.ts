/**
 * kernel/skills/projection.ts — the role catalog projected as an Agent Skills
 * pack: one SKILL.md folder per lens, built here in memory and written by the
 * caller. Pure by construction — no filesystem, no environment, no clock. The
 * version it stamps is injected, so the same inputs always produce the same
 * bytes.
 *
 * Design decision, 2026-08-20 — generated on demand, never synced.
 *
 * The choice was between an installed tree the tool keeps in step (a sync loop,
 * an install record, a background reconciliation) and a tree generated fresh
 * whenever someone asks for one. This takes the second. A pack is output, the
 * way a compiled binary is output: reproducible from the catalog plus a version
 * string, safe to delete at any moment, and restored by running the same
 * command again. Nothing watches it, nothing repairs it, and no state is kept
 * anywhere about what was written — so there is no install record to lose, go
 * stale, or disagree with the disk.
 *
 * Where the stamps live: inside each generated SKILL.md, in its `metadata`
 * frontmatter map, as a generation marker (`generator: construct`) and the
 * source version that produced it. Not in a sidecar manifest, not in a dotfile
 * beside the tree, not in a database. A sidecar can be moved, copied, or
 * deleted separately from the folders it describes, and the moment it is, the
 * folders become unattributable. A stamp carried by the file itself travels
 * with the file: someone who finds one of these folders on a machine that has
 * never run this tool can still read what made it and which version did.
 *
 * The uninstall story: removal reads the marker, it does not replay a log.
 * Every immediate subfolder of the pack directory is inspected; the ones whose
 * SKILL.md carries the generation marker are removed whole, and every other
 * folder is kept with the reason printed — no marker, or no SKILL.md at all.
 * A hand-authored skill sitting in the same directory is therefore safe by
 * construction rather than by the caller remembering to be careful, and a pack
 * written by an older version on another machine still uninstalls cleanly,
 * because nothing about removal depends on this process having done the
 * writing.
 *
 * The failure mode being designed out is the predecessor's: synced trees that
 * outlived the generator that made them, carrying no version stamp and no way
 * to remove them, so stale copies accumulated in every project directory and
 * nobody could tell which tool had put them there or whether they were current.
 * Three properties close it — every file self-identifies, removal needs only
 * the files themselves, and regeneration is byte-identical so a stale tree is
 * corrected by re-running rather than by diffing and patching.
 *
 * The pack contains SKILL.md files and nothing else. No index, no README, no
 * manifest: "every generated file carries the marker" stays true without
 * exceptions to remember, and a file with no marker in this tree is, without
 * further inquiry, not ours.
 */

import type { RoleLens } from '../plan/lenses.ts';
import type { Playbook } from '../plan/playbooks.ts';
import type { Slot } from '../plan/schema.ts';
import type { LensStandards } from '../plan/standards.ts';

/** The value of the `generator` metadata key every generated file carries. */
export const SKILL_GENERATOR = 'construct';

/** The one file a generated skill folder contains. */
export const SKILL_FILENAME = 'SKILL.md';

/** Folder names are namespaced so a generated pack cannot shadow a hand-authored skill. */
const NAME_PREFIX = 'construct-';

/** The Agent Skills description cap. Longer descriptions are refused at upload. */
const MAX_DESCRIPTION = 1024;

/** Body text is wrapped so the file reads in a terminal without horizontal scroll. */
const WRAP = 76;

const LICENSE = 'Apache-2.0';

/** What the projection needs. All of it is data; none of it is read from the world. */
export interface SkillsProjectionInput {
  readonly lenses: readonly RoleLens[];
  /** Playbooks for the domains the lenses equip; a missing one is simply not rendered. */
  readonly playbooks: readonly Playbook[];
  readonly standards: readonly LensStandards[];
  /** The source version stamped into every generated file, supplied by the caller. */
  readonly version: string;
}

/** One file of the pack: a path relative to the pack root, and its whole content. */
export interface GeneratedFile {
  /** Relative, forward-slash separated. The caller joins it onto the output directory. */
  readonly path: string;
  /** The immediate folder name, which is also the skill's `name` field. */
  readonly directory: string;
  readonly content: string;
}

/** The folder (and skill name) a lens projects to. */
export function skillDirectoryName(lens: string): string {
  return `${NAME_PREFIX}${lens}`;
}

/**
 * The whole pack, one file per lens, ordered by folder name so two runs over
 * the same inputs produce the same list in the same order.
 */
export function projectSkillsPack(input: SkillsProjectionInput): readonly GeneratedFile[] {
  const byDomain = new Map(input.playbooks.map((p) => [p.domain, p]));
  const standards = new Map(input.standards.map((s) => [s.lens, s]));
  return input.lenses
    .map((lens) => {
      const directory = skillDirectoryName(lens.lens);
      return {
        directory,
        path: `${directory}/${SKILL_FILENAME}`,
        content: skillFile(lens, byDomain, standards.get(lens.lens), input.version),
      };
    })
    .sort((a, b) => (a.directory < b.directory ? -1 : a.directory > b.directory ? 1 : 0));
}

/**
 * Whether a SKILL.md was written by this generator. The test is the marker
 * nested under `metadata` in the file's own frontmatter — the only thing that
 * survives a folder being copied to a machine that knows nothing about it.
 */
export function isGeneratedSkill(skillText: string): boolean {
  return frontmatter(skillText).some((line) => /^\s+generator:\s*construct\s*$/.test(line));
}

/** The stamped source version, when the file is one of ours and carries one. */
export function generatedSkillVersion(skillText: string): string | null {
  if (!isGeneratedSkill(skillText)) return null;
  for (const line of frontmatter(skillText)) {
    const match = /^\s+version:\s*(.+?)\s*$/.exec(line);
    if (match) return unquote(match[1]);
  }
  return null;
}

/** One folder considered for removal: its name, and its SKILL.md if it has one. */
export interface SkillFolder {
  readonly directory: string;
  /** The folder's SKILL.md content, or null when it has none. */
  readonly skill: string | null;
}

/** What removal decided about one folder, and the reason a reader can check. */
export interface UninstallVerdict {
  readonly directory: string;
  readonly removed: boolean;
  readonly why: string;
}

/**
 * The removal plan: marked folders go, everything else stays with its reason
 * stated. Nothing here consults a record of what was written, because the
 * record that matters is the file on disk. Sorted by name so the report reads
 * the same on every filesystem.
 */
export function planSkillsUninstall(folders: readonly SkillFolder[]): readonly UninstallVerdict[] {
  return [...folders]
    .sort((a, b) => (a.directory < b.directory ? -1 : a.directory > b.directory ? 1 : 0))
    .map((folder) => {
      if (folder.skill === null) {
        return {
          directory: folder.directory,
          removed: false,
          why: `no ${SKILL_FILENAME} — not a skill folder`,
        };
      }
      if (!isGeneratedSkill(folder.skill)) {
        return {
          directory: folder.directory,
          removed: false,
          why: 'no generation marker — authored by hand, not by this tool',
        };
      }
      const version = generatedSkillVersion(folder.skill);
      return {
        directory: folder.directory,
        removed: true,
        why: version === null
          ? `carries the ${SKILL_GENERATOR} generation marker`
          : `generated by ${SKILL_GENERATOR} ${version}`,
      };
    });
}

/**
 * The stamped versions present in a pack that differ from the version
 * actually installed — the set doctor has something to say about, not a
 * line per folder. A pack always stamps every folder from one generation
 * run, so distinct-from-installed is the fact worth surfacing; a folder
 * whose stamp already matches, or that carries no stamp at all, is silent.
 */
export function skillPackSkew(
  folders: readonly SkillFolder[],
  installedVersion: string,
): readonly string[] {
  const versions = new Set<string>();
  for (const folder of folders) {
    if (folder.skill === null) continue;
    const version = generatedSkillVersion(folder.skill);
    if (version !== null && version !== installedVersion) versions.add(version);
  }
  return [...versions].sort();
}

/** The frontmatter lines of a file, empty when it has no closed frontmatter block. */
function frontmatter(text: string): readonly string[] {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return [];
  const close = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  return close === -1 ? [] : lines.slice(1, close);
}

function unquote(value: string): string {
  const quoted = /^'(.*)'$/.exec(value) ?? /^"(.*)"$/.exec(value);
  return quoted ? quoted[1].replace(/''/g, "'") : value;
}

/**
 * A plain YAML scalar where the value permits one, single-quoted where it does
 * not. Version strings are ordinary, but a caller is free to inject anything,
 * and a stamp that breaks the frontmatter it lives in stamps nothing.
 */
function yamlScalar(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(value) ? value : `'${value.replace(/'/g, "''")}'`;
}

const WORD_BREAK = /\s+/;

/** Wrap to the body width, with a hanging indent for continuation lines. */
function wrap(text: string, indent = '', hanging = indent): string {
  const words = text.trim().split(WORD_BREAK);
  const lines: string[] = [];
  let current = indent;
  let prefix = indent;
  for (const word of words) {
    if (current === prefix) {
      current += word;
      continue;
    }
    if (current.length + 1 + word.length > WRAP) {
      lines.push(current);
      prefix = hanging;
      current = hanging + word;
      continue;
    }
    current += ` ${word}`;
  }
  lines.push(current);
  return lines.join('\n');
}

/** The first sentence, or the whole thing when it never ends one. */
function firstSentence(text: string): string {
  const match = /^[\s\S]*?[.!?](?=\s|$)/.exec(text.trim());
  return (match ? match[0] : text.trim()).trim();
}

/** "a", "a and b", "a, b, and c" — the list as a reader would write it. */
function listOf(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * The description, assembled from whole sentences and shortened by dropping
 * whole sentences. The description is what makes a skill trigger at all, so a
 * mid-word truncation would be worse than a shorter one that still parses.
 */
function descriptionFor(lens: RoleLens): string {
  const parts: string[] = [lens.posture];
  parts.push(
    lens.domains.length > 0
      ? `Use when the outcome touches ${listOf(lens.domains)}.`
      : 'Use only for the cross-reference named here; no domain routes to this lens on its own.',
  );
  if (lens.ceiling) parts.push(`Limit: ${firstSentence(lens.ceiling)}`);
  if (lens.labeling) parts.push(`Every deliverable is labeled ${lens.labeling}.`);
  let kept = parts;
  while (kept.length > 1 && kept.join(' ').length > MAX_DESCRIPTION) kept = kept.slice(0, -1);
  const text = kept.join(' ');
  return text.length > MAX_DESCRIPTION ? text.slice(0, MAX_DESCRIPTION).trimEnd() : text;
}

/** A bulleted `- term — detail` entry, wrapped with a hanging indent. */
function bullet(term: string, detail: string): string {
  return wrap(`${term} — ${detail}`, '- ', '  ');
}

function slotLines(slots: readonly Slot[], required: boolean): string[] {
  return slots.filter((s) => s.required === required).map((s) => bullet(s.name, s.expects));
}

function playbookSection(playbook: Playbook): string[] {
  const out: string[] = [
    `### ${playbook.domain} — ${playbook.template.deliverable}`,
    '',
    wrap(`Stages, in order: ${playbook.stages.join(', ')}.`),
    '',
  ];
  const required = slotLines(playbook.template.slots, true);
  const optional = slotLines(playbook.template.slots, false);
  out.push('Every one of these is filled before the work is finished; a fact the');
  out.push('material cannot settle is written as an assumption, never left blank:');
  out.push('');
  out.push(...required);
  if (optional.length > 0) {
    out.push('', 'Filled when there is something to say:', '', ...optional);
  }
  out.push('');
  return out;
}

function standardsSection(standards: LensStandards | undefined): string[] {
  const out: string[] = ['## What this method stands on', ''];
  if (!standards || (standards.refs.length === 0 && !standards.ungrounded)) {
    out.push(wrap('No primary standard is recorded for this method.'), '');
    return out;
  }
  if (standards.refs.length === 0) {
    out.push(wrap(`No primary standard grounds this method: ${standards.ungrounded ?? ''}`), '');
    return out;
  }
  out.push(
    wrap(
      'References identify where the discipline comes from; they are not ' +
        'reproduced here, and what a standard currently says is checked against ' +
        'the standard.',
    ),
    '',
  );
  for (const ref of standards.refs) {
    out.push(bullet(`${ref.name} (${ref.publisher})`, ref.contributes));
  }
  out.push('');
  return out;
}

function limitsSection(lens: RoleLens): string[] {
  if (!lens.ceiling && !lens.labeling && !lens.jurisdictions) return [];
  const out: string[] = ['## Limits', ''];
  if (lens.ceiling) out.push(wrap(lens.ceiling), '');
  if (lens.labeling) out.push(wrap(`Every deliverable carries this label: ${lens.labeling}.`), '');
  if (lens.jurisdictions) {
    out.push(
      wrap(
        lens.jurisdictions.covered.length > 0
          ? `Jurisdictions covered: ${listOf(lens.jurisdictions.covered)}. ${lens.jurisdictions.outside}`
          : lens.jurisdictions.outside,
      ),
      '',
    );
  }
  return out;
}

function skillFile(
  lens: RoleLens,
  playbooks: ReadonlyMap<string, Playbook>,
  standards: LensStandards | undefined,
  version: string,
): string {
  const lines: string[] = [
    '---',
    `name: ${skillDirectoryName(lens.lens)}`,
    'description: >-',
    wrap(descriptionFor(lens), '  '),
    `license: ${LICENSE}`,
    'metadata:',
    `  generator: ${SKILL_GENERATOR}`,
    `  version: ${yamlScalar(version)}`,
    `  lens: ${lens.lens}`,
    '---',
    '',
    `# The ${lens.lens} lens`,
    '',
    wrap(
      'This file is generated from the role catalog of the tool named in its ' +
        'metadata. Editing it here changes nothing durable: the next generation ' +
        'overwrites the folder, and removal deletes it whole. Change the catalog ' +
        'instead.',
    ),
    '',
    '## Posture',
    '',
    wrap(lens.posture),
    '',
    '## When this applies',
    '',
    wrap(
      lens.domains.length > 0
        ? `Take this lens when the work touches ${listOf(lens.domains)}.`
        : 'No domain routes here on its own; this lens is taken only when the ' +
            'whole roster is being applied, and it contributes exactly what the ' +
            'limits below name.',
    ),
    '',
    '## The questions',
    '',
    wrap(
      'Work through every one. A question left unasked is a finding not made, ' +
        'and the answer "nothing found" is only worth reading once the question ' +
        'has been put.',
    ),
    '',
  ];

  lens.questions.forEach((question, i) => {
    lines.push(wrap(`${String(i + 1)}. ${question}`, '', '   '));
  });
  lines.push('');

  const sections = lens.domains
    .map((domain) => playbooks.get(domain))
    .filter((p): p is Playbook => p !== undefined);
  if (sections.length > 0) {
    lines.push('## What the deliverable must carry', '');
    for (const playbook of sections) lines.push(...playbookSection(playbook));
  }

  lines.push('## When to stop and escalate', '');
  for (const step of lens.escalation) lines.push(wrap(step, '- ', '  '));
  lines.push('');

  lines.push(...limitsSection(lens));
  lines.push(...standardsSection(standards));

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
